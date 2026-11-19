import { and, eq, isNull } from 'drizzle-orm';

import { EntityId, Instant, type LocalDate, type MealKey } from '@abnehm/contracts/base';
import {
  ConfirmPhotoDraft,
  confirmPhotoDraftKey,
  dailyIntakeKcal,
  MealPhotoRecord,
  MealPhotoUpsert,
  type DisplayUnit,
  type FoodRef,
  type NutritionEntryAddedValues,
  type NutritionSnapshot,
} from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson, requireOwnPerson } from '../local-db/person-header';
import { coupling, couplingMember, mealPhoto } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sqliteEntity, type LocalCommand, type SyncEntityAdapter } from '../sync';
import { InvalidNutritionInputError, newEntryPayload, type EntryDependencies } from './entries';
import { nutritionEntryEntity } from './entry-entity';
import { removeUnconfirmedEntry, unlinkPhoto, writeEntry } from './entry-repository';
import { readPhoto, tombstonePhoto, writeSharing, type StoredPhoto } from './photo-repository';

// Fotoentwurf bestätigen und Mahlzeitenfoto in der App (Spezifikation 2, Abschnitte 8, 9 und 11; #162).
// Bestätigen legt in einer Transaktion die Einträge, das Mahlzeitenfoto, die Outbox-Operation des
// Fachbefehls `confirmPhotoDraft` und die Tagesmeldung an. Die Bilddatei liegt nur auf dem Server; das
// Gerät kennt nur die Metadaten. Legt der Server das Foto nicht an (Entwurf abgelaufen, fremd oder schon
// bestätigt), entfernt die App ihr Foto wieder; die Einträge bleiben, wie der Server sie bestätigt.
//
// Eigene Fotos ansehen, freigeben und löschen (#164): Die Fotoansicht liest Freigabeschalter und Kopplung
// aus SQLite. „Mit Partner teilen“ ist ein generisches Upsert, „Foto löschen“ ein Tombstone; beide ändern
// keinen Eintrag und keine Tagesaufnahme, deshalb meldet keiner von beiden Tage an die Tagesziele.

/** Die Fotoansicht eines eigenen Mahlzeitenfotos. */
export type MealPhotoDetail = Readonly<{
  id: EntityId;
  sharedWithPartner: boolean;
  /** Nur bei aktiver Kopplung zeigt die Fotoansicht den Schalter „Mit Partner teilen“ (Spezifikation 2, Abschnitt 9). */
  partnerCoupled: boolean;
}>;

/** Ob die eigene Person aktives Mitglied einer Kopplung ist, aus den gepullten Kopplungszeilen. */
function partnerCoupled(tx: ReadContext, personId: EntityId): boolean {
  const membership = sqliteOf(tx)
    .select({ id: couplingMember.id })
    .from(couplingMember)
    .innerJoin(coupling, eq(coupling.id, couplingMember.couplingId))
    .where(and(eq(couplingMember.personId, personId), eq(coupling.status, 'aktiv'), isNull(couplingMember.deletedAt)))
    .get();
  return membership !== undefined;
}

/** Ein eigenes, nicht gelöschtes Mahlzeitenfoto; sonst `undefined`. */
function ownLivingPhoto(tx: ReadContext, photoId: EntityId): StoredPhoto | undefined {
  const own = readOwnPerson(tx);
  const photo = readPhoto(tx, photoId);
  return own !== undefined && photo?.personId === own.id && photo.deletedAt === null ? photo : undefined;
}

/** Die Fotoansicht; `null` für ein fremdes, unbekanntes oder gelöschtes Foto. */
export function readMealPhotoDetail(tx: ReadContext, photoId: EntityId): MealPhotoDetail | null {
  const photo = ownLivingPhoto(tx, photoId);
  if (photo === undefined) return null;
  return { id: photo.id, sharedWithPartner: photo.sharedWithPartner, partnerCoupled: partnerCoupled(tx, photo.personId) };
}

function requireOwnLivingPhoto(tx: ReadContext, photoId: EntityId): StoredPhoto {
  const photo = ownLivingPhoto(tx, photoId);
  if (photo === undefined) throw new InvalidNutritionInputError(`Mahlzeitenfoto ${photoId} ist unbekannt, gelöscht oder nicht das eigene`);
  return photo;
}

/**
 * „Mit Partner teilen“ ein- oder ausschalten: generisches Upsert des Freigabeschalters (Spezifikation 2,
 * Abschnitt 11). Wirft `InvalidNutritionInputError`, ohne zu schreiben, für ein fremdes, unbekanntes oder
 * gelöschtes Foto. Ein unveränderter Schalter schreibt nichts.
 */
export function setPhotoSharing(
  tx: TransactionContext,
  { clock, writer }: Pick<EntryDependencies, 'clock' | 'writer'>,
  photoId: EntityId,
  sharedWithPartner: boolean,
): void {
  const photo = requireOwnLivingPhoto(tx, photoId);
  if (photo.sharedWithPartner === sharedWithPartner) return;
  writeSharing(tx, photoId, sharedWithPartner, Instant.parse(clock.read().instant));
  writer.upsert(tx, { entityType: mealPhotoEntity.entityType, entityId: photoId, payload: { sharedWithPartner }, knownServerVersion: photo.serverVersion });
}

/**
 * „Foto löschen“: Tombstone des Mahlzeitenfotos (Spezifikation 2, Abschnitt 9). Die Einträge bleiben samt
 * Verknüpfung; der Server löscht die Bilddateien beim Übernehmen. Endgültig, ein „Rückgängig“ gibt es
 * nicht. Wirft `InvalidNutritionInputError`, ohne zu schreiben, für ein fremdes, unbekanntes oder schon
 * gelöschtes Foto.
 */
export function deletePhoto(tx: TransactionContext, { clock, writer }: Pick<EntryDependencies, 'clock' | 'writer'>, photoId: EntityId): void {
  const photo = requireOwnLivingPhoto(tx, photoId);
  tombstonePhoto(tx, photoId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: mealPhotoEntity.entityType, entityId: photoId, knownServerVersion: photo.serverVersion });
}

/** Ein Bestandteil der Mahlzeit, wie ihn der Fotoentwurf-Bildschirm bestätigt; Menge und Summen rechnet das Modul. */
export type PhotoMealComponent = Readonly<{
  /** `null` für einen KI-Bestandteil, sonst die Referenz des Suchergebnisses, das ihn ersetzt. */
  foodRef: FoodRef | null;
  /** KI-Snapshot (`photoDraftSnapshot`) oder der Snapshot des Ersatzes. */
  snapshot: NutritionSnapshot;
  displayUnit: DisplayUnit;
  /** Menge in Tausendsteln der Anzeigeeinheit. */
  displayAmountMilli: number;
}>;

/** „Mahlzeit hinzufügen“ im Fotoentwurf. */
export type PhotoDraftConfirmation = Readonly<{
  draftId: EntityId;
  /** Der im Protokoll gewählte Tag; künftige Tage sind nicht erreichbar. */
  localDate: LocalDate;
  meal: MealKey;
  /** „Mit Partner teilen“; ohne Angabe an (#22). */
  sharedWithPartner?: boolean;
  components: readonly PhotoMealComponent[];
}>;

/** Bildschlüssel des Fotos, solange der Server es nicht bestätigt hat; das Bild liegt noch im Entwurf. */
const pendingImageKey = (draftId: EntityId) => `entwurf:${draftId}`;

/**
 * Bestätigt einen Fotoentwurf als Mahlzeit: Einträge mit Erfassungsart `foto`, das Mahlzeitenfoto und
 * genau eine Outbox-Operation `confirmPhotoDraft`. Erfassungszeitpunkt, Zone und Offset stammen aus
 * derselben Ablesung der Uhr. Wirft `InvalidNutritionInputError`, ohne etwas zu schreiben.
 */
export function confirmPhotoDraft(
  tx: TransactionContext,
  { clock, writer, persistence, newId }: EntryDependencies,
  input: PhotoDraftConfirmation,
): NutritionEntryAddedValues {
  const reading = clock.read();
  const photoId = newId();
  const entries = input.components.map((component) => ({
    id: newId(),
    entry: newEntryPayload(reading, { localDate: input.localDate, meal: input.meal, captureMethod: 'foto', ...component }, photoId),
  }));
  const parsed = ConfirmPhotoDraft.safeParse({ draftId: input.draftId, photoId, sharedWithPartner: input.sharedWithPartner ?? true, entries });
  if (!parsed.success) throw new InvalidNutritionInputError(`Ungültige Fotomahlzeit: ${parsed.error.message}`);

  const payload = parsed.data;
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const at = Instant.parse(reading.instant);
  sqliteOf(tx)
    .insert(mealPhoto)
    .values({ id: photoId, personId, imageKey: pendingImageKey(payload.draftId), capturedAt: at, sharedWithPartner: payload.sharedWithPartner,
      createdAt: at, updatedAt: at })
    .run();
  for (const { id, entry } of payload.entries) writeEntry(tx, id, personId, entry, at);
  writer.command(tx, {
    type: 'confirmPhotoDraft',
    businessKey: confirmPhotoDraftKey(payload.draftId),
    payload,
    knownServerVersion: null,
    affectedRefs: [
      { entityType: mealPhotoEntity.entityType, entityId: photoId },
      ...payload.entries.map(({ id }) => ({ entityType: nutritionEntryEntity.entityType, entityId: id })),
    ],
    referencePaths: [],
  });
  persistence.reevaluateDailyGoals(tx, personId, [input.localDate], 'eingabe');
  return { meal: input.meal, kcal: dailyIntakeKcal(payload.entries.map(({ entry }) => entry.totals.milliKcal)) };
}

/** Entfernt ein Mahlzeitenfoto, das der Server nie bestätigt hat, und löst seine Einträge davon. */
function removeUnconfirmedPhoto(tx: TransactionContext, photoId: EntityId): void {
  const photo = readPhoto(tx, photoId);
  if (photo === undefined || photo.serverVersion !== null) return;
  unlinkPhoto(tx, photoId);
  sqliteOf(tx).delete(mealPhoto).where(eq(mealPhoto.id, photoId)).run();
}

/**
 * Der Fachbefehl `confirmPhotoDraft` für die lokale Befehls-Registry. Erzeugen darf ihn nur das Modul
 * (`Nutrition.confirmPhotoDraft`). Nach der Bestätigung gilt der kanonische Stand des Servers: ohne
 * Foto im Ergebnis entfernt die App ihr Foto. Eine Ablehnung entfernt alles, was der Server nie
 * bestätigt hat, und meldet den Tag erneut.
 */
export function confirmPhotoDraftCommand({ persistence }: Pick<EntryDependencies, 'persistence'>): LocalCommand<ConfirmPhotoDraft> {
  return {
    type: 'confirmPhotoDraft',
    payload: ConfirmPhotoDraft,
    referencePaths: [],
    apply() {
      throw new Error('confirmPhotoDraft erzeugt nur das Ernährungsmodul');
    },
    reconcileApplied(tx, operation, result) {
      const { photoId } = ConfirmPhotoDraft.parse(operation.payload);
      const confirmed = (result.changes ?? []).some((change) => change.entityType === mealPhotoEntity.entityType && change.entityId === photoId);
      if (!confirmed) removeUnconfirmedPhoto(tx, photoId);
    },
    reconcileRejected(tx, operation) {
      const { photoId, entries } = ConfirmPhotoDraft.parse(operation.payload);
      for (const { id } of entries) removeUnconfirmedEntry(tx, id);
      removeUnconfirmedPhoto(tx, photoId);
      const localDate = entries[0]?.entry.localDate;
      if (localDate !== undefined) persistence.reevaluateDailyGoals(tx, EntityId.parse(requireOwnPerson(tx).id), [localDate], 'pull');
    },
  };
}

/**
 * Das Mahlzeitenfoto im Sync (Spezifikation 2, Abschnitt 11): Metadaten ohne Bilddatei; generisches
 * Upsert nur für „Mit Partner teilen“, Löschen als Tombstone. Ein neues Foto entsteht nur mit
 * `confirmPhotoDraft`.
 */
export const mealPhotoEntity: SyncEntityAdapter<MealPhotoUpsert, MealPhotoRecord> = sqliteEntity({
  entityType: 'meal_photo',
  ownerField: 'personId',
  upsert: MealPhotoUpsert,
  deletable: true,
  record: MealPhotoRecord,
  table: mealPhoto,
  row: (entityId, record) => ({ ...record, id: entityId }),
  replay(tx, entityId, change) {
    const at = Instant.parse(change.createdAt);
    const fields = change.type === 'upsert_entity' ? { sharedWithPartner: change.payload.sharedWithPartner, updatedAt: at } : { deletedAt: at, updatedAt: at };
    sqliteOf(tx).update(mealPhoto).set(fields).where(eq(mealPhoto.id, entityId)).run();
  },
});
