import { and, eq, isNull } from 'drizzle-orm';

import type { EntityId } from '@abnehm/contracts/base';
import { ConfirmPhotoDraft, confirmPhotoDraftKey, MealPhotoRecord, MealPhotoUpsert } from '@abnehm/contracts/nutrition';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { policies } from '../authorization/authorization.ts';
import type { Database, DbExecutor } from '../database.ts';
import { mealPhoto, photoDraft } from '../db/schema/index.ts';
import type { Job } from '../jobs/job-registry.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { ownedEntity, type ServerSyncEntity } from '../sync/registry.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { mealPhotoVariants } from './photo-image.ts';
import type { PhotoStorage } from './photo-storage.ts';

// Mahlzeitenfotos auf dem Server (Spezifikation 2, Abschnitte 8, 9 und 11; #162). Ein Mahlzeitenfoto
// entsteht nur mit dem Fachbefehl `confirmPhotoDraft`: Er legt immer alle Einträge an und, solange der
// Entwurf gültig, eigen und nicht abgelaufen ist, das Foto samt Vorschau und vergrößerter Fassung in
// der Fotoablage. Andernfalls bleiben die Einträge ohne Foto, damit keine bestätigte Mahlzeit verloren
// geht. Der Sync kennt für das Foto nur den Freigabeschalter (Upsert) und die Löschmarkierung.
//
// Atomar ist der Übergang über Postgres: Das Foto gilt erst mit dem Commit, der zugleich den Entwurf
// löscht. Die Dateien entstehen davor unter dem Bildschlüssel des Entwurfs; rollt die Transaktion
// zurück, besteht der Entwurf fort und ein Retry findet dieselben Dateien. Dateien, zu denen weder ein
// Entwurf noch ein nicht gelöschtes Mahlzeitenfoto gehört, entfernt der Aufräumjob der Fotoablage.

/** Abstand der Aufräumläufe der Fotoablage (Designwert, nicht belegt), wie bei den Fotoentwürfen. */
const STORAGE_CLEANUP_INTERVAL_MS = 5 * 60_000;

export function createMealPhotos({
  database,
  storage,
  entries,
}: {
  database: Database;
  storage: PhotoStorage;
  /** Die angemeldete Entität `nutrition_entry`: Der Befehl schreibt Einträge über ihren Schreibweg. */
  entries: ServerSyncEntity;
}) {
  const entity: ServerSyncEntity = ownedEntity({
    entityType: 'meal_photo',
    resource: 'meal_photo',
    table: mealPhoto,
    upsert: MealPhotoUpsert,
    deletable: true,
    columns: ({ sharedWithPartner }) => ({ sharedWithPartner }),
    record: (row): MealPhotoRecord =>
      MealPhotoRecord.parse({
        imageKey: row.imageKey,
        capturedAt: row.capturedAt.toISOString(),
        sharedWithPartner: row.sharedWithPartner,
        personId: row.personId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    // Kein generisches Create: Ohne bestätigten Entwurf gibt es weder Bild noch Aufnahmezeit.
    validate: async (_tx, { exists }) => (exists ? null : 'invalid_payload'),
  });

  /** Der Entwurf, sofern er der Person gehört, analysiert und nicht abgelaufen ist, samt seinem Bild. */
  async function validDraft(tx: DbExecutor, draftId: string, personId: string, at: Date) {
    // Sperrt den Entwurf gegen den Aufräumjob und eine zweite Bestätigung bis zum Ende der Transaktion.
    const [draft] = await tx.select().from(photoDraft).where(eq(photoDraft.id, draftId)).for('update');
    if (draft === undefined || draft.personId !== personId || draft.analysisState !== 'analysiert' || draft.expiresAt <= at) return null;
    const image = await storage.readDraft(draft.imageKey);
    return image === null ? null : { ...draft, image };
  }

  /** Legt das Foto in der Fotoablage und in Postgres an und löscht den Entwurf; `false`, wenn das Bild nicht taugt. */
  async function storePhoto(tx: DbExecutor, draft: NonNullable<Awaited<ReturnType<typeof validDraft>>>, input: {
    photoId: EntityId; personId: EntityId; sharedWithPartner: boolean; at: Date;
  }): Promise<boolean> {
    let images: Awaited<ReturnType<typeof mealPhotoVariants>>;
    try {
      images = await mealPhotoVariants(draft.image);
    } catch {
      // Ein Bild, das sich nicht mehr verkleinern lässt, kostet nur das Foto, nie die Mahlzeit.
      return false;
    }
    await storage.savePhoto(draft.imageKey, images);
    const serverVersion = await nextServerVersion(tx);
    await tx.insert(mealPhoto).values({
      id: input.photoId,
      personId: input.personId,
      imageKey: draft.imageKey,
      capturedAt: draft.createdAt,
      sharedWithPartner: input.sharedWithPartner,
      createdAt: input.at,
      updatedAt: input.at,
      serverVersion,
    });
    await recordChange(tx, { position: serverVersion, entityType: entity.entityType, entityId: input.photoId, operation: 'upsert',
      ownerPersonId: input.personId, createdAt: input.at });
    await tx.delete(photoDraft).where(eq(photoDraft.id, draft.id));
    return true;
  }

  const confirmCommand: ServerCommand<ConfirmPhotoDraft> = {
    type: 'confirmPhotoDraft',
    identity: 'none',
    // Ziel ist das neue Mahlzeitenfoto: Eine unbekannte ID legt die Person an, eine fremde ist verweigert.
    policy: policies.resource('meal_photo', 'befehl'),
    payload: ConfirmPhotoDraft,
    target: (operation) => ({ id: ConfirmPhotoDraft.parse(operation.payload).photoId }),
    canonicalRequest: (operation) => ConfirmPhotoDraft.parse(operation.payload),
    // Jede Bestätigung trägt ihre eigene Foto-ID; ein Duplikat ist nur der Retry derselben Bestätigung.
    duplicate: () => [],
    async execute(tx, { actor, payload, businessKey, at }) {
      if (businessKey !== confirmPhotoDraftKey(payload.photoId)) throw new CommandRejection('invalid_payload');
      const ids = payload.entries.map((item) => item.id);
      if ((await entries.read(tx, ids)).size > 0) throw new CommandRejection('conflict');

      const draft = await validDraft(tx, payload.draftId, actor.personId, at);
      const withPhoto = draft !== null && (await storePhoto(tx, draft, { photoId: payload.photoId, personId: actor.personId,
        sharedWithPartner: payload.sharedWithPartner, at }));

      const changes: CanonicalChange[] = withPhoto ? [await canonicalAfterWrite(tx, entity, payload.photoId)] : [];
      for (const { id, entry } of payload.entries) {
        // Derselbe Schreibweg wie beim generischen Upsert: Prüfung des Tags, Schreiben, Änderungsprotokoll.
        const serverVersion = await nextServerVersion(tx);
        const write = { entityId: id, payload: { ...entry, mealPhotoId: withPhoto ? payload.photoId : null }, ownerPersonId: actor.personId,
          serverVersion, at, exists: false };
        const problem = (await entries.validate?.(tx, write)) ?? null;
        if (problem !== null) throw new CommandRejection(problem === 'forbidden' || problem === 'operation_conflict' ? 'invalid_payload' : problem);
        await entries.write(tx, write);
        await recordChange(tx, { position: serverVersion, entityType: entries.entityType, entityId: id, operation: 'upsert',
          ownerPersonId: actor.personId, createdAt: at });
        changes.push(await canonicalAfterWrite(tx, entries, id));
      }
      return { changes, idMappings: [] };
    },
  };

  /**
   * Entfernt Dateien der Ablage, zu denen kein Entwurf und kein nicht gelöschtes Mahlzeitenfoto gehört:
   * das Bild eines bestätigten Entwurfs, Fotos nach dem Löschen und Reste abgebrochener Schreibvorgänge.
   * Ein laufender Schreibvorgang hat immer schon seine Zeile, ein laufendes Bestätigen seinen Entwurf.
   * Eine Abfrage je Schlüssel sieht Entwurf und Foto im selben Snapshot; idempotent.
   */
  async function cleanUpStorage() {
    const stored = await storage.storedKeys();
    for (const imageKey of stored.drafts) {
      const [draft] = await database.db.select({ id: photoDraft.id }).from(photoDraft).where(eq(photoDraft.imageKey, imageKey)).limit(1);
      if (draft === undefined) await storage.deleteDraft(imageKey);
    }
    for (const imageKey of stored.photos) {
      const [owner] = await database.db
        .select({ id: photoDraft.id })
        .from(photoDraft)
        .where(eq(photoDraft.imageKey, imageKey))
        .union(database.db.select({ id: mealPhoto.id }).from(mealPhoto).where(and(eq(mealPhoto.imageKey, imageKey), isNull(mealPhoto.deletedAt))))
        .limit(1);
      if (owner === undefined) await storage.deletePhoto(imageKey);
    }
  }

  const storageCleanupJob: Job = { name: 'fotoablage_aufraeumen', intervalMs: STORAGE_CLEANUP_INTERVAL_MS, run: cleanUpStorage };

  return { entity, confirmCommand, storageCleanupJob };
}

export type MealPhotos = ReturnType<typeof createMealPhotos>;
