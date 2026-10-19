// Zentrale Registry der Testfähigkeiten (Spezifikation 0, Abschnitt 12; #112). Sie führt jede
// Fähigkeit, die es nur in Test- und Development-Artefakten geben darf: Seed, Testuhr, Fehler-Adapter
// und ihr gemeinsames Gerüst. `test/release-sperren.test.ts` prüft für jede registrierte Fähigkeit,
// dass weder das Produktions-Image des Backends noch das Produktions-Bundle der App sie enthält
// (Gegenprobe: die Development-Artefakte enthalten sie) und dass jede Datei in den Ordnern der
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
    /** Pfade der Deep Links im Development Build (`abnehmapp-dev://<pfad>`). */
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
    markers: ['/dev/seed', 'momo-insel-testpasswort'],
  },
  {
    key: 'testuhr',
    description: 'Steuerbare Testuhr: `@abnehm/clock/testing`, Konformitäts-Testkit und die Testuhr der App, die ein Seed stellt',
    modules: ['packages/clock/src/testing.ts', 'packages/clock/src/conformance.ts', 'apps/mobile/src/test-capabilities/clock.ts'],
    entries: {},
    markers: ['@abnehm/clock/testing', '@abnehm/clock/conformance'],
  },
  {
    key: 'fehler-adapter',
    description: 'Deterministisch steuerbare Transport-, Server-, Auth- und Storage-Fehler der App',
    modules: ['apps/mobile/src/test-capabilities/faults.ts'],
    entries: { deepLinks: ['fehler'] },
    markers: ['Fehler-Adapter'],
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
