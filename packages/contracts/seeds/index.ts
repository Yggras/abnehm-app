import type { SeedManifest, SeedScenarioKey } from './manifest.ts';
import { soloManifests } from './solo.ts';

// Seed-Manifeste (Spezifikation 0, Abschnitt 12; #112). Nur für Development- und Testartefakte:
// Lint erlaubt `@abnehm/contracts/seeds` nur in Tests und in den registrierten Testfähigkeiten, das
// Produktions-Image des Backends kopiert den Ordner nicht, und der Release-Test prüft beides.

export {
  authTables,
  SeedDeviceState,
  SeedKey,
  SeedManifest,
  SeedRow,
  SeedRows,
  SeedRequest,
  SeedScenarioKey,
  SeedState,
  SeedStep,
  seedFormatVersion,
  seedRoutePath,
  type SeedAccount,
  type SeedInstallation,
  type SeedValue,
} from './manifest.ts';
export { canonicalJson, canonicalRows, dependencyOrder } from './canonical.ts';
export { buildSeedState, type SeedArea, type SeedDevicePlan, type SeedEntity, type SeedPart } from './build.ts';
export { seedAccounts, seedClock, seedDays, seedIds, seedInstallations, seedPassword } from './ids.ts';

/** Alle Szenarien mit Manifest. */
export const seedManifests: Readonly<Record<SeedScenarioKey, SeedManifest>> = { ...soloManifests };
