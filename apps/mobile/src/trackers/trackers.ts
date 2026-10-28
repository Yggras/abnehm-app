import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';
import type { WaterAddedOutcome } from '@abnehm/contracts/trackers';

import type { DailyGoalPersistence } from '../daily-goals';
import type { LocalDatabase } from '../local-db';
import { quickCommandHandler, type QuickCommandHandlers } from '../shell/quick-commands';
import type { TodaySource } from '../shell/today-registry';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { addWaterEntry, undoWater, type WaterUndo } from './water';
import { waterTodaySource, type Refresh } from './water-today';

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
  /** Macht die Buchung zum Token höchstens einmal rückgängig, in einer eigenen Transaktion. */
  undo(undoToken: string): UndoOutcome;
  /** Beendet einen Token, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(undoToken: string): void;
  /** Handler für die Quick-Command-Registry der Shell (`water.quick_add`). */
  quickCommands: QuickCommandHandlers;
  /**
   * Beitrag `trackers.water` für „Heute“: heute gezählte ml und Wasserziel aus dem `PlanReader`.
   * `refresh` stößt das erneute Lesen ohne Datenbankänderung an, etwa am Tageswechsel.
   */
  waterToday(planReader: PlanReader, refresh: Refresh): TodaySource<'trackers.water'>;
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
    waterToday: (planReader, refresh) => waterTodaySource(dependencies, planReader, refresh),
  };
}
