import { frischesKontoManifest } from './frisches-konto.ts';
import { gekoppeltManifest } from './gekoppelt.ts';
import type { SeedManifest, SeedScenarioKey } from './manifest.ts';
import { nachEntkopplungManifest } from './nach-entkopplung.ts';
import { randzustandManifests } from './randzustaende.ts';
import { soloManifests } from './solo.ts';
import { doppelausgabeManifest, feldkonfliktManifest, haelfteVollManifest, rollenwahlOffenManifest, soloEnergieManifest } from './spiel.ts';
import { syncSzenarioManifests } from './sync-szenarien.ts';
import { tageszielManifests } from './tagesziele.ts';
import { veralteterPartnerstandManifest } from './veralteter-partnerstand.ts';

// Seed-Manifeste (Spezifikation 0, Abschnitt 12; #112). Nur für Development- und Testartefakte:
// Lint erlaubt `@abnehm/contracts/seeds` nur in Tests und in den registrierten Testfähigkeiten, das
// Produktions-Image des Backends kopiert den Ordner nicht, und der Release-Test prüft beides.

export {
  authTables,
  SeedDeviceState,
  SeedExtensions,
  SeedKey,
  SeedManifest,
  SeedRow,
  SeedRows,
  SeedRequest,
  SeedScenarioKey,
  SeedState,
  SeedStep,
  SyntheticImage,
  seedFormatVersion,
  seedRoutePath,
  type SeedAccount,
  type SeedInstallation,
  type SeedValue,
} from './manifest.ts';
export { canonicalJson, canonicalRows, dependencyOrder, withoutDerivedColumns } from './canonical.ts';
export { buildSeedState, changedOnServer, pulledBy, type SeedArea, type SeedDevicePlan, type SeedEntity, type SeedPart } from './build.ts';
export { gekoppeltParts, vorDemSchluepfenParts } from './gekoppelt.ts';
export { seedAccounts, seedClock, seedDays, seedIds, seedImageKeys, seedInstallations, seedPassword } from './ids.ts';
export { ServerClockRequest, serverClockRoutePath } from './server-clock.ts';
export { uncoupledState, uncouplingRequestOf, type SeedUncouplingRequest } from './nach-entkopplung.ts';

/** Alle Szenarien mit Manifest. */
export const seedManifests: Readonly<Record<SeedScenarioKey, SeedManifest>> = {
  ...soloManifests,
  gekoppelt: gekoppeltManifest,
  nach_entkopplung: nachEntkopplungManifest,
  frisches_konto: frischesKontoManifest,
  'solo-energie': soloEnergieManifest,
  'rollenwahl-offen': rollenwahlOffenManifest,
  'haelfte-voll': haelfteVollManifest,
  doppelausgabe: doppelausgabeManifest,
  feldkonflikt: feldkonfliktManifest,
  ...randzustandManifests,
  veralteter_partnerstand: veralteterPartnerstandManifest,
  ...syncSzenarioManifests,
  ...tageszielManifests,
};
