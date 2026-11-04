import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';
import type { PlanReader, WeightRecorder } from '@abnehm/contracts/ports';
import type { SportRecordedOutcome, WaterAddedOutcome, WeightRecordedOutcome } from '@abnehm/contracts/trackers';

import type { DailyGoalPersistence } from '../daily-goals';
import type { LocalDatabase } from '../local-db';
import { quickCommandHandler, type QuickCommandHandlers } from '../shell/quick-commands';
import type { TodaySource } from '../shell/today-registry';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { lastSportOf, recordSportEntry, undoSport, type LastSport, type SportInput } from './sport';
import { sportTodaySource } from './sport-today';
import type { Refresh } from './today-source';
import { addWaterEntry, undoWater, type WaterUndo } from './water';
import { waterTodaySource } from './water-today';
import { lastWeightsOf, recordWeightEntry, undoWeight, type LastWeights, type WeightInput } from './weight';
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
   * Legt einen manuellen Sporteintrag an, in einer eigenen lokalen Transaktion. Lokaler Tag, Zone und
   * Offset gehören zum Beginn in der Zone der Uhr; Art und Dauer merkt sich das Gerät als Vorbelegung.
   * Kalorien werden nur angezeigt, nie auf das Kalorienbudget gutgeschrieben. Wirft
   * `InvalidTrackerInputError` bei unbekannter Art, außerhalb von 1–600 Minuten bzw. 0–5000 kcal und für
   * einen Beginn in der Zukunft, ohne etwas zu schreiben.
   */
  recordSport(input: SportInput): SportRecordedOutcome;
  /** Zuletzt genutzte Art und Dauer dieses Geräts (Vorbelegung des Formulars); `null` vor der ersten Einheit. */
  lastSport(): LastSport | null;
  /**
   * Letztes Gewicht (Vorbelegung des Formulars) und letztes Tagesgewicht (Vergleichswert der Frage
   * „Tippfehler?“) der eigenen Person; `null`, wenn sie noch nie gewogen hat.
   */
  lastWeights(): LastWeights | null;
  /**
   * Macht die Buchung zum Token höchstens einmal rückgängig, in einer eigenen Transaktion. Es kennt nur
   * Tokens aus `addWater`, `recordWeight` und `recordSport`; Buchungen über `water.quick_add` nimmt die
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
  /**
   * Beitrag `trackers.sport` für „Heute“: Wochenminuten (Montag bis Sonntag) und Sportwochenziel aus dem
   * `PlanReader`. `refresh` stößt das erneute Lesen ohne Datenbankänderung an, etwa am Wochenwechsel.
   */
  sportToday(planReader: PlanReader, refresh: Refresh): TodaySource<'trackers.sport'>;
}>;

/**
 * Tracker-Modul (Spezifikation 3, Abschnitt 2) über der Datenbank eines Kontos, mit Wasser, Gewicht und
 * Sport.
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
    lastWeights: () => database.read((tx) => lastWeightsOf(tx)),
    recordSport(input) {
      const { messageKey, values, undo } = database.transaction((tx) => recordSportEntry(tx, dependencies, dependencies.newId(), input));
      return { messageKey, values, undoToken: tokens.issue(database, (tx) => undoSport(tx, dependencies, undo)) };
    },
    lastSport: () => database.read((tx) => lastSportOf(tx)),
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
    sportToday: (planReader, refresh) => sportTodaySource(dependencies, planReader, refresh),
  };
}
