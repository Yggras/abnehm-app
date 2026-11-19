import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { EntityId, Instant, ServerVersion } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { mealPhoto } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der Mahlzeitenfotos: neben dem Sync-Adapter und dem Bestätigen (`meal-photos.ts`) die einzige
// Stelle, die die Tabelle `meal_photo` liest oder ändert (Spezifikation 2, Abschnitt 9; #164). Das Gerät
// kennt nur die Metadaten; die Bilddatei liegt auf dem Server.

/** Ein Mahlzeitenfoto der eigenen Person, wie Befehle und Fotoansicht es brauchen. */
export type StoredPhoto = Readonly<{
  id: EntityId;
  personId: EntityId;
  sharedWithPartner: boolean;
  deletedAt: Instant | null;
  /** `null`, solange der Server das Foto nicht bestätigt hat. */
  serverVersion: ServerVersion | null;
}>;

/** Ein Mahlzeitenfoto, gleich ob gelöscht; `undefined`, wenn es keines (mehr) gibt. */
export function readPhoto(tx: ReadContext, photoId: EntityId): StoredPhoto | undefined {
  const row = sqliteOf(tx)
    .select({
      id: mealPhoto.id,
      personId: mealPhoto.personId,
      sharedWithPartner: mealPhoto.sharedWithPartner,
      deletedAt: mealPhoto.deletedAt,
      serverVersion: mealPhoto.serverVersion,
    })
    .from(mealPhoto)
    .where(eq(mealPhoto.id, photoId))
    .get();
  return row === undefined
    ? undefined
    : {
        id: EntityId.parse(row.id),
        personId: EntityId.parse(row.personId),
        sharedWithPartner: row.sharedWithPartner,
        deletedAt: row.deletedAt === null ? null : Instant.parse(row.deletedAt),
        serverVersion: row.serverVersion === null ? null : ServerVersion.parse(row.serverVersion),
      };
}

/** Ob das Foto besteht und nicht gelöscht ist; nur dann verknüpft „Rückgängig“ es wieder. */
export function isLivingPhoto(tx: ReadContext, photoId: EntityId): boolean {
  return readPhoto(tx, photoId)?.deletedAt === null;
}

/**
 * Die Fotos aus `photoIds`, die der Server bestätigt hat und die nicht gelöscht sind: Nur sie lassen sich
 * abrufen. Ein Foto, dessen Bestätigung noch in der Outbox steht, hat noch keine Datei in der Fotoablage.
 */
export function viewablePhotoIds(tx: ReadContext, photoIds: readonly EntityId[]): ReadonlySet<EntityId> {
  if (photoIds.length === 0) return new Set();
  const rows = sqliteOf(tx)
    .select({ id: mealPhoto.id })
    .from(mealPhoto)
    .where(and(inArray(mealPhoto.id, [...photoIds]), isNull(mealPhoto.deletedAt), isNotNull(mealPhoto.serverVersion)))
    .all();
  return new Set(rows.map((row) => EntityId.parse(row.id)));
}

/** Schreibt „Mit Partner teilen“. */
export function writeSharing(tx: TransactionContext, photoId: EntityId, sharedWithPartner: boolean, at: Instant): void {
  sqliteOf(tx).update(mealPhoto).set({ sharedWithPartner, updatedAt: at }).where(eq(mealPhoto.id, photoId)).run();
}

/** Setzt die Löschmarkierung; Löschen ist ein Tombstone und für Clientoperationen endgültig. */
export function tombstonePhoto(tx: TransactionContext, photoId: EntityId, at: Instant): void {
  sqliteOf(tx).update(mealPhoto).set({ deletedAt: at, updatedAt: at }).where(eq(mealPhoto.id, photoId)).run();
}
