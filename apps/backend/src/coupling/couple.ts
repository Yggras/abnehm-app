import { randomUUID } from 'node:crypto';

import { and, eq, inArray, ne } from 'drizzle-orm';

import { AreaKey } from '@abnehm/contracts/base';

import type { DbExecutor } from '../database.ts';
import { coupling, couplingMember, island, partnerSharing, person, photoSharing } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';

// Schreibseite der Kopplung (Spezifikation 0, Abschnitte 8 und 9). Jede geschriebene Zeile erhält eine
// eigene Serverversion und einen Eintrag im Änderungsprotokoll, damit sie im Pull ankommt: Kopplung,
// Mitglieder und Insel für beide aktiven Mitglieder, Freigaben nur für ihre Eigentümerin.

export type Coupled = Readonly<{ couplingId: string; reactivated: boolean }>;

/**
 * Koppelt zwei Personen, die der Aufrufer gesperrt und als ungekoppelt geprüft hat. Gibt es für das
 * Paar schon eine (archivierte) Kopplung, wird sie samt Insel, Rollen und Freigaben reaktiviert; sonst
 * entstehen Kopplung, zwei rollenlose Mitglieder, eine wartende Insel, vier Partnerfreigaben auf
 * `zusammengefasst` und die Fotofreigaben auf `geteilt`.
 */
export async function couple(tx: DbExecutor, personIds: readonly [string, string], at: Date): Promise<Coupled> {
  const [low, high] = [...personIds].sort() as [string, string];
  const [existing] = await tx
    .select({ id: coupling.id })
    .from(coupling)
    .where(and(eq(coupling.personLowId, low), eq(coupling.personHighId, high)));
  if (existing !== undefined) {
    await reactivate(tx, existing.id, at);
    return { couplingId: existing.id, reactivated: true };
  }
  return { couplingId: await create(tx, [low, high], at), reactivated: false };
}

async function create(tx: DbExecutor, [low, high]: readonly [string, string], at: Date): Promise<string> {
  const couplingId = randomUUID();
  const write = changeWriter(tx, at);

  await write({ entityType: 'coupling', couplingId }, async (stamp) => {
    await tx.insert(coupling).values({ id: couplingId, personLowId: low, personHighId: high, status: 'aktiv', startedAt: at, ...stamp });
    return couplingId;
  });
  for (const member of await displayNames(tx, [low, high])) {
    await write({ entityType: 'coupling_member', couplingId }, async (stamp) => {
      const id = randomUUID();
      await tx.insert(couplingMember).values({ id, couplingId, couplingStatus: 'aktiv', personId: member.id, displayName: member.displayName, ...stamp });
      return id;
    });
  }
  await write({ entityType: 'island', couplingId }, async (stamp) => {
    const id = randomUUID();
    await tx.insert(island).values({ id, couplingId, state: 'wartet_auf_rollen', ...stamp });
    return id;
  });
  for (const ownerPersonId of [low, high]) {
    for (const area of AreaKey.options) {
      await write({ entityType: 'partner_sharing', ownerPersonId }, async (stamp) => {
        const id = randomUUID();
        await tx.insert(partnerSharing).values({ id, ownerPersonId, couplingId, area, level: 'zusammengefasst', ...stamp });
        return id;
      });
    }
    await write({ entityType: 'photo_sharing', ownerPersonId }, async (stamp) => {
      const id = randomUUID();
      await tx.insert(photoSharing).values({ id, ownerPersonId, couplingId, level: 'geteilt', ...stamp });
      return id;
    });
  }
  return couplingId;
}

/**
 * Reaktiviert Kopplung und Insel desselben Paars. Rollen, Partner- und Fotofreigaben bleiben, wie sie
 * waren; die Mitglieder übernehmen die aktuellen Anzeigenamen. Alle Zeilen erhalten eine neue
 * Serverversion, damit beide Geräte sie im nächsten Pull wieder erhalten.
 */
async function reactivate(tx: DbExecutor, couplingId: string, at: Date) {
  const write = changeWriter(tx, at);
  await write({ entityType: 'coupling', couplingId }, async (stamp) => {
    // Die Mitglieder folgen dem Status per `ON UPDATE CASCADE`.
    await tx.update(coupling).set({ status: 'aktiv', endedAt: null, reactivatedAt: at, ...updated(stamp) }).where(eq(coupling.id, couplingId));
    return couplingId;
  });
  const members = await tx.select({ id: couplingMember.id, personId: couplingMember.personId }).from(couplingMember).where(eq(couplingMember.couplingId, couplingId));
  const names = new Map((await displayNames(tx, members.map((member) => member.personId))).map((found) => [found.id, found.displayName]));
  for (const member of members) {
    await write({ entityType: 'coupling_member', couplingId }, async (stamp) => {
      await tx.update(couplingMember).set({ displayName: names.get(member.personId)!, ...updated(stamp) }).where(eq(couplingMember.id, member.id));
      return member.id;
    });
  }
  const [found] = await tx.select({ id: island.id, hatchedAt: island.hatchedAt }).from(island).where(eq(island.couplingId, couplingId));
  if (found === undefined) throw new Error('Insel der archivierten Kopplung fehlt');
  await write({ entityType: 'island', couplingId }, async (stamp) => {
    await tx
      .update(island)
      .set({ state: found.hatchedAt === null ? 'wartet_auf_rollen' : 'aktiv', ...updated(stamp) })
      .where(eq(island.id, found.id));
    return found.id;
  });
  for (const table of [partnerSharing, photoSharing]) {
    const sharings = await tx.select({ id: table.id, ownerPersonId: table.ownerPersonId }).from(table).where(eq(table.couplingId, couplingId));
    for (const sharing of sharings) {
      const entityType = table === partnerSharing ? 'partner_sharing' : 'photo_sharing';
      await write({ entityType, ownerPersonId: sharing.ownerPersonId }, async (stamp) => {
        await tx.update(table).set(updated(stamp)).where(eq(table.id, sharing.id));
        return sharing.id;
      });
    }
  }
}

/**
 * Zieht den Anzeigenamen der Person bei allen ihren Kopplungsmitgliedern nach, auch bei archivierten
 * Kopplungen; aufgerufen in der Transaktion, die den Namen der Person ändert.
 */
export async function followDisplayName(tx: DbExecutor, personId: string, displayName: string, at: Date) {
  const stale = await tx
    .select({ id: couplingMember.id, couplingId: couplingMember.couplingId })
    .from(couplingMember)
    .where(and(eq(couplingMember.personId, personId), ne(couplingMember.displayName, displayName)));
  const write = changeWriter(tx, at);
  for (const member of stale) {
    await write({ entityType: 'coupling_member', couplingId: member.couplingId }, async (stamp) => {
      await tx.update(couplingMember).set({ displayName, ...updated(stamp) }).where(eq(couplingMember.id, member.id));
      return member.id;
    });
  }
}

type Stamp = { createdAt: Date; updatedAt: Date; serverVersion: bigint };
type Scope = { entityType: string } & ({ couplingId: string } | { ownerPersonId: string });

/** Vergibt je Zeile eine Serverversion und trägt die Änderung mit ihrer Sichtbarkeitsgrenze ein. */
function changeWriter(tx: DbExecutor, at: Date) {
  return async (scope: Scope, writeRow: (stamp: Stamp) => Promise<string>) => {
    const serverVersion = await nextServerVersion(tx);
    const entityId = await writeRow({ createdAt: at, updatedAt: at, serverVersion });
    await recordChange(tx, { position: serverVersion, operation: 'upsert', createdAt: at, ...scope, entityId });
  };
}

/** Bei einer Änderung bleibt `created_at` erhalten. */
const updated = ({ updatedAt, serverVersion }: Stamp) => ({ updatedAt, serverVersion });

async function displayNames(tx: DbExecutor, personIds: readonly string[]) {
  return tx
    .select({ id: person.id, displayName: person.displayName })
    .from(person)
    .where(inArray(person.id, [...personIds]));
}
