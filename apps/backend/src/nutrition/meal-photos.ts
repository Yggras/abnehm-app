import { and, eq, gt, isNull, lte, notExists, or } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';
import type { ContractError } from '@abnehm/contracts/errors';
import { ConfirmPhotoDraft, confirmPhotoDraftKey, MealPhotoRecord, MealPhotoUpsert, MealPhotoVariant } from '@abnehm/contracts/nutrition';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { guard, policies } from '../authorization/authorization.ts';
import type { Database, DbExecutor } from '../database.ts';
import { mealPhoto, nutritionEntry, photoDraft } from '../db/schema/index.ts';
import type { Job } from '../jobs/job-registry.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { ownedEntity, type ServerSyncEntity } from '../sync/registry.ts';
import { canonicalAfterWrite, upsertEntity } from '../sync/sync.ts';
import { mealPhotoImages } from './photo-image.ts';
import type { PhotoStorage } from './photo-storage.ts';

// Mahlzeitenfotos auf dem Server (Spezifikation 2, Abschnitte 8, 9 und 11; #162, #164). Ein Mahlzeitenfoto
// entsteht nur mit dem Fachbefehl `confirmPhotoDraft`: Er legt immer alle Einträge an und, solange der
// Entwurf gültig, eigen und nicht abgelaufen ist, das Foto samt Vorschau und vergrößerter Fassung in
// der Fotoablage. Andernfalls bleiben die Einträge ohne Foto, damit keine bestätigte Mahlzeit verloren
// geht. Der Sync kennt für das Foto nur den Freigabeschalter (Upsert) und die Löschmarkierung.
//
// Die Eigentümerin ruft ihre Fotos online über einen eigenen Endpunkt ab (#164). „Foto löschen“ ist ein
// Tombstone: Beim Übernehmen löscht der Server beide Fassungen sofort aus der Fotoablage, die Einträge
// bleiben. Ein Foto, das seit 24 Stunden mit keinem nicht gelöschten Eintrag mehr verknüpft ist, setzt
// ein Aufräumjob auf Tombstone; bis dahin kann „Rückgängig“ es wieder verknüpfen.
//
// Atomar ist der Übergang über Postgres: Das Foto gilt erst mit dem Commit, der zugleich den Entwurf
// löscht. Die Dateien entstehen davor unter dem Bildschlüssel des Entwurfs; rollt die Transaktion
// zurück, besteht der Entwurf fort und ein Retry findet dieselben Dateien. Dateien, zu denen weder ein
// Entwurf noch ein nicht gelöschtes Mahlzeitenfoto gehört, entfernt der Aufräumjob der Fotoablage.

/** Ein bestätigbarer Fotoentwurf samt seinem Bild. */
type ValidDraft = typeof photoDraft.$inferSelect & Readonly<{ image: Uint8Array }>;

/** Abstand der Aufräumläufe der Fotoablage (Designwert, nicht belegt), wie bei den Fotoentwürfen. */
const STORAGE_CLEANUP_INTERVAL_MS = 5 * 60_000;

/** Abstand der Läufe für verwaiste Fotos (Designwert, nicht belegt), wie bei den übrigen Fotojobs. */
const ORPHAN_CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * So lange bleibt ein Foto ohne nicht gelöschten Eintrag bestehen, damit „Rückgängig“ es wieder verknüpfen
 * kann (Spezifikation 2, Abschnitt 9).
 */
const ORPHAN_AFTER_MS = 24 * 60 * 60_000;

/** Antwort auf eine unbekannte Fassung. */
const invalidVariant = { code: 'invalid_payload', retryable: false } as const satisfies ContractError;

/**
 * Antwort-Header des Bildabrufs: JPEG, nie als etwas anderes interpretiert und nicht cachebar (`no-store`,
 * RFC 9111, Abschnitt 5.2.2.5, https://www.rfc-editor.org/rfc/rfc9111#name-no-store). Die App hält das Bild
 * nur im Speicher (Spezifikation 2, Abschnitt 9).
 */
const imageHeaders = { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

export function createMealPhotos({
  database,
  clock,
  storage,
  entries,
}: {
  database: Database;
  clock: Clock;
  storage: PhotoStorage;
  /** Die angemeldete Entität `nutrition_entry`: Der Befehl schreibt Einträge über ihren Schreibweg. */
  entries: ServerSyncEntity;
}) {
  /** Der Bildschlüssel eines Fotos, gleich ob gelöscht. */
  async function imageKeyOf(executor: DbExecutor, photoId: string): Promise<string | null> {
    const [row] = await executor.select({ imageKey: mealPhoto.imageKey }).from(mealPhoto).where(eq(mealPhoto.id, photoId));
    return row?.imageKey ?? null;
  }

  /** Die Entität nur mit Metadaten: Ihr Löschen setzt den Tombstone und lässt die Dateien liegen. */
  const tombstoneOnly: ServerSyncEntity = ownedEntity({
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

  const entity: ServerSyncEntity = {
    ...tombstoneOnly,
    /**
     * „Foto löschen“: Tombstone und sofort beide Fassungen aus der Fotoablage (Spezifikation 2, Abschnitt 9).
     * Die Dateien gehen schon im Savepoint der Operation. Rollt er danach zurück, bleibt ein Foto ohne
     * Dateien, bis der Tombstone erneut ankommt: Für die App ist er endgültig (Spezifikation 0, Abschnitt 10),
     * sie wiederholt ihn, bis der Server ihn übernimmt.
     */
    async remove(tx, removal) {
      await tombstoneOnly.remove(tx, removal);
      const imageKey = await imageKeyOf(tx, removal.entityId);
      if (imageKey !== null) await storage.deletePhoto(imageKey);
    },
  };

  /** Der Entwurf, sofern er der Person gehört, analysiert und nicht abgelaufen ist, samt seinem Bild. */
  async function validDraft(tx: DbExecutor, draftId: string, personId: string, at: Date): Promise<ValidDraft | null> {
    // Sperrt den Entwurf gegen den Aufräumjob und eine zweite Bestätigung bis zum Ende der Transaktion.
    const [draft] = await tx.select().from(photoDraft).where(eq(photoDraft.id, draftId)).for('update');
    if (draft === undefined || draft.personId !== personId || draft.analysisState !== 'analysiert' || draft.expiresAt <= at) return null;
    const image = await storage.readDraft(draft.imageKey);
    return image === null ? null : { ...draft, image };
  }

  /** Legt das Foto in der Fotoablage und in Postgres an und löscht den Entwurf; `false`, wenn das Bild nicht taugt. */
  async function storePhoto(tx: DbExecutor, draft: ValidDraft, input: {
    photoId: EntityId; personId: EntityId; sharedWithPartner: boolean; at: Date;
  }): Promise<boolean> {
    let images: Awaited<ReturnType<typeof mealPhotoImages>>;
    try {
      images = await mealPhotoImages(draft.image);
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
    // Schlüssel ist der Entwurf: Ein Duplikat mit gleichem Inhalt ist der Retry derselben Bestätigung, eines
    // mit anderen IDs ein `operation_conflict`. Zuzuordnen gibt es deshalb nichts.
    duplicate: () => [],
    async execute(tx, { actor, payload, businessKey, at }) {
      if (businessKey !== confirmPhotoDraftKey(payload.draftId)) throw new CommandRejection('invalid_payload');
      const ids = payload.entries.map((item) => item.id);
      if ((await entries.read(tx, ids)).size > 0) throw new CommandRejection('conflict');

      const draft = await validDraft(tx, payload.draftId, actor.personId, at);
      const withPhoto = draft !== null && (await storePhoto(tx, draft, { photoId: payload.photoId, personId: actor.personId,
        sharedWithPartner: payload.sharedWithPartner, at }));

      const changes: CanonicalChange[] = withPhoto ? [await canonicalAfterWrite(tx, entity, payload.photoId)] : [];
      for (const { id, entry } of payload.entries) {
        // Derselbe Schreibweg wie beim generischen Upsert: Prüfung des Tags, Schreiben, Änderungsprotokoll.
        const problem = await upsertEntity(tx, entries, {
          entityId: id, payload: { ...entry, mealPhotoId: withPhoto ? payload.photoId : null }, ownerPersonId: actor.personId, at, exists: false,
        });
        if (problem !== null) throw new CommandRejection(problem === 'forbidden' || problem === 'operation_conflict' ? 'invalid_payload' : problem);
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

  /**
   * Ob ein nicht gelöschtes Foto seit `cutoff` verwaist ist: Es entstand davor, keiner seiner Einträge ist
   * ungelöscht, und keiner hat sich seither geändert. Das Löschen eines Eintrags setzt dessen `updated_at`;
   * der zuletzt gelöschte Eintrag bestimmt also, seit wann das Foto verwaist ist.
   */
  const orphanedSince = (cutoff: Date) =>
    and(
      isNull(mealPhoto.deletedAt),
      lte(mealPhoto.createdAt, cutoff),
      notExists(
        database.db
          .select({ id: nutritionEntry.id })
          .from(nutritionEntry)
          .where(and(eq(nutritionEntry.mealPhotoId, mealPhoto.id), or(isNull(nutritionEntry.deletedAt), gt(nutritionEntry.updatedAt, cutoff)))),
      ),
    );

  /**
   * Setzt jedes seit 24 Stunden verwaiste Foto auf Tombstone (Spezifikation 2, Abschnitt 9) und löscht nach
   * dem Commit seine Dateien. Die Zeile bleibt bis zum Commit gesperrt: Ein gleichzeitiger Eintrag, der auf
   * das Foto verweist, wartet über seinen Fremdschlüssel. Idempotent; scheitert das Löschen der Dateien,
   * holt es der Aufräumjob der Fotoablage nach.
   */
  async function tombstoneOrphans() {
    const at = new Date(clock.read().instant);
    const cutoff = new Date(at.getTime() - ORPHAN_AFTER_MS);
    const due = await database.db.select({ id: mealPhoto.id }).from(mealPhoto).where(orphanedSince(cutoff));
    for (const { id } of due) {
      const imageKey = await database.db.transaction(async (tx) => {
        const [photo] = await tx
          .select({ personId: mealPhoto.personId, imageKey: mealPhoto.imageKey })
          .from(mealPhoto)
          .where(and(eq(mealPhoto.id, id), orphanedSince(cutoff)))
          .for('update');
        if (photo === undefined) return null;
        const serverVersion = await nextServerVersion(tx);
        const ownerPersonId = EntityId.parse(photo.personId);
        // Ohne Dateien: Die löscht der Job erst nach dem Commit.
        await tombstoneOnly.remove(tx, { entityId: EntityId.parse(id), ownerPersonId, serverVersion, at });
        await recordChange(tx, { position: serverVersion, entityType: entity.entityType, entityId: id, operation: 'delete', ownerPersonId, createdAt: at });
        return photo.imageKey;
      });
      if (imageKey !== null) await storage.deletePhoto(imageKey);
    }
  }

  const orphanCleanupJob: Job = { name: 'verwaiste_mahlzeitenfotos', intervalMs: ORPHAN_CLEANUP_INTERVAL_MS, run: tombstoneOrphans };

  const routes = new Hono()
    /**
     * `GET /v1/nutrition/meal-photos/:id/:variant`: ein eigenes, nicht gelöschtes Mahlzeitenfoto als Vorschau
     * oder vergrößert (`OwnMealPhotoRequest`), als JPEG und nicht cachebar. Fremde und gelöschte Fotos
     * verweigert der Guard generisch, auch geteilte des Partners.
     */
    .get('/nutrition/meal-photos/:id/:variant', guard(policies.resource('meal_photo_own', 'lesen'), (c) => ({ id: c.req.param('id') })), async (c) => {
      const variant = MealPhotoVariant.safeParse(c.req.param('variant'));
      if (!variant.success) return c.json(invalidVariant, 400);
      const imageKey = await imageKeyOf(database.db, c.req.param('id'));
      const image = imageKey === null ? null : await storage.readPhoto(imageKey, variant.data);
      // Ohne Datei, etwa zwischen Löschen und Retry: kein Bild und nichts Cachebares.
      if (image === null) return c.body(null, 404, { 'cache-control': 'no-store' });
      return c.body(new Uint8Array(image), 200, imageHeaders);
    });

  return { entity, confirmCommand, routes, storageCleanupJob, orphanCleanupJob };
}

export type MealPhotos = ReturnType<typeof createMealPhotos>;
