import { and, eq, inArray } from 'drizzle-orm';

import { EntityId, type AreaKey, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import {
  PartnerSharingRecord,
  PartnerSharingUpsert,
  PhotoSharingRecord,
  PhotoSharingUpsert,
  type PartnerSharingLevel,
  type PhotoSharingLevel,
} from '@abnehm/contracts/coupling';

import type { TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { coupling, partnerSharing, photoSharing } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncWriter } from './outbox';
import { sqliteEntity } from './sqlite-entity';

// Partner- und Fotofreigabe im App-Sync (Spezifikation 0, Abschnitte 5 und 8–10). Die Kopplungsannahme
// legt sie auf dem Server an; danach ändert die Eigentümerin die Stufe sofort lokal und merkt in
// derselben Transaktion den Upsert vor (Last-Write-Wins). Der Partner erhält sie nie. Den Widerruf beim
// Partner, die Notices und das Sicherheitslog erledigt der Server bei der Annahme.

export const partnerSharingEntity = sqliteEntity({
  entityType: 'partner_sharing',
  ownerField: 'ownerPersonId',
  upsert: PartnerSharingUpsert,
  deletable: false,
  record: PartnerSharingRecord,
  table: partnerSharing,
  row: (id, data) => ({ id, ...data }),
  replay(tx, entityId, change) {
    if (change.type !== 'upsert_entity') return;
    sqliteOf(tx).update(partnerSharing).set({ level: change.payload.level, updatedAt: change.createdAt }).where(eq(partnerSharing.id, entityId)).run();
  },
});

export const photoSharingEntity = sqliteEntity({
  entityType: 'photo_sharing',
  ownerField: 'ownerPersonId',
  upsert: PhotoSharingUpsert,
  deletable: false,
  record: PhotoSharingRecord,
  table: photoSharing,
  row: (id, data) => ({ id, ...data }),
  replay(tx, entityId, change) {
    if (change.type !== 'upsert_entity') return;
    sqliteOf(tx).update(photoSharing).set({ level: change.payload.level, updatedAt: change.createdAt }).where(eq(photoSharing.id, entityId)).run();
  },
});

/** Ändert die eigene Partnerfreigabe eines Bereichs in der aktiven Kopplung. Ohne Kopplung ist das ein Aufruffehler. */
export function setPartnerSharing(tx: TransactionContext, writer: SyncWriter, change: { area: AreaKey; level: PartnerSharingLevel }, at: Instant): void {
  const own = ownSharing(tx, partnerSharing, eq(partnerSharing.area, change.area));
  sqliteOf(tx).update(partnerSharing).set({ level: change.level, updatedAt: at }).where(eq(partnerSharing.id, own.id)).run();
  writer.upsert(tx, { entityType: 'partner_sharing', entityId: EntityId.parse(own.id), payload: PartnerSharingUpsert.parse({ level: change.level }),
    knownServerVersion: own.serverVersion as ServerVersion | null });
}

/** Ändert die eigene Fotofreigabe der aktiven Kopplung. */
export function setPhotoSharing(tx: TransactionContext, writer: SyncWriter, level: PhotoSharingLevel, at: Instant): void {
  const own = ownSharing(tx, photoSharing);
  sqliteOf(tx).update(photoSharing).set({ level, updatedAt: at }).where(eq(photoSharing.id, own.id)).run();
  writer.upsert(tx, { entityType: 'photo_sharing', entityId: EntityId.parse(own.id), payload: PhotoSharingUpsert.parse({ level }),
    knownServerVersion: own.serverVersion as ServerVersion | null });
}

function ownSharing(tx: TransactionContext, table: typeof partnerSharing | typeof photoSharing, filter?: ReturnType<typeof eq>) {
  const owner = readOwnPerson(tx);
  const db = sqliteOf(tx);
  const active = db.select({ id: coupling.id }).from(coupling).where(eq(coupling.status, 'aktiv'));
  // Beide Tabellen teilen die hier verwendeten Spalten; Drizzle kann über die Union nicht bauen.
  const shared = table as unknown as typeof photoSharing;
  const found = owner === undefined ? undefined : db
    .select({ id: shared.id, serverVersion: shared.serverVersion })
    .from(shared)
    .where(and(eq(shared.ownerPersonId, owner.id), inArray(shared.couplingId, active), filter))
    .get();
  if (found === undefined) throw new Error('Freigaben gibt es nur in einer aktiven Kopplung');
  return found;
}
