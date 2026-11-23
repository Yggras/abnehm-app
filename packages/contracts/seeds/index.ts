import { budgetvorschlagManifests } from './budgetvorschlag.ts';
import { challengePasstNichtManifest, challengeVerfallenManifest, challengeVorgeschlagenManifest } from './challenges.ts';
import { einladungNachEntkopplungManifest } from './einladung-nach-entkopplung.ts';
import { frischesKontoManifest } from './frisches-konto.ts';
import { gekoppeltManifest } from './gekoppelt.ts';
import type { SeedManifest, SeedScenarioKey } from './manifest.ts';
import { nachEntkopplungManifest } from './nach-entkopplung.ts';
import { projektAbschlussManifest } from './projekte.ts';
import { onboardingManifests } from './onboarding.ts';
import { randzustandManifests } from './randzustaende.ts';
import { ernaehrungRandzustandManifests } from './randzustaende-ernaehrung.ts';
import { soloManifests } from './solo.ts';
import {
  doppelausgabeManifest,
  ereignisseVollManifest,
  feldkonfliktManifest,
  formwechselManifest,
  haelfteVollManifest,
  levelaufstiegAusstehendManifest,
  rollenwahlOffenManifest,
  soloEnergieManifest,
} from './spiel.ts';
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
export { buildSeedState, changedOnServer, pulledBy, withDeviceState, withLocalRows, type SeedArea, type SeedDevicePlan, type SeedEntity, type SeedPart } from './build.ts';
export { gekoppeltParts, vorDemSchluepfenParts } from './gekoppelt.ts';
export { seedAccounts, seedClock, seedDays, seedIds, seedImageKeys, seedInstallations, seedInviteCodes, seedPassword } from './ids.ts';
export { budgetvorschlagBudget, budgetvorschlagReadings } from './budgetvorschlag.ts';
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
  'einladung-nach-entkopplung': einladungNachEntkopplungManifest,
  'haelfte-voll': haelfteVollManifest,
  doppelausgabe: doppelausgabeManifest,
  feldkonflikt: feldkonfliktManifest,
  'ereignisse-voll': ereignisseVollManifest,
  'levelaufstieg-ausstehend': levelaufstiegAusstehendManifest,
  formwechsel: formwechselManifest,
  'challenge-vorgeschlagen': challengeVorgeschlagenManifest,
  'challenge-verfallen': challengeVerfallenManifest,
  'challenge-passt-nicht': challengePasstNichtManifest,
  'projekt-abschluss': projektAbschlussManifest,
  ...randzustandManifests,
  ...ernaehrungRandzustandManifests,
  veralteter_partnerstand: veralteterPartnerstandManifest,
  ...syncSzenarioManifests,
  ...tageszielManifests,
  ...budgetvorschlagManifests,
  ...onboardingManifests,
};
