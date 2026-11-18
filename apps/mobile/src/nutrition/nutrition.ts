import type { Clock } from '@abnehm/clock';
import { EntityId, type LocalDate } from '@abnehm/contracts/base';
import {
  entryAmount,
  type DisplayUnit,
  type FoodRef,
  type NutritionEntryAddedOutcome,
  type NutritionEntryAddedValues,
  type NutritionSnapshot,
} from '@abnehm/contracts/nutrition';

import type { DailyGoalPersistence } from '../daily-goals';
import type { CatalogDatabase, LocalDatabase } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { defaultAmountMilli } from './amount-input';
import { readDayLog, type DayLog } from './day-log';
import { addEntry, removeEntry, type NewEntry } from './entries';
import { latestAmountOf } from './entry-repository';
import { createFoodSearch, type FoodSearch } from './food-search';
import { confirmPhotoDraft, type PhotoDraftConfirmation } from './meal-photos';
import { overlaidOrigins, searchOwnFoods, type OwnFoodChoice } from './own-food-repository';
import { deleteOwnFood, saveOwnFood, type OwnFoodBase, type OwnFoodValues } from './own-foods';

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
  /** „Rückgängig“: entfernt den Eintrag zum Token höchstens einmal, in einer eigenen Transaktion. */
  undo(undoToken: string): UndoOutcome;
  /** Beendet einen Token, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(undoToken: string): void;
  /**
   * Beobachtet das Tagesprotokoll samt Tagesaufnahme eines lokalen Tags: sofort und nach jedem Commit
   * der Kontodatenbank. `null`, bis die eigene Person mit dem ersten Pull angekommen ist.
   */
  observeDayLog(localDate: LocalDate, listener: (log: DayLog | null) => void): () => void;
  /**
   * Vorbelegung der Mengenprüfung (Spezifikation 2, Abschnitt 6): die letzte Menge und Einheit dieses
   * Lebensmittels aus den eigenen Einträgen, sonst eine bekannte Portion, sonst 100 g bzw. 100 ml.
   */
  prefillAmount(foodRef: FoodRef, snapshot: NutritionSnapshot): AmountPrefill;
  /**
   * Speichert ein eigenes Lebensmittel (Spezifikation 2, Abschnitt 3) in einer eigenen lokalen
   * Transaktion samt Outbox-Operation. `base` ist `null` für ein neues, ein eigenes Lebensmittel für
   * genau dieses oder ein BLS-Lebensmittel, aus dem ein eigenes mit dieser Herkunft wird; die externen
   * Daten bleiben unverändert. Liefert Referenz und neue Fassung für künftige Einträge; gespeicherte
   * Einträge behalten ihren Snapshot. Wirft `InvalidNutritionInputError`, ohne etwas zu schreiben.
   */
  saveOwnFood(base: OwnFoodBase, values: OwnFoodValues): OwnFoodChoice;
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

  return {
    addEntry(input) {
      const { messageKey, values, undo } = database.transaction((tx) => addEntry(tx, dependencies, input));
      return { messageKey, values, undoToken: tokens.issue(database, (tx) => removeEntry(tx, dependencies, undo.entryId, 'rueckgaengig')) };
    },
    confirmPhotoDraft: (input) => database.transaction((tx) => confirmPhotoDraft(tx, dependencies, input)),
    undo: (undoToken) => tokens.undo(undoToken),
    expire: (undoToken) => tokens.expire(undoToken),
    observeDayLog: (localDate, listener) => database.observe((tx) => readDayLog(tx, localDate), listener),
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
