import type { Clock } from '@abnehm/clock';
import { EntityId, type LocalDate } from '@abnehm/contracts/base';
import {
  entryAmount,
  type DisplayUnit,
  type FoodRef,
  type FoodValues,
  type NutritionEntryAddedOutcome,
  type NutritionEntryAddedValues,
  type NutritionEntryDeletedOutcome,
  type NutritionEntryUpdatedOutcome,
  type NutritionSnapshot,
  type MealPhotoVariant,
} from '@abnehm/contracts/nutrition';

import type { DailyGoalPersistence } from '../daily-goals';
import type { CatalogDatabase, LocalDatabase } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import type { OnlineResult } from '../online/online-result';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { defaultAmountMilli } from './amount-input';
import { readDayLog, readEntryDetail, type DayLog, type EntryDetail } from './day-log';
import { addEntry, deleteEntry, undoEntry, updateEntry, type EntryChange, type EntryUndo, type NewEntry } from './entries';
import { latestAmountOf } from './entry-repository';
import { createFoodSearch, type FoodSearch } from './food-search';
import { confirmPhotoDraft, deletePhoto, readMealPhotoDetail, setPhotoSharing, type MealPhotoDetail, type PhotoDraftConfirmation } from './meal-photos';
import type { MealPhotoImage, MealPhotoImages } from './photo-images';
import { overlaidOrigins, searchOwnFoods, type OwnFoodChoice } from './own-food-repository';
import { deleteOwnFood, saveOwnFood, type OwnFoodBase } from './own-foods';

export type NutritionDependencies = Readonly<{
  /** Die geöffnete Kontodatenbank; jeder Befehl ist genau eine Transaktion darin. */
  database: LocalDatabase;
  /** Erfassungszeitpunkt, Zone und Offset neuer Einträge sowie „heute“. */
  clock: Clock;
  /** Schreibt die Outbox-Operation in der Transaktion des Befehls. */
  writer: SyncWriter;
  /** Persistenzdienst der Tagesziele; jeder Befehl meldet seine Tage in derselben Transaktion. */
  persistence: Pick<DailyGoalPersistence, 'reevaluateDailyGoals'>;
  newId: () => EntityId;
  /**
   * Bildabruf eigener Mahlzeitenfotos über den Server (`createHttpMealPhotoImages`). Ohne ihn, etwa in
   * Tests ohne Server, ist jedes Foto `offline`: Das Protokoll zeigt dann nur das Foto-/KI-Symbol.
   */
  photoImages?: MealPhotoImages;
}>;

/** Vorbelegung der Mengenprüfung: Anzeigeeinheit und Menge in Tausendsteln. */
export type AmountPrefill = Readonly<{ displayUnit: DisplayUnit; displayAmountMilli: number }>;

export type Nutrition = Readonly<{
  /**
   * Legt einen Eintrag an, in einer eigenen lokalen Transaktion. Das Ergebnis enthält Meldung, Werte
   * und einen flüchtigen Undo-Token für „Rückgängig“. Wirft `InvalidNutritionInputError` bei einer
   * ungültigen Menge, einem künftigen Tag oder einem inkonsistenten Eintrag, ohne etwas zu schreiben.
   */
  addEntry(input: NewEntry): NutritionEntryAddedOutcome;
  /**
   * „Mahlzeit hinzufügen“ im Fotoentwurf (Spezifikation 2, Abschnitt 8): legt in einer eigenen lokalen
   * Transaktion die Einträge (Erfassungsart `foto`), das Mahlzeitenfoto und genau eine Operation
   * `confirmPhotoDraft` an. Liefert Mahlzeit und gerundete kcal für die Meldung. Wirft
   * `InvalidNutritionInputError` bei einer ungültigen Menge, einem künftigen Tag oder einer
   * inkonsistenten Mahlzeit, ohne etwas zu schreiben.
   */
  confirmPhotoDraft(input: PhotoDraftConfirmation): NutritionEntryAddedValues;
  /**
   * Ändert Menge, Einheit und Mahlzeit eines Eintrags in einer eigenen lokalen Transaktion; die Summen
   * entstehen aus demselben Snapshot neu, der Tag bleibt. Das Ergebnis enthält Meldung und Undo-Token.
   * Wirft `InvalidNutritionInputError` bei einer ungültigen Menge oder einem unbekannten oder gelöschten
   * Eintrag, ohne etwas zu schreiben.
   */
  updateEntry(entryId: EntityId, change: EntryChange): NutritionEntryUpdatedOutcome;
  /**
   * Löscht einen Eintrag ohne Bestätigungsdialog in einer eigenen lokalen Transaktion. „Rückgängig“ legt
   * einen neuen Eintrag mit neuer ID und identischem Inhalt an. Wirft `InvalidNutritionInputError` für
   * einen unbekannten oder schon gelöschten Eintrag.
   */
  deleteEntry(entryId: EntityId): NutritionEntryDeletedOutcome;
  /**
   * „Rückgängig“ zu einem Token aus `addEntry`, `updateEntry` oder `deleteEntry`: höchstens einmal, in einer
   * eigenen Transaktion.
   */
  undo(undoToken: string): UndoOutcome;
  /** Beendet einen Token, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(undoToken: string): void;
  /**
   * Beobachtet das Tagesprotokoll samt Tagesaufnahme eines lokalen Tags: sofort und nach jedem Commit
   * der Kontodatenbank. `null`, bis die eigene Person mit dem ersten Pull angekommen ist.
   */
  observeDayLog(localDate: LocalDate, listener: (log: DayLog | null) => void): () => void;
  /** Ein nicht gelöschter eigener Eintrag für die Mengenansicht; sonst `null`. */
  entryDetail(entryId: EntityId): EntryDetail | null;
  /**
   * Beobachtet die Fotoansicht eines eigenen Mahlzeitenfotos (Spezifikation 2, Abschnitt 9): Freigabeschalter
   * und ob eine Kopplung besteht; `null`, sobald das Foto gelöscht, fremd oder unbekannt ist.
   */
  observeMealPhoto(photoId: EntityId, listener: (photo: MealPhotoDetail | null) => void): () => void;
  /**
   * Ruft ein eigenes Mahlzeitenfoto online als Vorschau oder vergrößert ab. Das Bild bleibt nur im
   * Speicher; ohne Netz ist das Ergebnis `offline`.
   */
  mealPhotoImage(photoId: EntityId, variant: MealPhotoVariant): Promise<OnlineResult<MealPhotoImage>>;
  /**
   * „Mit Partner teilen“ eines eigenen Mahlzeitenfotos in einer eigenen lokalen Transaktion samt Outbox-
   * Operation. Wirft `InvalidNutritionInputError` für ein fremdes, unbekanntes oder gelöschtes Foto.
   */
  setPhotoSharing(photoId: EntityId, sharedWithPartner: boolean): void;
  /**
   * „Foto löschen“ (Tombstone) in einer eigenen lokalen Transaktion; die Einträge bleiben. Endgültig, ohne
   * „Rückgängig“. Wirft `InvalidNutritionInputError` für ein fremdes, unbekanntes oder gelöschtes Foto.
   */
  deletePhoto(photoId: EntityId): void;
  /**
   * Vorbelegung der Mengenprüfung (Spezifikation 2, Abschnitt 6): die letzte Menge und Einheit dieses
   * Lebensmittels aus den eigenen Einträgen, sonst eine bekannte Portion, sonst 100 g bzw. 100 ml.
   */
  prefillAmount(foodRef: FoodRef, snapshot: NutritionSnapshot): AmountPrefill;
  /**
   * Speichert ein eigenes Lebensmittel (Spezifikation 2, Abschnitt 3) in einer eigenen lokalen
   * Transaktion samt Outbox-Operation. `base` ist `null` für ein neues, ein eigenes Lebensmittel für
   * genau dieses oder ein BLS-Lebensmittel, aus dem ein eigenes mit dieser Herkunftsreferenz wird; die externen
   * Daten bleiben unverändert. Liefert Referenz und neue Fassung für künftige Einträge; gespeicherte
   * Einträge behalten ihren Snapshot. Wirft `InvalidNutritionInputError`, ohne etwas zu schreiben.
   */
  saveOwnFood(base: OwnFoodBase, values: FoodValues): OwnFoodChoice;
  /** Löscht ein eigenes Lebensmittel (Tombstone); Einträge bleiben über ihren Snapshot nutzbar. */
  deleteOwnFood(id: EntityId): void;
  /**
   * Die lokale Lebensmittelsuche (Spezifikation 2, Abschnitt 4) über den geöffneten BLS-Katalog und
   * die eigenen Lebensmittel dieses Kontos. Jede Suche liest den aktuellen Stand.
   */
  foodSearch(catalog: CatalogDatabase): FoodSearch;
}>;

/**
 * App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1) über der Datenbank eines Kontos. Bildschirme
 * sprechen nur mit dieser Schnittstelle, nie direkt mit Drizzle, SQLite oder Netzwerk.
 */
export function createNutrition(dependencies: NutritionDependencies): Nutrition {
  const { database } = dependencies;
  const tokens = createUndoTokens();
  /** Meldung und Werte eines Befehls nach seiner Transaktion, samt Undo-Token. */
  const outcome = <K extends string, V>({ messageKey, values, undo }: Readonly<{ messageKey: K; values: V; undo: EntryUndo }>) => ({
    messageKey,
    values,
    undoToken: tokens.issue(database, (tx) => undoEntry(tx, dependencies, undo)),
  });

  return {
    addEntry: (input) => outcome(database.transaction((tx) => addEntry(tx, dependencies, input))),
    updateEntry: (entryId, change) => outcome(database.transaction((tx) => updateEntry(tx, dependencies, entryId, change))),
    deleteEntry: (entryId) => outcome(database.transaction((tx) => deleteEntry(tx, dependencies, entryId))),
    confirmPhotoDraft: (input) => database.transaction((tx) => confirmPhotoDraft(tx, dependencies, input)),
    undo: (undoToken) => tokens.undo(undoToken),
    expire: (undoToken) => tokens.expire(undoToken),
    observeDayLog: (localDate, listener) => database.observe((tx) => readDayLog(tx, localDate), listener),
    entryDetail: (entryId) => database.read((tx) => readEntryDetail(tx, entryId)),
    observeMealPhoto: (photoId, listener) => database.observe((tx) => readMealPhotoDetail(tx, photoId), listener),
    mealPhotoImage: (photoId, variant) => dependencies.photoImages?.(photoId, variant) ?? Promise.resolve({ type: 'offline' }),
    setPhotoSharing: (photoId, sharedWithPartner) => database.transaction((tx) => setPhotoSharing(tx, dependencies, photoId, sharedWithPartner)),
    deletePhoto: (photoId) => database.transaction((tx) => deletePhoto(tx, dependencies, photoId)),
    prefillAmount(foodRef, snapshot) {
      const latest = database.read((tx) => latestAmountOf(tx, EntityId.parse(requireOwnPerson(tx).id), foodRef));
      // Die letzte Menge gilt nur, wenn ihre Einheit im aktuellen Snapshot noch bekannt ist.
      if (latest !== undefined && entryAmount(snapshot, latest.displayUnit, latest.displayAmountMilli).type === 'menge') return latest;
      const portion = snapshot.portions.find((conversion) => conversion.unit === 'portion') ?? snapshot.portions[0];
      const displayUnit = portion?.unit ?? snapshot.baseUnit;
      return { displayUnit, displayAmountMilli: defaultAmountMilli(snapshot, displayUnit) };
    },
    saveOwnFood: (base, values) => database.transaction((tx) => saveOwnFood(tx, dependencies, base, values)),
    deleteOwnFood: (id) => database.transaction((tx) => deleteOwnFood(tx, dependencies, id)),
    foodSearch: (catalog) =>
      createFoodSearch({
        catalog,
        ownFoods: {
          search: (query, limit) => database.read((tx) => searchOwnFoods(tx, query, limit)),
          overlaidOrigins: () => database.read(overlaidOrigins),
        },
      }),
  };
}
