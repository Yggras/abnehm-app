import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';
import type { PlanReader, WeightRecorder } from '@abnehm/contracts/ports';
import type { WaterAddedOutcome, WeightRecordedOutcome } from '@abnehm/contracts/trackers';

import type { DailyGoalPersistence } from '../daily-goals';
import type { LocalDatabase } from '../local-db';
import { quickCommandHandler, type QuickCommandHandlers } from '../shell/quick-commands';
import type { TodaySource } from '../shell/today-registry';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import type { Refresh } from './today-source';
import { addWaterEntry, undoWater, type WaterUndo } from './water';
import { waterTodaySource } from './water-today';
import { recordWeightEntry, undoWeight, type WeightInput } from './weight';
import { createWeightRecorder } from './weight-recorder';
import { weightTodaySource } from './weight-today';

export type TrackerDependencies = Readonly<{
  /** Die geöffnete Kontodatenbank; jeder Befehl ist genau eine Transaktion darin. */
  database: LocalDatabase;
  /** Zeitpunkt, lokaler Tag, Zone und Offset neuer Einträge. */
  clock: Clock;
  /** Schreibt die Outbox-Operation in der Transaktion des Befehls. */
  writer: SyncWriter;
  /** Persistenzdienst der Tagesziele; jeder Befehl meldet seine Tage in derselben Transaktion. */
  persistence: Pick<DailyGoalPersistence, 'reevaluateDailyGoals'>;
  newId: () => EntityId;
}>;

export type Trackers = Readonly<{
  /**
   * Bucht Wasser jetzt, in einer eigenen lokalen Transaktion. Das Ergebnis enthält Meldung, Werte und
   * einen flüchtigen Undo-Token für „Rückgängig“. Wirft `InvalidTrackerInputError` außerhalb von
   * 1–3000 ml, ohne etwas zu schreiben.
   */
  addWater(input: Readonly<{ ml: number }>): WaterAddedOutcome;
  /**
   * Trägt ein manuell gemessenes Gewicht ein, in einer eigenen lokalen Transaktion. Lokaler Tag, Zone
   * und Offset gehören zum Messzeitpunkt in der Zone der Uhr. Wirft `InvalidTrackerInputError` außerhalb
   * von 20,0–350,0 kg in 100-g-Schritten und für Zeitpunkte in der Zukunft, ohne etwas zu schreiben.
   */
  recordWeight(input: WeightInput): WeightRecordedOutcome;
  /**
   * Macht die Buchung zum Token höchstens einmal rückgängig, in einer eigenen Transaktion. Es kennt nur
   * Tokens aus `addWater` und `recordWeight`; Buchungen über `water.quick_add` nimmt die
   * Quick-Command-Registry mit ihren eigenen Tokens zurück.
   */
  undo(undoToken: string): UndoOutcome;
  /** Beendet einen Token, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(undoToken: string): void;
  /** Handler für die Quick-Command-Registry der Shell (`water.quick_add`). */
  quickCommands: QuickCommandHandlers;
  /**
   * Schreib-Port für *Ziele & Onboarding* über dieser Kontodatenbank, idempotent je `entryId`. Der
   * Composition Root gibt ihn an `composeAreaPorts` weiter (`weightRecorder: () => trackers.weightRecorder`).
   */
  weightRecorder: WeightRecorder;
  /**
   * Beitrag `trackers.water` für „Heute“: heute gezählte ml und Wasserziel aus dem `PlanReader`.
   * `refresh` stößt das erneute Lesen ohne Datenbankänderung an, etwa am Tageswechsel.
   */
  waterToday(planReader: PlanReader, refresh: Refresh): TodaySource<'trackers.water'>;
  /**
   * Beitrag `trackers.weight` für „Heute“: letztes Tagesgewicht und Stand des Wiegetags samt nächstem
   * Wiegetag aus dem `PlanReader`. `refresh` stößt das erneute Lesen ohne Datenbankänderung an.
   */
  weightToday(planReader: PlanReader, refresh: Refresh): TodaySource<'trackers.weight'>;
}>;

/**
 * Tracker-Modul (Spezifikation 3, Abschnitt 2) über der Datenbank eines Kontos. Bisher mit Wasser;
 * Sport und Gewicht docken hier an.
 */
export function createTrackers(dependencies: TrackerDependencies): Trackers {
  const { database } = dependencies;
  const tokens = createUndoTokens();

  return {
    addWater({ ml }) {
      const { messageKey, values, undo } = database.transaction((tx) => addWaterEntry(tx, dependencies, ml));
      return { messageKey, values, undoToken: tokens.issue(database, (tx) => undoWater(tx, dependencies, undo)) };
    },
    recordWeight(input) {
      const { messageKey, values, undo } = database.transaction((tx) => recordWeightEntry(tx, dependencies, dependencies.newId(), input));
      return { messageKey, values, undoToken: tokens.issue(database, (tx) => undoWeight(tx, dependencies, undo)) };
    },
    undo: (undoToken) => tokens.undo(undoToken),
    expire: (undoToken) => tokens.expire(undoToken),
    quickCommands: {
      'water.quick_add': quickCommandHandler<'water.quick_add', WaterUndo>({
        execute(tx, { ml }) {
          const { messageKey, values, undo } = addWaterEntry(tx, dependencies, ml);
          return { messageKey, values, undoData: undo };
        },
        undo: (tx, undo) => undoWater(tx, dependencies, undo),
      }),
    },
    weightRecorder: createWeightRecorder(dependencies),
    waterToday: (planReader, refresh) => waterTodaySource(dependencies, planReader, refresh),
    weightToday: (planReader, refresh) => weightTodaySource(dependencies, planReader, refresh),
  };
}
