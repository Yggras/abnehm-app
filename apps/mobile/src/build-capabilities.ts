import type { TestCapabilities } from './test-capabilities';

/**
 * Compile-time-Grenze der Testfähigkeiten (Spezifikation 0, Abschnitt 12; #112). Einziger Weg von
 * App-Code zu `src/test-capabilities/`: Seed-Deep-Link, Testuhr und Fehler-Adapter. Metro setzt
 * `__DEV__` im Produktions-Bundle als `false` ein und entfernt den toten Zweig samt `require`, bevor
 * es die Abhängigkeiten sammelt; die Module gelangen so gar nicht erst ins Bundle. Es gibt keinen
 * Laufzeitschalter. Der Release-Test (`test/release-sperren.test.ts`) prüft das am exportierten
 * Produktions-Bundle für jede registrierte Testfähigkeit.
 */
export const testCapabilities: TestCapabilities | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- nur so entfällt das Modul im Produktions-Bundle
    (require('./test-capabilities') as typeof import('./test-capabilities')).testCapabilities
  : null;
