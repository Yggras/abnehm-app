// Registry der Seed-Varianten (Spezifikation 0, Abschnitt 12; #113): alle persistenten Seed-Manifeste,
// Laufzeitprofile und Gerätekonfigurationen mit den Tests, die sie ausführen. Die Definitionen stehen
// woanders:
//
// - Seed-Manifeste: `seedManifests` in `packages/contracts/seeds/`; persistente Zustände mit Ausgangs- und
//   Sollzustand in Postgres und SQLite.
// - Laufzeitprofile: `runtimeProfiles` in `apps/mobile/src/test-capabilities/profiles.ts`; Zeit-,
//   Transport-, Auth-, Storage- und Serverfehler über die Test-Adapter, kein persistenter Zustand.
// - Gerätekonfigurationen: `deviceConfigs` in `apps/mobile/src/design/testing/device-configs.ts`;
//   Schriftfaktor und „Bewegung reduzieren“, ohne SQLite- oder Postgres-Sollzustand.
//
// `test/seed-varianten.test.ts` findet fehlende und doppelte Schlüssel und prüft, dass jede Variante
// mindestens eine ausführbare Testdatei nennt, die ihren Schlüssel ausdrücklich enthält.
//
// Neue Variante: Definition ergänzen, hier eintragen und in einem Test mit ihrem Schlüssel ausführen.

export type SeedVariantKind = 'seed-manifest' | 'laufzeitprofil' | 'geraetekonfiguration';

export type SeedVariant = Readonly<{
  kind: SeedVariantKind;
  key: string;
  /** Repo-relative Testdateien, die die Variante mit ihrem Schlüssel ausführen. */
  tests: readonly string[];
}>;

const manifestSuite = 'apps/backend/test/seed-manifeste-app.test.ts';
const randzustaende = 'apps/backend/test/seed-randzustaende-app.test.ts';
const profiles = 'apps/mobile/src/test-capabilities/profiles.test.ts';

const manifest = (key: string, ...tests: string[]): SeedVariant => ({ kind: 'seed-manifest', key, tests: [manifestSuite, ...tests] });
const profile = (key: string): SeedVariant => ({ kind: 'laufzeitprofil', key, tests: [profiles] });

export const seedVariants: readonly SeedVariant[] = [
  manifest('solo', 'apps/backend/test/seed-app.test.ts'),
  manifest('solo-wasser-leer'),
  manifest('solo-wasser-erreicht'),
  manifest('solo-wasser-ueber-ziel'),
  manifest('solo-ohne-wiegetag'),
  manifest('gekoppelt', 'apps/backend/test/seed-app.test.ts'),
  manifest('nach_entkopplung', 'apps/backend/test/seed-app.test.ts'),
  manifest('frisches_konto', 'apps/backend/test/seed-app.test.ts'),
  manifest('leer'),
  manifest('teilweise'),
  manifest('erfuellt', randzustaende),
  manifest('nach_erfuellung_korrigiert', randzustaende),
  manifest('tagesende_offen', randzustaende),
  manifest('tagesende_abgeschlossen', randzustaende),
  manifest('veralteter_partnerstand', randzustaende),
  profile('uhr-ungesichert-24h'),
  profile('uhr-reise'),
  profile('transport-offline'),
  profile('transport-antwort-verloren'),
  profile('server-nicht-verfuegbar'),
  profile('auth-sitzung-abgelehnt'),
  profile('storage-nicht-verfuegbar'),
  { kind: 'geraetekonfiguration', key: 'schriftfaktor-2', tests: ['apps/mobile/src/shell/AppShell.test.tsx', 'apps/mobile/src/shell/MessageHost.test.tsx'] },
  { kind: 'geraetekonfiguration', key: 'reduzierte-bewegung', tests: ['apps/mobile/src/design/motion.test.tsx', 'apps/mobile/src/haptics/device-haptics.test.ts'] },
];
