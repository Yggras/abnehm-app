// Health-Import (Spezifikation 3, Abschnitte 2 und 6; #183): Plattform-Adapter als Naht und der
// Import-Dienst, der über den internen Importbefehl des Tracker-Moduls schreibt. Die Attrappe liegt unter
// `./testing/` und erreicht App-Code nur über die Testfähigkeiten (`src/build-capabilities.ts`).
export { createHealthImport, startOfLocalDay, type HealthConnectOutcome, type HealthConnection, type HealthImport, type HealthImportDependencies } from './health-import';
export {
  healthDataTypes,
  unavailableHealthPlatform,
  type HealthAccessState,
  type HealthAvailability,
  type HealthBackgroundCapability,
  type HealthBackgroundHandler,
  type HealthChanges,
  type HealthDataType,
  type HealthOrigin,
  type HealthPlatformAdapter,
  type HealthRecord,
  type HealthSourceApp,
  type HealthWeightRecord,
  type HealthWorkoutRecord,
} from './platform';
