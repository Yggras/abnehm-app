import type { Clock } from '@abnehm/clock';
import { EntityId, type LocalDate } from '@abnehm/contracts/base';
import { entryAmount, type DisplayUnit, type FoodRef, type NutritionEntryAddedOutcome, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { DailyGoalPersistence } from '../daily-goals';
import type { LocalDatabase } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { defaultAmountMilli } from './amount-input';
import { readDayLog, type DayLog } from './day-log';
import { addEntry, removeEntry, type NewEntry } from './entries';
import { latestAmountOf } from './entry-repository';

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
  };
}
