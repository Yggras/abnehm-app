import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { EntityId, type TimeZone } from '@abnehm/contracts/base';
import type { IslandRole } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { blueprintUnlock, communityProject, couplingMember, island, islandEvent, islandField } from '../db/schema/index.ts';
import { CommandRejection } from '../sync/commands.ts';
import { projectIslandProgress } from './progress-projector.ts';

// Schlüpfen (Spezifikation 4, Abschnitte 2.4, 5 und 7): der serverinterne Übergang bei angenommener
// Rollenwahl, ohne eigenen Client-Befehl. Er läuft im Savepoint der Entscheidung (`decideSharedAction`)
// und setzt dort atomar beide Rollen, `hatched_at`, die Insel auf `aktiv` und die Zeitzone der Insel vom
// annehmenden Gerät. Dazu materialisiert er Startfelder und Start-Baupläne, beginnt Gemeinschaftsprojekt 1,
// legt das gemeinsame Ereignis „Momo ist geschlüpft“ an und projiziert den Inselfortschritt. Scheitert ein
// Teil, rollt der Savepoint alles zurück, und der Vorschlag bleibt offen. Jede Zeile bekommt eine
// Serverversion und kommt per Pull zu beiden Mitgliedern.

/** Anlassschlüssel des Ereignisses; eindeutig je Insel, das Ereignis entsteht also höchstens einmal. */
export const hatchedOccasionKey = 'geschluepft';

export type HatchingRequest = Readonly<{
  couplingId: EntityId;
  proposerPersonId: EntityId;
  proposerRole: IslandRole;
  /** Die Person, die angenommen hat. */
  partnerPersonId: EntityId;
  timeZone: TimeZone;
  at: Date;
}>;

export async function hatch(tx: DbExecutor, { couplingId, proposerPersonId, proposerRole, partnerPersonId, timeZone, at }: HatchingRequest): Promise<void> {
  // Die Sperre ordnet das Schlüpfen hinter einen gleichzeitigen Antrag derselben Insel (`role-choice.ts`).
  const [current] = await tx.select({ id: island.id, state: island.state }).from(island).where(eq(island.couplingId, couplingId)).for('update');
  if (current?.state !== 'wartet_auf_rollen') throw new CommandRejection('conflict');
  const islandId = EntityId.parse(current.id);
  const plan = hatching(gameCatalog, { proposerPersonId, proposerRole, partnerPersonId });
  const write = changeWriter(tx, at);
  const owned = { islandId, couplingId };

  for (const [role, personId] of Object.entries(plan.roles)) {
    const [member] = await tx
      .select({ id: couplingMember.id })
      .from(couplingMember)
      .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, personId)));
    if (member === undefined) throw new Error('Rolle für eine Person ohne Mitgliedschaft');
    await write({ entityType: 'coupling_member', couplingId }, async (stamp) => {
      await tx.update(couplingMember).set({ role, ...updated(stamp) }).where(eq(couplingMember.id, member.id));
      return member.id;
    });
  }
  await write({ entityType: 'island', couplingId }, async (stamp) => {
    await tx.update(island).set({ state: 'aktiv', hatchedAt: at, timeZone, ...updated(stamp) }).where(eq(island.id, islandId));
    return islandId;
  });
  for (const field of plan.fields) {
    await write({ entityType: 'island_field', couplingId }, async ({ createdAt, serverVersion }) => {
      const id = randomUUID();
      await tx.insert(islandField).values({ id, ...owned, fieldKey: field.key, ownerPersonId: field.ownerPersonId, createdAt, serverVersion });
      return id;
    });
  }
  for (const blueprint of plan.blueprints) {
    await write({ entityType: 'blueprint_unlock', couplingId }, async ({ createdAt, serverVersion }) => {
      const id = randomUUID();
      await tx.insert(blueprintUnlock).values({ id, ...owned, catalogKey: blueprint.key, reason: blueprint.reason, unlockedAt: at, createdAt, serverVersion });
      return id;
    });
  }
  await write({ entityType: 'community_project', couplingId }, async (stamp) => {
    const id = randomUUID();
    await tx.insert(communityProject).values({ id, ...owned, ...plan.project, status: 'aktiv', ...stamp });
    return id;
  });
  await write({ entityType: 'island_event', couplingId }, async (stamp) => {
    const id = randomUUID();
    await tx.insert(islandEvent).values({
      id, ...owned, type: 'momo_geschluepft', occasionKey: hatchedOccasionKey, status: 'abgeschlossen', occurredAt: at, ...stamp,
    });
    return id;
  });
  await projectIslandProgress(tx, { islandId, at });
}
