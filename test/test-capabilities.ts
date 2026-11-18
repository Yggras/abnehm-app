// Zentrale Registry der Testfähigkeiten (Spezifikation 0, Abschnitt 12; #112, #114). Sie führt jede
// Fähigkeit, die es nur in Test- und Development-Artefakten geben darf: Seed, Testuhr, Serveruhr,
// Fehler-Adapter, Transport-Fehlermodus, On-Device-Suite und ihr gemeinsames Gerüst. Test-Artefakte der App sind der
// Development Build und der E2E-Build (`APP_VARIANT=e2e`, ein Release-Binary für Maestro).
// `test/release-sperren.test.ts` prüft für jede registrierte Fähigkeit, dass weder das
// Produktions-Image des Backends noch das Produktions-Bundle der App sie enthält (Gegenprobe: die
// Development-Artefakte und das E2E-Bundle enthalten sie) und dass jede Datei in den Ordnern der
// Testfähigkeiten hier genau einer Fähigkeit gehört.
//
// Neue Testfähigkeit: Eintrag hier ergänzen (Module, Einstiege, Marker). Damit erhält sie ihre
// eigenen negativen Produktionsartefakt-Tests. Code der App erreicht sie nur über
// `apps/mobile/src/build-capabilities.ts`, Code des Backends nur aus `apps/backend/dev/`.

export type TestCapability = Readonly<{
  key: string;
  description: string;
  /** Repo-relative Dateien oder Ordner (mit `/` am Ende), die ausschließlich zu dieser Fähigkeit gehören. */
  modules: readonly string[];
  /** Einstiege, die es in Produktion nicht geben darf. */
  entries: Readonly<{
    /** HTTP-Routen des Development-Backends, `METHODE /pfad`. */
    backendRoutes?: readonly string[];
    /** Pfade der Deep Links in Development- und E2E-Build (`abnehmapp-dev://<pfad>`, `abnehmapp-e2e://<pfad>`). */
    deepLinks?: readonly string[];
    /** Server-Kommandos (Datei im Development-Image). */
    commands?: readonly string[];
  }>;
  /**
   * Zeichenfolgen aus dem Code der Fähigkeit, die auch ein minifiziertes Bundle behält, etwa
   * Routenpfade und Meldungstexte. Ihr Fehlen im Produktionsartefakt ist der zweite Nachweis neben den
   * Modulpfaden.
   */
  markers: readonly string[];
}>;

/**
 * Modul, das die Deep Links der Testfähigkeiten annimmt; es nennt jeden registrierten Pfad. Fehlt es im
 * Produktions-Bundle, kann dort kein Deep Link eine Testfähigkeit erreichen.
 */
export const deepLinkHandler = 'apps/mobile/src/test-capabilities/links.ts';

/** Gehört die repo-relative Datei zu einem der Module (Ordner mit `/` am Ende, sonst genau die Datei)? */
export const belongsTo = (file: string, modules: readonly string[]) =>
  modules.some((module) => (module.endsWith('/') ? file.startsWith(module) : file === module));

/** Ordner, deren Dateien vollständig Testfähigkeiten gehören (ohne Testdateien). */
export const testCapabilityRoots = ['apps/backend/dev/', 'apps/mobile/src/test-capabilities/', 'packages/contracts/seeds/'] as const;

export const testCapabilities: readonly TestCapability[] = [
  {
    key: 'seed',
    description: 'Seed-Mechanismus: Manifeste, Seed-Route und Seed-Kommando des Development-Backends, Seed-Deep-Link der App',
    modules: [
      'packages/contracts/seeds/',
      'apps/backend/dev/seed/',
      'apps/backend/dev/seed-command.ts',
      'apps/mobile/src/test-capabilities/seed/',
    ],
    entries: { backendRoutes: ['POST /dev/seed'], deepLinks: ['seed'], commands: ['apps/backend/dev/seed-command.ts'] },
    // Szenarien der Bereiche liegen als Module in `packages/contracts/seeds/`; `frisches_konto` (#138),
    // `solo-energie` und `rollenwahl-offen` (#180) sowie `tage_ohne_app_oeffnung` und `zeitzonen_reisen`
    // (#131) prüft der Release-Test zusätzlich über ihre Schlüssel. `rollenwahl-offen` schreibt sich mit
    // Bindestrich, weil `rollenwahl_offen` als Leer-Grund von `momo.character` zu Recht im
    // Produktions-Bundle steht.
    markers: ['/dev/seed', 'momo-insel-testpasswort', 'frisches_konto', 'solo-energie', 'rollenwahl-offen', 'tage_ohne_app_oeffnung', 'zeitzonen_reisen'],
  },
  {
    key: 'testuhr',
    description: 'Steuerbare Testuhr: `@abnehm/clock/testing`, Konformitäts-Testkit und die Testuhr der App, die ein Seed stellt und der Uhr-Link vorstellt',
    modules: ['packages/clock/src/testing.ts', 'packages/clock/src/conformance.ts', 'apps/mobile/src/test-capabilities/clock.ts'],
    entries: { deepLinks: ['uhr'] },
    markers: ['@abnehm/clock/testing'],
  },
  {
    // #271: Das Development-Backend liest sie statt der Systemuhr; ihr Vertrag `ServerClockRequest`
    // liegt bei den Manifesten in `packages/contracts/seeds/` (Fähigkeit `seed`).
    key: 'serveruhr',
    description:
      'Steuerbare Serveruhr des Development-Backends: Seed-Route und Seed-Kommando stellen sie auf die Uhr des Manifests, `POST /dev/uhr` auf einen Zeitpunkt; die App stellt sie mit jeder Stellung ihrer Testuhr mit',
    modules: ['apps/backend/dev/server-clock.ts', 'apps/mobile/src/test-capabilities/server-clock.ts'],
    entries: { backendRoutes: ['POST /dev/uhr'] },
    markers: ['/dev/uhr'],
  },
  {
    key: 'fehler-adapter',
    description: 'Deterministisch steuerbare Transport-, Server-, Auth- und Storage-Fehler der App',
    modules: ['apps/mobile/src/test-capabilities/faults.ts'],
    entries: { deepLinks: ['fehler'] },
    markers: ['Fehler-Adapter'],
  },
  {
    // #113: benannte Profile über Fehler-Adapter und Testuhr; Registry samt Tests in `test/seed-varianten.ts`.
    key: 'laufzeitprofile',
    description: 'Benannte, deterministische Zeit-, Transport-, Auth-, Storage- und Serverfehler über Fehler-Adapter und Testuhr, gestellt per Link `profil`',
    modules: ['apps/mobile/src/test-capabilities/profiles.ts'],
    entries: { deepLinks: ['profil'] },
    markers: ['transport-antwort-verloren'],
  },
  {
    // #114: Maestros `setAirplaneMode` gibt es nur auf Android (https://docs.maestro.dev/api-reference/commands/setairplanemode).
    key: 'transport-fehlermodus',
    description: 'iOS-Ersatz für den Flugmodus im E2E-Build: `fehler?transport=offline` meldet dem Sync zusätzlich kein Netz, die Rückkehr zu `ok` eine Netzrückkehr',
    modules: ['apps/mobile/src/test-capabilities/network.ts'],
    entries: {},
    markers: ['Transport-Fehlermodus'],
  },
  {
    key: 'geraetetest',
    description: 'On-Device-Suite mit expo-sqlite (#114): Migration, Transaktionsrollback, Persistenz nach Neustart, Pull-Seite und Cursor atomar',
    modules: ['apps/mobile/src/test-capabilities/device-suite/'],
    entries: { deepLinks: ['geraetetest'] },
    markers: ['geraetetest_neustart'],
  },
  {
    // #182: Bis „Schlüpfen“ (#184) die echte Insel anschließt, zeigt der Tab „Momo“ in Test-Artefakten
    // eine Insel aus Spielkatalog und Seed-Personen; im Produktionsbuild bleibt dort der Platzhalter.
    key: 'fixture-insel',
    description: 'Fixture-Insel der Test-Artefakte: Grundinsel des Spielkatalogs mit Objekten, Inselfortschritt Level 6 und einem Gebiet unter Nebel für den Tab „Momo“',
    modules: ['apps/mobile/src/test-capabilities/fixture-island.ts'],
    entries: {},
    markers: ['fixture_insel_nebel'],
  },
  {
    // #161: Fake des `MealVisionAnalyzer` mit Erfolg, leerer Liste, Refusal, Schemaverstoß und
    // Zeitüberschreitung. Das produktive Backend baut seinen Analyzer nur aus dem Claude-Adapter.
    key: 'fake-fotoanalyse',
    description: 'Fake der KI-Fotoanalyse (`MealVisionAnalyzer`) für Tests und das Development-Backend, umstellbar über `POST /dev/fotoanalyse`',
    modules: ['apps/backend/dev/meal-vision/'],
    entries: { backendRoutes: ['POST /dev/fotoanalyse'] },
    markers: ['fake_fotoanalyse'],
  },
  {
    key: 'testgeruest',
    description: 'Gemeinsames Gerüst: Development-Server und -App des Backends, Eingang, Deep Links und Wirt der App-Testfähigkeiten',
    modules: [
      'apps/backend/dev/main.ts',
      'apps/backend/dev/app.ts',
      'apps/mobile/src/test-capabilities/index.tsx',
      'apps/mobile/src/test-capabilities/inbox.ts',
      'apps/mobile/src/test-capabilities/links.ts',
      'apps/mobile/src/test-capabilities/TestCapabilityHost.tsx',
    ],
    entries: {},
    markers: ['Seed fehlgeschlagen'],
  },
];
