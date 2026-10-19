import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import tseslint from 'typescript-eslint';

import abnehm from './eslint/abnehm-plugin.js';

// Globale Objekte für Netzwerk, Plattform und Laufzeitumgebung. Im Vertragsmodul und in der Uhr
// verboten; die tsconfig beider Pakete kennt sie ohnehin nicht (keine DOM- und Node-Typen).
const platformGlobals = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'process',
  'Buffer',
  'require',
  '__dirname',
  '__filename',
].map((name) => ({ name, message: 'Plattform- und Netzwerk-APIs gehören nicht in dieses Paket.' }));

/** Erlaubt nur die genannten Pakete und relative Importe; alles andere ist verboten. */
function onlyImports(allowed, message) {
  const alternatives = [...allowed.map((name) => `${name.replace('/', '\\/')}(?:\\/|$)`), '\\.{1,2}\\/'];
  return {
    'no-restricted-imports': ['error', { patterns: [{ regex: `^(?!${alternatives.join('|')})`, message }] }],
    'no-restricted-globals': ['error', ...platformGlobals],
    'no-restricted-syntax': [
      'error',
      { selector: 'ImportExpression', message: 'Dynamische Importe umgehen die Importgrenze.' },
    ],
  };
}

const testOnlyClock = {
  group: ['@abnehm/clock/testing', '@abnehm/clock/conformance'],
  message: 'Testuhr und Konformitäts-Testkit sind nur in Testdateien erlaubt.',
};

const testOnlyFixtures = {
  group: ['@abnehm/contracts/fixtures'],
  message: 'Vertrags-Fixtures sind nur in Testdateien erlaubt.',
};

const testOnlySeeds = {
  group: ['@abnehm/contracts/seeds'],
  message: 'Seed-Manifeste gibt es nur in Tests und Testfähigkeiten (apps/backend/dev/, apps/mobile/src/test-capabilities/).',
};

/** App-Code erreicht die Testfähigkeiten nur über die Compile-time-Grenze `src/build-capabilities.ts` (#112). */
const testCapabilitiesViaGate = {
  regex: '(^|/)test-capabilities(/|$)',
  allowTypeImports: true,
  message: 'Testfähigkeiten nur über `testCapabilities` aus src/build-capabilities.ts; sonst gelangen sie ins Produktions-Bundle.',
};

/** Produktionscode des Backends kennt das Development-Backend nicht; das Produktions-Image hat es nicht (#112). */
const noDevelopmentBackend = {
  regex: '^(\\.\\./)+dev(/|$)',
  message: 'apps/backend/dev/ gehört nur ins Development-Image.',
};

const backendTypesOnly = {
  group: ['@abnehm/backend', '@abnehm/backend/*'],
  allowTypeImports: true,
  message: 'Die App nutzt vom Backend nur Typen (Hono RPC), nie Laufzeitcode.',
};

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/.expo/',
    'apps/mobile/ios/',
    'apps/mobile/android/',
    'prototypes/',
    'spikes/',
    '.claude/',
    '.pi/',
  ]),

  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    ignores: ['apps/mobile/**'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ['apps/mobile/**/*.{js,jsx,ts,tsx}'],
    extends: [expoConfig],
    settings: { 'import/resolver': { typescript: { project: 'apps/mobile/tsconfig.json' } } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },

  // Importgrenzen
  {
    files: ['packages/contracts/src/**', 'packages/contracts/fixtures/**'],
    rules: onlyImports(
      ['zod'],
      'Das Vertragsmodul ist frameworkarm: nur Zod und eigene Dateien, keine React-, Drizzle-, Netzwerk- oder Plattform-APIs.',
    ),
  },
  {
    files: ['packages/clock/src/**'],
    rules: onlyImports(
      ['@abnehm/contracts'],
      'Die Uhr nutzt nur das Vertragsmodul und den Sprachstandard (Date, Intl).',
    ),
  },
  {
    files: ['apps/backend/src/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [testOnlyClock, testOnlyFixtures, testOnlySeeds, noDevelopmentBackend] }] },
  },
  {
    // Development-Backend (#112): darf die Seed-Manifeste nutzen, aber weder Testuhr noch Vertrags-Fixtures.
    files: ['apps/backend/dev/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [testOnlyClock, testOnlyFixtures] }] },
  },
  {
    // Bereichscode liest Zeitpunkt, Zone und lokalen Tag nur über die Uhr (`@abnehm/clock`).
    // Einzige Ausnahme ist der Geräteadapter der App, der Systemzeit und Gerätezone kapselt.
    files: ['apps/*/src/**', 'apps/backend/dev/**'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/mobile/src/clock/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Die aktuelle Zeit kommt aus der Uhr (useClock() bzw. Clock), nicht aus Date.now().',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.name='Date']",
          message: 'Die aktuelle Zeit kommt aus der Uhr (useClock() bzw. Clock), nicht aus Date().',
        },
        {
          selector: "CallExpression[callee.property.name='resolvedOptions']",
          message: 'Die Zeitzone kommt aus der Uhr (reading.timeZone), nicht aus Intl.',
        },
      ],
    },
  },
  // Die App: vom Backend nur Typen; Testuhr nur in Tests; die Gerätezone nur im Geräteadapter.
  // Spätere Blöcke ersetzen die Regel der früheren für dieselbe Datei vollständig.
  {
    files: ['apps/mobile/src/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [backendTypesOnly, testOnlyClock, testOnlyFixtures, testOnlySeeds, testCapabilitiesViaGate] }] },
  },
  {
    files: ['apps/mobile/src/**'],
    ignores: ['apps/mobile/src/clock/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'expo-localization', message: 'Die Gerätezone kommt aus der Uhr (useClock()).' }],
          patterns: [backendTypesOnly, testOnlyClock, testOnlyFixtures, testOnlySeeds, testCapabilitiesViaGate],
        },
      ],
    },
  },
  {
    // Die Grenze selbst lädt die Testfähigkeiten; sie fallen im Produktions-Bundle mit `__DEV__` weg (#112).
    files: ['apps/mobile/src/build-capabilities.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [backendTypesOnly, testOnlyClock, testOnlyFixtures, testOnlySeeds] }] },
  },
  {
    // Testfähigkeiten der App (#112): Seed-Manifeste und Testuhr erlaubt, Vertrags-Fixtures nicht.
    files: ['apps/mobile/src/test-capabilities/**'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'expo-localization', message: 'Die Gerätezone kommt aus der Uhr (useClock()).' }],
          patterns: [backendTypesOnly, testOnlyFixtures],
        },
      ],
    },
  },
  {
    // Test-Helfer unter `testing/` dürfen die Test-Entitäten aus den Vertrags-Fixtures nutzen; App-Code
    // importiert sie nie, so gelangen sie nicht ins Bundle.
    files: ['apps/mobile/src/**/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'expo-localization', message: 'Die Gerätezone kommt aus der Uhr (useClock()).' }],
          patterns: [backendTypesOnly, testOnlyClock],
        },
      ],
    },
  },
  // Design-System: Farben nur aus den Tokens; Plattformbibliotheken nur hinter ihrem Projektmodul.
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'apps/mobile/src/design/tokens.ts'],
    plugins: { abnehm },
    rules: {
      'abnehm/token-farben': 'error',
      'abnehm/bibliotheksgrenzen': [
        'error',
        [
          {
            modules: ['expo-haptics'],
            allowedIn: ['apps/mobile/src/haptics/'],
            message: 'Haptik läuft über `Haptics.feedback(kind)` aus apps/mobile/src/haptics/.',
          },
          {
            modules: ['@expo/ui'],
            allowedIn: ['apps/mobile/src/design/native/'],
            message: 'Native Elemente kommen als Hüllen aus dem Design-System (Sheet, Switch, DateTimePicker, ContextMenu).',
          },
          {
            modules: ['expo-font', '@expo-google-fonts'],
            allowedIn: ['apps/mobile/src/design/fonts.ts'],
            message: 'Schriften lädt `useDesignFonts()`; Texte nutzen `Text` mit einem Textstil.',
          },
          {
            // Auch `useLiveQuery` von Drizzle: Beobachtet wird über `LocalDatabase.observe`, das den Kontowechsel kennt.
            modules: ['expo-sqlite', 'drizzle-orm/expo-sqlite'],
            allowedIn: ['apps/mobile/src/local-db/expo-connection.ts', 'apps/mobile/src/local-db/migrate.ts'],
            message: 'Die lokale Datenbank läuft über `LocalDatabases` aus apps/mobile/src/local-db/.',
          },
          {
            modules: ['better-sqlite3', 'drizzle-orm/better-sqlite3'],
            allowedIn: ['apps/mobile/src/local-db/testing/'],
            message: 'better-sqlite3 ist nur der Test-Adapter der lokalen Datenbank (local-db/testing/).',
          },
          {
            modules: ['expo-secure-store'],
            allowedIn: ['apps/mobile/src/auth/secure-session-store.ts'],
            message: 'Die Sitzung liegt nur über das Auth-Modul in SecureStore (apps/mobile/src/auth/).',
          },
        ],
      ],
    },
  },
  {
    // Tests dürfen Testuhr und Testkit nutzen und expo-localization mocken.
    files: ['apps/mobile/src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [backendTypesOnly] }] },
  },
]);
