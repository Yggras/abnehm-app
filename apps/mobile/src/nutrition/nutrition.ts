import type { Clock } from '@abnehm/clock';
import { EntityId, type LocalDate, type MealKey } from '@abnehm/contracts/base';
import {
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
import type { CatalogDatabase, LocalDatabase, ReadContext } from '../local-db';
import { readOwnPerson, requireOwnPerson } from '../local-db/person-header';
import type { OnlineResult } from '../online/online-result';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { amountPrefill, type AmountPrefill } from './amount-prefill';
import { createBlsCatalog } from './bls-catalog';
import { createCurrentFoods, type CurrentFoods } from './current-foods';
import { readDayLog, readEntryDetail, type DayLog, type EntryDetail } from './day-log';
import { addEntry, deleteEntry, undoEntry, updateEntry, type EntryChange, type EntryUndo, type NewEntry } from './entries';
import { latestAmountOf } from './entry-repository';
import { favoriteFoods, isFoodFavorite, markFoodFavorite, refreshFoodFavorites, unmarkFoodFavorite, type FavoriteFood, type FavoriteTarget } from './food-favorites';
import { createFoodSearch, type FoodSearch } from './food-search';
import { confirmPhotoDraft, deletePhoto, readMealPhotoDetail, setPhotoSharing, type MealPhotoDetail, type PhotoDraftConfirmation } from './meal-photos';
import type { MealPhotoImage, MealPhotoImages } from './photo-images';
import { overlaidOrigins, searchOwnFoods, type OwnFoodChoice } from './own-food-repository';
import { deleteOwnFood, saveOwnFood, type OwnFoodBase } from './own-foods';
import { recentFoods, type QuickFoods } from './quick-foods';

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
  /** Bildabruf eigener Mahlzeitenfotos über den Server (`createHttpMealPhotoImages`); Tests geben einen Fake. */
  photoImages: MealPhotoImages;
  /**
   * Ob das Gerät Internet hat: zuerst der bekannte Stand, danach jede Änderung; ohne bekannten Stand meldet
   * es nichts. Offline zeigt das Protokoll nur das Foto-/KI-Symbol (Spezifikation 2, Abschnitt 9).
   */
  observeOnline: (listener: (online: boolean) => void) => () => void;
}>;


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
  /** Ob das Gerät Internet hat: zuerst der bekannte Stand, danach jede Änderung. */
  observeOnline(listener: (online: boolean) => void): () => void;
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
   * die Lebensmittel dieses Kontos; „Zuletzt verwendet“ gilt für die gewählte Mahlzeit. Jede Suche liest
   * den aktuellen Stand.
   */
  foodSearch(catalog: CatalogDatabase, meal: MealKey): FoodSearch;
  /**
   * Beobachtet „Zuletzt verwendet“ der Mahlzeit und die Lebensmittelfavoriten (Spezifikation 2, Abschnitt
   * 7), je vollständig und in Rangfolge, mit vorbelegter Menge: sofort und nach jedem Commit der
   * Kontodatenbank. `null`, bis die eigene Person mit dem ersten Pull angekommen ist.
   */
  observeQuickFoods(catalog: CatalogDatabase, meal: MealKey, listener: (foods: QuickFoods | null) => void): () => void;
  /**
   * „Verwenden“ eines Lebensmittels, für das ein Favorit steht, in einer eigenen lokalen Transaktion: Ist
   * die Referenz des Favoriten verfügbar, wird seine gespeicherte Fassung auf ihre aktuellen Werte gebracht.
   */
  recordFavoriteUse(catalog: CatalogDatabase, ref: FoodRef): void;
  /**
   * Beobachtet, ob ein Lebensmittelfavorit für dieses Lebensmittel steht, auch über eine Überdeckung. Eine
   * KI-Schätzung ohne Referenz steht für das eigene Lebensmittel, das ein früheres Markieren aus ihr angelegt hat.
   */
  observeFoodFavorite(food: FavoriteTarget, listener: (marked: boolean) => void): () => void;
  /**
   * Markiert ein Lebensmittel als Lebensmittelfavorit in einer eigenen lokalen Transaktion samt
   * Outbox-Operation und liefert die Referenz des Favoriten. Eine KI-Schätzung ohne Referenz wird zuerst
   * zu einem eigenen Lebensmittel aus ihrem Snapshot. Wirft `InvalidNutritionInputError`, ohne zu schreiben.
   */
  markFoodFavorite(food: FavoriteFood): FoodRef;
  /** Entfernt die Markierung in einer eigenen lokalen Transaktion; ein erneutes Markieren bleibt möglich. */
  unmarkFoodFavorite(food: FavoriteTarget): void;
}>;

/**
 * App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1) über der Datenbank eines Kontos. Bildschirme
 * sprechen nur mit dieser Schnittstelle, nie direkt mit Drizzle, SQLite oder Netzwerk.
 */
export function createNutrition(dependencies: NutritionDependencies): Nutrition {
  const { database } = dependencies;
  const tokens = createUndoTokens();
  const currentFoods = new WeakMap<CatalogDatabase, CurrentFoods>();
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
    mealPhotoImage: (photoId, variant) => dependencies.photoImages(photoId, variant),
    observeOnline: (listener) => dependencies.observeOnline(listener),
    setPhotoSharing: (photoId, sharedWithPartner) => database.transaction((tx) => setPhotoSharing(tx, dependencies, photoId, sharedWithPartner)),
    deletePhoto: (photoId) => database.transaction((tx) => deletePhoto(tx, dependencies, photoId)),
    prefillAmount: (foodRef, snapshot) =>
      amountPrefill(snapshot, database.read((tx) => latestAmountOf(tx, EntityId.parse(requireOwnPerson(tx).id), foodRef))),
    saveOwnFood: (base, values) => database.transaction((tx) => saveOwnFood(tx, dependencies, base, values)),
    deleteOwnFood: (id) => database.transaction((tx) => deleteOwnFood(tx, dependencies, id)),
    foodSearch: (catalog, meal) =>
      createFoodSearch({
        catalog,
        account: {
          search: (query, limit) => database.read((tx) => searchOwnFoods(tx, query, limit)),
          overlaidOrigins: () => database.read(overlaidOrigins),
          quickFoods: () => database.read((tx) => quickFoodsOf(tx, catalog, meal)) ?? { recent: [], favorites: [] },
        },
      }),
    observeQuickFoods: (catalog, meal, listener) => database.observe((tx) => quickFoodsOf(tx, catalog, meal), listener),
    recordFavoriteUse: (catalog, ref) =>
      database.transaction((tx) => refreshFoodFavorites(tx, dependencies, currentFoodsOf(catalog), ref)),
    observeFoodFavorite: (food, listener) => database.observe((tx) => readOwnPerson(tx) !== undefined && isFoodFavorite(tx, food), listener),
    markFoodFavorite: (food) => database.transaction((tx) => markFoodFavorite(tx, dependencies, food)),
    unmarkFoodFavorite: (food) => database.transaction((tx) => unmarkFoodFavorite(tx, dependencies, food)),
  };

  /** Auflösung der Referenzen über diesem Katalog; je Katalog einmal gebaut. */
  function currentFoodsOf(catalog: CatalogDatabase): CurrentFoods {
    let foods = currentFoods.get(catalog);
    if (foods === undefined) currentFoods.set(catalog, (foods = createCurrentFoods(createBlsCatalog(catalog))));
    return foods;
  }

  /** Beide Listen des Hinzufügen-Bildschirms; `null` ohne eigene Person. „Zuletzt verwendet“ endet heute. */
  function quickFoodsOf(tx: ReadContext, catalog: CatalogDatabase, meal: MealKey): QuickFoods | null {
    const person = readOwnPerson(tx);
    if (person === undefined) return null;
    const personId = EntityId.parse(person.id);
    const foods = currentFoodsOf(catalog);
    return { recent: recentFoods(tx, foods, personId, meal, dependencies.clock.read().localDate), favorites: favoriteFoods(tx, foods, personId) };
  }
}
