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
// `variantProblems` findet fehlende und doppelte Schlüssel und prüft, dass jede Variante mindestens eine
// ausführbare Testdatei nennt, die sie mit dem Aufruf ihrer Art ausführt (`runnerCall`);
// `test/seed-varianten.test.ts` wendet das auf die Registry an.
//
// Neue Variante: Definition ergänzen, hier eintragen und mit dem Aufruf ihrer Art in einem Test ausführen.

export type SeedVariantKind = 'seed-manifest' | 'laufzeitprofil' | 'geraetekonfiguration';

export type SeedVariant = Readonly<{
  kind: SeedVariantKind;
  key: string;
  /** Repo-relative Testdateien, die die Variante mit ihrem Schlüssel ausführen. */
  tests: readonly string[];
}>;

const manifestSuite = 'apps/backend/test/seed-manifeste-app.test.ts';
const randzustaende = 'apps/backend/test/seed-randzustaende-app.test.ts';
const syncSzenarien = 'apps/backend/test/seed-sync-szenarien-app.test.ts';
const profiles = 'apps/mobile/src/test-capabilities/profiles.test.ts';

const manifest = (key: string, ...tests: string[]): SeedVariant => ({ kind: 'seed-manifest', key, tests: [manifestSuite, ...tests] });
const profile = (key: string): SeedVariant => ({ kind: 'laufzeitprofil', key, tests: [profiles] });

export const seedVariants: readonly SeedVariant[] = [
  manifest('solo', 'apps/backend/test/seed-app.test.ts'),
  manifest('solo-wasser-leer'),
  manifest('solo-wasser-erreicht'),
  manifest('solo-wasser-ueber-ziel'),
  manifest('solo-sport-erreicht'),
  manifest('solo-sport-ueber-ziel'),
  manifest('solo-ohne-wiegetag'),
  manifest('solo-gewicht-steigend'),
  manifest('solo-gewicht-ohne-14-tage'),
  manifest('solo-haltemodus'),
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
  manifest('zwei_installationen', syncSzenarien),
  manifest('offline_sync', syncSzenarien),
  manifest('solo-energie', 'apps/backend/test/seed-island-app.test.ts'),
  manifest('rollenwahl-offen', 'apps/backend/test/seed-island-app.test.ts'),
  manifest('haelfte-voll', 'apps/backend/test/seed-island-app.test.ts'),
  manifest('doppelausgabe', 'apps/backend/test/seed-island-app.test.ts'),
  manifest('tage_ohne_app_oeffnung', 'packages/contracts/test/seeds-tagesziele.test.ts'),
  manifest('zeitzonen_reisen', 'packages/contracts/test/seeds-tagesziele.test.ts'),
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

/** Aufruf, mit dem ein Test eine Variante ihrer Art ausführt. */
export const runnerCall: Readonly<Record<SeedVariantKind, (key: string) => string>> = {
  'seed-manifest': (key) => `manifestSuite('${key}')`,
  laufzeitprofil: (key) => `profiled('${key}')`,
  geraetekonfiguration: (key) => `withDeviceConfig('${key}')`,
};

/** Testdateien, die eine der Suiten ausführt: Jest für die App, Vitest für Backend, Pakete und Repo. */
const executable = [/^apps\/mobile\/src\/.+\.test\.tsx?$/, /^apps\/backend\/test\/.+\.test\.ts$/, /^packages\/[^/]+\/test\/.+\.test\.ts$/, /^test\/.+\.test\.ts$/];

/** Übersprungene oder nur vorgemerkte Tests; eine Datei damit gilt nicht als Nachweis. */
const skipped = /\b(?:it|test|describe)\.(?:skip|todo)\b|\bx(?:it|describe)\(/;

/** Ob eine Zeile außerhalb eines Kommentars den Aufruf enthält. */
const callsOutsideComment = (source: string, call: string) =>
  source.split('\n').some((line) => line.includes(call) && !/^\s*(?:\/\/|\*|\/\*)/.test(line));

export type DefinedVariants = Readonly<Record<SeedVariantKind, readonly string[]>>;

/**
 * Was an der Registry nicht stimmt; leer, wenn alles passt. `read` liefert den Inhalt einer Testdatei
 * oder `null`, wenn es sie nicht gibt.
 */
export function variantProblems(variants: readonly SeedVariant[], defined: DefinedVariants, read: (file: string) => string | null): string[] {
  const problems: string[] = [];
  for (const kind of Object.keys(defined) as SeedVariantKind[]) {
    const registered = variants.filter((variant) => variant.kind === kind).map((variant) => variant.key);
    for (const key of new Set(registered.filter((key, index) => registered.indexOf(key) !== index))) problems.push(`${kind} ${key}: doppelt registriert`);
    for (const key of defined[kind]) if (!registered.includes(key)) problems.push(`${kind} ${key}: definiert, aber nicht registriert`);
    for (const key of registered) if (!defined[kind].includes(key)) problems.push(`${kind} ${key}: registriert, aber nicht definiert`);
  }
  for (const { kind, key, tests } of variants) {
    if (tests.length === 0) problems.push(`${kind} ${key}: kein Test`);
    const call = runnerCall[kind](key);
    let executed = false;
    for (const file of tests) {
      const source = read(file);
      if (source === null) problems.push(`${kind} ${key}: ${file} fehlt`);
      else if (!executable.some((pattern) => pattern.test(file))) problems.push(`${kind} ${key}: ${file} führt keine Testsuite aus`);
      else if (skipped.test(source)) problems.push(`${kind} ${key}: ${file} überspringt Tests`);
      else if (callsOutsideComment(source, call)) executed = true;
    }
    if (tests.length > 0 && !executed) problems.push(`${kind} ${key}: kein Test ruft ${call} auf`);
  }
  return problems;
}
