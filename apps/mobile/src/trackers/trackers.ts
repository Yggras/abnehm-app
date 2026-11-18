import type { Clock } from '@abnehm/clock';
import type { EntityId, LocalDate } from '@abnehm/contracts/base';
import type { PlanReader, WeightRecorder, WeightTrendReader } from '@abnehm/contracts/ports';
import type {
  ActivityType,
  ActivityTypeOverriddenOutcome,
  ImportHiddenOutcome,
  SportDeletedOutcome,
  SportRecordedOutcome,
  SportUpdatedOutcome,
  WaterAddedOutcome,
  WeightDeletedOutcome,
  WeightRecordedOutcome,
  WeightUpdatedOutcome,
} from '@abnehm/contracts/trackers';

import type { DailyGoalPersistence } from '../daily-goals';
import type { LocalDatabase, TransactionContext } from '../local-db';
import { quickCommandHandler, type QuickCommandHandlers } from '../shell/quick-commands';
import type { TodaySource } from '../shell/today-registry';
import { createUndoTokens, type UndoOutcome } from '../shell/undo-tokens';
import type { SyncWriter } from '../sync';
import { applyHealthImport, type HealthImportBatch } from './health-import';
import { hideImportedEntry, overrideImportedActivityType, undoImported, type ImportedUndo } from './imported';
import { deleteSportEntry, lastSportOf, recordSportEntry, undoSport, updateSportEntry, type LastSport, type SportChanged, type SportInput } from './sport';
import { sportWeekSource, type SportWeekState } from './sport-week';
import { sportTodaySource } from './sport-today';
import type { Source } from '../shell/followed-source';
import type { Refresh } from './observed-source';
import { addWaterEntry, undoWater, type WaterUndo } from './water';
import { waterTodaySource } from './water-today';
import {
  deleteWeightEntry,
  lastWeightsOf,
  recordWeightEntry,
  undoWeight,
  updateWeightEntry,
  type LastWeights,
  type WeightChanged,
  type WeightInput,
} from './weight';
import { weightDetailSource, type WeightDetailState } from './weight-detail';
import { createWeightRecorder } from './weight-recorder';
import { weightTodaySource } from './weight-today';
import { createWeightTrendReader } from './weight-trend-reader';

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
   * Ändert Wert und Messzeitpunkt eines manuellen Gewichtseintrags, in einer eigenen lokalen Transaktion,
   * und meldet den alten und den neuen Tag. Zone und Offset bleiben die der Anlage. „Rückgängig“ schreibt
   * die vorherigen Werte zurück. Wirft `InvalidTrackerInputError` wie `recordWeight` und für einen
   * unbekannten, gelöschten oder importierten Eintrag, ohne etwas zu schreiben.
   */
  updateWeight(entryId: EntityId, input: WeightInput): WeightUpdatedOutcome;
  /**
   * Löscht einen manuellen Gewichtseintrag ohne Bestätigungsdialog, in einer eigenen lokalen Transaktion.
   * „Rückgängig“ legt einen neuen Eintrag mit neuer ID und denselben fachlichen Werten an. Wirft
   * `InvalidTrackerInputError` für einen unbekannten, schon gelöschten oder importierten Eintrag.
   */
  deleteWeight(entryId: EntityId): WeightDeletedOutcome;
  /**
   * Legt einen manuellen Sporteintrag an, in einer eigenen lokalen Transaktion. Lokaler Tag, Zone und
   * Offset gehören zum Beginn in der Zone der Uhr; Art und Dauer merkt sich das Gerät als Vorbelegung.
   * Kalorien werden nur angezeigt, nie auf das Kalorienbudget gutgeschrieben. Wirft
   * `InvalidTrackerInputError` bei unbekannter Art, außerhalb von 1–600 Minuten bzw. 0–5000 kcal und für
   * einen Beginn in der Zukunft, ohne etwas zu schreiben.
   */
  recordSport(input: SportInput): SportRecordedOutcome;
  /**
   * Ändert Art, Dauer, Beginn und Kalorien einer manuellen Einheit, in einer eigenen lokalen Transaktion,
   * und meldet den alten und den neuen Tag. Zone und Offset bleiben die der Anlage. „Rückgängig“ schreibt
   * die vorherigen Werte zurück. Wirft `InvalidTrackerInputError` wie `recordSport` und für einen
   * unbekannten, gelöschten oder importierten Eintrag, ohne etwas zu schreiben.
   */
  updateSport(entryId: EntityId, input: SportInput): SportUpdatedOutcome;
  /**
   * Löscht eine manuelle Einheit ohne Bestätigungsdialog, in einer eigenen lokalen Transaktion. „Rückgängig“
   * legt einen neuen Eintrag mit neuer ID und denselben fachlichen Werten an. Wirft
   * `InvalidTrackerInputError` für einen unbekannten, schon gelöschten oder importierten Eintrag.
   */
  deleteSport(entryId: EntityId): SportDeletedOutcome;
  /**
   * Blendet ein importiertes Training oder Gewicht ohne Bestätigungsdialog aus, in einer eigenen lokalen
   * Transaktion, und meldet seinen Tag. Der Eintrag verschwindet aus allen Listen und Summen, und ein
   * späterer Upsert aus der Quelle blendet ihn nicht wieder ein; ein von ihm ersetzter manueller Eintrag
   * zählt wieder. „Rückgängig“ entfernt `hidden_at`. Wirft `InvalidTrackerInputError` für einen unbekannten,
   * manuellen, gelöschten oder schon ausgeblendeten Eintrag, ohne etwas zu schreiben.
   */
  hideImported(entryId: EntityId): ImportHiddenOutcome;
  /**
   * Überschreibt die Aktivitätsart eines importierten Trainings, in einer eigenen lokalen Transaktion, und
   * meldet seinen Tag. Angezeigt wird die überschriebene vor der Plattformart; ein späterer Upsert aus der
   * Quelle lässt sie unverändert. „Rückgängig“ stellt die vorher überschriebene Art wieder her. Wirft
   * `InvalidTrackerInputError` für eine unbekannte Art und für einen Eintrag, der kein sichtbares
   * importiertes Training ist, ohne etwas zu schreiben.
   */
  overrideActivityType(entryId: EntityId, activityType: ActivityType): ActivityTypeOverriddenOutcome;
  /** Zuletzt genutzte Art und Dauer dieses Geräts (Vorbelegung des Formulars); `null` vor der ersten Einheit. */
  lastSport(): LastSport | null;
  /**
   * Letztes Gewicht (Vorbelegung des Formulars) und letztes Tagesgewicht (Vergleichswert der Frage
   * „Tippfehler?“) der eigenen Person; `null`, wenn sie noch nie gewogen hat. `except` lässt eine Messung
   * aus, etwa die gerade bearbeitete.
   */
  lastWeights(except?: EntityId): LastWeights | null;
  /**
   * Macht die Buchung zum Token höchstens einmal rückgängig, in einer eigenen Transaktion. Es kennt nur
   * Tokens aus `addWater`, `recordWeight`, `updateWeight`, `deleteWeight`, `recordSport`, `updateSport`,
   * `deleteSport`, `hideImported` und `overrideActivityType`; Buchungen über
   * `water.quick_add` nimmt die Quick-Command-Registry mit ihren eigenen Tokens zurück.
   */
  undo(undoToken: string): UndoOutcome;
  /** Beendet einen Token, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(undoToken: string): void;
  /**
   * Interner Importbefehl für den Health-Import-Dienst, eine Transaktion je Stapel (Spezifikation 3,
   * Abschnitt 6): Upserts, Löschungen, Abgleich, `reevaluateDailyGoals` für alle betroffenen Tage und
   * `alongside`, in dem der Dienst seinen Cursor speichert. Scheitert ein Teil, bleibt nichts davon.
   */
  importHealth(batch: HealthImportBatch, alongside: (tx: TransactionContext) => void): void;
  /** Handler für die Quick-Command-Registry der Shell (`water.quick_add`). */
  quickCommands: QuickCommandHandlers;
  /**
   * Schreib-Port für *Ziele & Onboarding* über dieser Kontodatenbank, idempotent je `entryId`. Der
   * Composition Root gibt ihn an `composeAreaPorts` weiter (`weightRecorder: () => trackers.weightRecorder`).
   */
  weightRecorder: WeightRecorder;
  /**
   * Lesender Port für *Ziele & Onboarding* über dieser Kontodatenbank, in Lesetransaktionen und gegen Zod
   * geprüft. Der Composition Root gibt ihn an `composeAreaPorts` weiter
   * (`weightTrendReader: () => trackers.weightTrendReader`).
   */
  weightTrendReader: WeightTrendReader;
  /**
   * Lesemodell des Gewicht-Detailbildschirms: Trend, „seit Start“, Veränderung in 2 Wochen, Prognose mit
   * Zielgewicht und Tempo aus dem `PlanReader` und alle zählenden Messungen. `refresh` stößt das erneute
   * Lesen ohne Datenbankänderung an, etwa am Tageswechsel.
   */
  weightDetail(planReader: PlanReader, refresh: Refresh): Source<WeightDetailState>;
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
  /**
   * Lesemodell des Sport-Detailbildschirms für eine Woche (Montag bis Sonntag): Wochenminuten, Sportwochenziel
   * aus dem `PlanReader` und die Einträge nach Tag. `week` ist ein Tag der Woche, `null` die laufende Woche
   * der Uhr. `refresh` stößt das erneute Lesen ohne Datenbankänderung an, etwa am Wochenwechsel.
   */
  sportWeek(planReader: PlanReader, refresh: Refresh, week: LocalDate | null): Source<SportWeekState>;
}>;

/**
 * Tracker-Modul (Spezifikation 3, Abschnitt 2) über der Datenbank eines Kontos, mit Wasser, Gewicht und
 * Sport.
 */
export function createTrackers(dependencies: TrackerDependencies): Trackers {
  const { database } = dependencies;
  const tokens = createUndoTokens();
  /** Ergebnis eines Gewichtsbefehls nach seiner Transaktion: Meldung und Werte samt Undo-Token. */
  const weightOutcome = <K extends string>({ messageKey, values, undo }: WeightChanged<K>) => ({
    messageKey,
    values,
    undoToken: tokens.issue(database, (tx) => undoWeight(tx, dependencies, undo)),
  });
  /** Ergebnis eines Sportbefehls nach seiner Transaktion: Meldung und Werte samt Undo-Token. */
  const sportOutcome = <K extends string>({ messageKey, values, undo }: SportChanged<K>) => ({
    messageKey,
    values,
    undoToken: tokens.issue(database, (tx) => undoSport(tx, dependencies, undo)),
  });
  /** Undo-Token eines Befehls für importierte Einträge. */
  const importedUndoToken = (undo: ImportedUndo) => tokens.issue(database, (tx) => undoImported(tx, dependencies, undo));

  return {
    addWater({ ml }) {
      const { messageKey, values, undo } = database.transaction((tx) => addWaterEntry(tx, dependencies, ml));
      return { messageKey, values, undoToken: tokens.issue(database, (tx) => undoWater(tx, dependencies, undo)) };
    },
    recordWeight: (input) => weightOutcome(database.transaction((tx) => recordWeightEntry(tx, dependencies, dependencies.newId(), input))),
    updateWeight: (entryId, input) => weightOutcome(database.transaction((tx) => updateWeightEntry(tx, dependencies, entryId, input))),
    deleteWeight: (entryId) => weightOutcome(database.transaction((tx) => deleteWeightEntry(tx, dependencies, entryId))),
    lastWeights: (except) => database.read((tx) => lastWeightsOf(tx, except)),
    recordSport: (input) => sportOutcome(database.transaction((tx) => recordSportEntry(tx, dependencies, dependencies.newId(), input))),
    updateSport: (entryId, input) => sportOutcome(database.transaction((tx) => updateSportEntry(tx, dependencies, entryId, input))),
    deleteSport: (entryId) => sportOutcome(database.transaction((tx) => deleteSportEntry(tx, dependencies, entryId))),
    hideImported(entryId) {
      const { undo, ...message } = database.transaction((tx) => hideImportedEntry(tx, dependencies, entryId));
      return { ...message, undoToken: importedUndoToken(undo) };
    },
    overrideActivityType(entryId, activityType) {
      const { undo, ...message } = database.transaction((tx) => overrideImportedActivityType(tx, dependencies, entryId, activityType));
      return { ...message, undoToken: importedUndoToken(undo) };
    },
    lastSport: () => database.read((tx) => lastSportOf(tx)),
    undo: (undoToken) => tokens.undo(undoToken),
    expire: (undoToken) => tokens.expire(undoToken),
    importHealth: (batch, alongside) =>
      database.transaction((tx) => {
        applyHealthImport(tx, dependencies, batch);
        alongside(tx);
      }),
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
    weightTrendReader: createWeightTrendReader(database),
    weightDetail: (planReader, refresh) => weightDetailSource(dependencies, planReader, refresh),
    waterToday: (planReader, refresh) => waterTodaySource(dependencies, planReader, refresh),
    weightToday: (planReader, refresh) => weightTodaySource(dependencies, planReader, refresh),
    sportToday: (planReader, refresh) => sportTodaySource(dependencies, planReader, refresh),
    sportWeek: (planReader, refresh, week) => sportWeekSource(dependencies, planReader, refresh, week),
  };
}
