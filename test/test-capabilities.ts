// Zentrale Registry der Testfähigkeiten (Spezifikation 0, Abschnitt 12; #112, #114). Sie führt jede
// Fähigkeit, die es nur in Test- und Development-Artefakten geben darf: Seed, Testuhr, Serveruhr,
// Fehler-Adapter, Transport-Fehlermodus, On-Device-Suite, Health-Attrappe und ihr gemeinsames Gerüst. Test-Artefakte der App sind der
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
    // `solo-energie` und `rollenwahl-offen` (#180), `tage_ohne_app_oeffnung` und `zeitzonen_reisen`
    // (#131), `haelfte-voll` und `doppelausgabe` (#191) sowie die Szenarien der Einstellungsseite „Ziele“
    // (#147) prüft der Release-Test zusätzlich über ihre Schlüssel. `rollenwahl-offen` schreibt sich mit Bindestrich, weil `rollenwahl_offen` als Leer-Grund
    // von `momo.character` zu Recht im Produktions-Bundle steht.
    markers: [
      '/dev/seed', 'momo-insel-testpasswort', 'frisches_konto', 'solo-energie', 'rollenwahl-offen', 'tage_ohne_app_oeffnung', 'zeitzonen_reisen',
      'haelfte-voll', 'doppelausgabe', 'solo-haltemodus-schwanger', 'solo-haltemodus-essstoerung', 'solo-haltemodus-untergewicht', 'solo-budget-angehoben', 'solo-ziele-ab-morgen',
    ],
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
    // #161: Fake des `MealVisionAnalyzer` mit Erfolg, leerer Liste, Refusal, Schemaverstoß und
    // Zeitüberschreitung. Das produktive Backend baut seinen Analyzer nur aus dem Claude-Adapter.
    key: 'fake-fotoanalyse',
    description: 'Fake der KI-Fotoanalyse (`MealVisionAnalyzer`) für Tests und das Development-Backend, umstellbar über `POST /dev/fotoanalyse`',
    modules: ['apps/backend/dev/meal-vision/'],
    entries: { backendRoutes: ['POST /dev/fotoanalyse'] },
    markers: ['fake_fotoanalyse'],
  },
  {
    // #183: Attrappe des Health-Plattform-Adapters mit den Szenarien aus Spezifikation 3, Abschnitt 9. Die
    // Integrationstests nutzen sie direkt, Development- und E2E-Build per Link `health`; im Produktionsbuild
    // gilt der Adapter der Plattform.
    key: 'health-attrappe',
    description: 'Deterministisch steuerbare Health-Attrappe (Plattform-Adapter) mit Szenarien, gestellt per Link `health?szenario=<name>`',
    modules: ['apps/mobile/src/health/testing/', 'apps/mobile/src/test-capabilities/health.ts'],
    entries: { deepLinks: ['health'] },
    markers: ['health_attrappe'],
  },
  {
    // #125: speicherbasierter Fake des Mitteilungs-Ports (Spezifikation 5, Abschnitt 8). In Test-Artefakten
    // schaltet der Link `mitteilungen` bzw. ein Seed mit `notificationPermission` die App auf ihn um.
    key: 'mitteilungen',
    description:
      'Fake-Mitteilungs-Port mit steuerbarer Erlaubnis und steuerbaren Fehlern; in Test-Artefakten per Link `mitteilungen?erlaubnis=…` oder Seed statt des echten Ports',
    modules: ['apps/mobile/src/test-capabilities/notifications.ts'],
    entries: { deepLinks: ['mitteilungen'] },
    markers: ['Fake-Mitteilungs-Port'],
  },
  {
    // #187: Galerie des Momo-Rigs für Geräteprüfung und Impeccable-Critique; Momo selbst ist Produktcode.
    key: 'momo-galerie',
    description: 'Momo-Galerie: beide Formen in allen Stimmungen mit Accessoires und Momo im Insel-Canvas, per Link `momo-galerie?ansicht=heute|insel`',
    modules: ['apps/mobile/src/test-capabilities/momo-gallery/'],
    entries: { deepLinks: ['momo-galerie'] },
    markers: ['Momo-Galerie'],
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
