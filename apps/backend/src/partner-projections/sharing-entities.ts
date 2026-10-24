import { and, eq, inArray } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { AreaKey, EntityId, TimeZone } from '@abnehm/contracts/base';
import { PartnerSharingRecord, PartnerSharingUpsert, PhotoSharingRecord, PhotoSharingUpsert } from '@abnehm/contracts/coupling';

import type { DbExecutor } from '../database.ts';
import { partnerSharing, person, photoSharing } from '../db/schema/index.ts';
import type { SecurityLog } from '../security-log/security-log.ts';
import type { EntityWrite, ServerSyncEntity } from '../sync/registry.ts';
import { invalidatePartnerSummaries } from './invalidations.ts';
import { revokeSummaries } from './revocation.ts';

// Partner- und Fotofreigabe als Upsert-Entitäten (Spezifikation 0, Abschnitte 5, 8 und 10). Angelegt
// werden sie nur bei der Kopplungsannahme; danach ändert die Eigentümerin die Stufe per generischem
// Upsert (Last-Write-Wins), lesen und schreiben darf nur sie. Ändert sich die Stufe, invalidiert der
// Server in derselben Transaktion alle Bereiche der Eigentümerin, widerruft beim Abschalten die
// Zusammenfassungen samt Revocation-Notice und schreibt die Freigabeänderung ins Sicherheitslog.
// Partnerfotos sind keine Projektion; sie prüft jeder Abruf online.

const iso = (value: Date) => value.toISOString();

type Dependencies = Readonly<{ clock: Clock; securityLog: SecurityLog }>;

export function sharingSyncEntities({ clock, securityLog }: Dependencies): readonly ServerSyncEntity[] {
  /** Liest die bisherige Stufe, schreibt die neue und meldet, ob sie sich geändert hat. */
  async function writeLevel(tx: DbExecutor, sharingTable: typeof partnerSharing | typeof photoSharing, change: EntityWrite, level: string) {
    // Freigaben legt nur die Kopplungsannahme an; die Autorisierung lässt kein Anlegen zu.
    if (!change.exists) throw new Error('Freigaben entstehen nur bei der Kopplungsannahme');
    // Beide Tabellen teilen die hier verwendeten Spalten; Drizzle kann über die Union nicht bauen.
    const table = sharingTable as unknown as typeof photoSharing;
    const own = and(eq(table.id, change.entityId), eq(table.ownerPersonId, change.ownerPersonId));
    const [before] = await tx.select({ level: table.level, couplingId: table.couplingId }).from(table).where(own);
    if (before === undefined) throw new Error('Freigabe der Eigentümerin fehlt');
    await tx.update(table).set({ level, updatedAt: change.at, serverVersion: change.serverVersion }).where(own);
    return { changed: before.level !== level, couplingId: before.couplingId };
  }

  async function ownerOf(tx: DbExecutor, personId: string) {
    const [owner] = await tx.select({ accountId: person.accountId, timeZone: person.timeZone }).from(person).where(eq(person.id, personId));
    if (owner === undefined) throw new Error('Person der Eigentümerin fehlt');
    return owner;
  }

  return [
    {
      entityType: 'partner_sharing',
      resource: 'partner_sharing',
      upsert: PartnerSharingUpsert,
      deletable: false,
      read: (tx, ids) => readRows(tx, partnerSharing, ids, (row) =>
        PartnerSharingRecord.parse({ ownerPersonId: row.ownerPersonId, couplingId: row.couplingId, area: row.area, level: row.level,
          createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) })),
      async write(tx, change) {
        const { level } = PartnerSharingUpsert.parse(change.payload);
        const { changed, couplingId } = await writeLevel(tx, partnerSharing, change, level);
        if (!changed) return;
        const [sharing] = await tx.select({ area: partnerSharing.area }).from(partnerSharing).where(eq(partnerSharing.id, change.entityId));
        const area = AreaKey.parse(sharing?.area);
        const owner = await ownerOf(tx, change.ownerPersonId);
        // Eine Freigabeänderung wirkt bereichsübergreifend ab dem aktuellen Tag der Eigentümerin.
        const today = clock.read(TimeZone.parse(owner.timeZone)).localDate;
        await invalidatePartnerSummaries(tx, { type: 'freigabe', ownerPersonId: change.ownerPersonId, localDate: today }, change.at);
        if (level === 'privat') await revokeSummaries(tx, { ownerPersonId: change.ownerPersonId, couplingId, area }, change.at);
        await securityLog.record({ type: 'freigabeaenderung', accountId: EntityId.parse(owner.accountId), couplingId: EntityId.parse(couplingId), scope: area, level }, tx);
      },
      async remove() {
        throw new Error('Partnerfreigaben werden nicht gelöscht');
      },
    },
    {
      entityType: 'photo_sharing',
      resource: 'photo_sharing',
      upsert: PhotoSharingUpsert,
      deletable: false,
      read: (tx, ids) => readRows(tx, photoSharing, ids, (row) =>
        PhotoSharingRecord.parse({ ownerPersonId: row.ownerPersonId, couplingId: row.couplingId, level: row.level,
          createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) })),
      async write(tx, change) {
        const { level } = PhotoSharingUpsert.parse(change.payload);
        const { changed, couplingId } = await writeLevel(tx, photoSharing, change, level);
        if (!changed) return;
        const owner = await ownerOf(tx, change.ownerPersonId);
        await securityLog.record({ type: 'freigabeaenderung', accountId: EntityId.parse(owner.accountId), couplingId: EntityId.parse(couplingId), scope: 'fotos', level }, tx);
      },
      async remove() {
        throw new Error('Die Fotofreigabe wird nicht gelöscht');
      },
    },
  ];
}

async function readRows<T extends typeof partnerSharing | typeof photoSharing>(
  tx: DbExecutor,
  table: T,
  ids: readonly EntityId[],
  record: (row: T['$inferSelect']) => Record<string, unknown>,
) {
  if (ids.length === 0) return new Map();
  const rows = (await tx.select().from(table as typeof partnerSharing).where(inArray(table.id, [...ids]))) as T['$inferSelect'][];
  return new Map(rows.map((row) => [row.id, { serverVersion: row.serverVersion, deletedAt: row.deletedAt, data: record(row) }]));
}
