import type { TestCapabilities } from './test-capabilities';

/**
 * Compile-time-Grenze der Testfähigkeiten (Spezifikation 0, Abschnitt 12; #112, #114). Einziger Weg
 * von App-Code zu `src/test-capabilities/`: Seed-Deep-Link, Testuhr, Fehler-Adapter samt
 * Transport-Fehlermodus und On-Device-Suite. Es gibt sie in zwei Test-Artefakten:
 *
 * - im Development Build (`__DEV__`);
 * - im E2E-Build (#114), einem Release-Binary für Maestro, mit `EXPO_PUBLIC_E2E_BUILD=true`. Den Wert
 *   setzt Expo beim Bündeln als Literal ein (https://docs.expo.dev/guides/environment-variables/);
 *   `app.config.ts` lässt ihn nur zusammen mit `APP_VARIANT=e2e` zu.
 *
 * Im Produktions-Bundle sind beide Bedingungen Konstanten mit dem Wert `false`. Metro faltet sie
 * und entfernt den toten Zweig samt `require`, bevor es die Abhängigkeiten sammelt; die Module
 * gelangen so gar nicht erst ins Bundle. Es gibt keinen Laufzeitschalter. Der Release-Test
 * (`test/release-sperren.test.ts`) prüft das am exportierten Produktions-Bundle für jede registrierte
 * Testfähigkeit, die Gegenprobe am Development- und am E2E-Bundle. Die Bedingung steht deshalb
 * ausgeschrieben hier und nicht hinter einer Hilfsfunktion, die Metro nicht falten könnte.
 */
export const testCapabilities: TestCapabilities | null =
  __DEV__ || process.env.EXPO_PUBLIC_E2E_BUILD === 'true'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- nur so entfällt das Modul im Produktions-Bundle
      (require('./test-capabilities') as { testCapabilities: TestCapabilities }).testCapabilities
    : null;
