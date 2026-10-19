import { testCapabilities } from '../build-capabilities';

/**
 * Systemlinks, bevor Expo Router sie auflöst (https://docs.expo.dev/router/advanced/native-intent/).
 * Im Development Build nehmen die Testfähigkeiten ihre Deep Links an (Seed, Fehler-Adapter, #112);
 * im Produktions-Bundle gibt es sie nicht, und jeder Link bleibt unverändert.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return testCapabilities?.redirectSystemPath(path) ?? path;
}
