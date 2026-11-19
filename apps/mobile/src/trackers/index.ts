// Tracker-Modul für Wasser, Sport und Gewicht (Spezifikation 3, Abschnitt 2): die einzige
// Schnittstelle des Bereichs nach außen. Jeder Befehl ist genau eine lokale Transaktion aus
// Fachänderung, Outbox-Operation und `reevaluateDailyGoals`; Ergebnisse tragen `messageKey`, Werte
// und einen flüchtigen Undo-Token. Kein anderer Bereich liest die Tracker-Tabellen. Die Regeln
// stehen im geteilten Modul `@abnehm/contracts/tracker-rules`.
// Bildschirme (TSX) importieren die Routendateien direkt, etwa `WeightCaptureScreen` oder `SportCaptureScreen`: Die Node-Tests des
// Backends laden diesen Index und kennen kein JSX.
export { appSportWeeks, appTrackers, appWeightDetail, useAppTrackers } from './app-trackers';
export { createTrackers, type TrackerDependencies, type Trackers } from './trackers';
export { InvalidTrackerInputError } from './invalid-input';
export {
  sportCheckInMessageKey,
  trackerDailyGoals,
  type SportDayFacts,
  type WaterDayFacts,
  type WeightDayFacts,
} from './daily-goal-evaluators';
export type { HealthImportBatch } from './health-import';
export { sportEntryEntity } from './sport-entity';
export { waterEntryEntity } from './water-entity';
export { weightEntryEntity } from './weight-entity';
export type { Refresh } from './today-source';
