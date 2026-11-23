import type { Clock } from '@abnehm/clock';

import type { HealthConnectOutcome, HealthPlatformAdapter } from '../health';
import { appHealthImport } from '../health/app-health';
import { applyHealthScenario, createFakeHealthPlatform, type FakeHealthPlatform } from '../health/testing/fake-platform';
import type { TestHealthScenario } from './health-scenarios';

// Health-Attrappe in Test-Artefakten (Spezifikation 3, Abschnitt 9; #183): Development- und E2E-Build
// stellen sie per Link `health?szenario=<name>`. Bis zum ersten Link reicht der Adapter jeden Aufruf an
// die Plattform des Builds durch; danach antwortet die Attrappe. Nach dem Szenario verbindet der Link den
// Health-Import des geöffneten Kontos, damit die Daten ohne Onboarding-Schritt ankommen. Registriert als
// Testfähigkeit `health-attrappe` (`test/test-capabilities.ts`).
//
// `health?szenario=geraet` stellt zurück auf die Plattform des Builds (Health Connect bzw. HealthKit) und
// verbindet sie: der Gerätetest der echten Adapter (#195) ohne Onboarding, solange die Einstellungsseite
// (#190) fehlt.

export type TestHealth = Readonly<{
  /** Umhüllt den Adapter der Plattform; einmal je Prozess. */
  platform(inner: HealthPlatformAdapter): HealthPlatformAdapter;
  /** Stellt die Attrappe auf ein Szenario und verbindet; ohne geöffnetes Konto `null`. */
  apply(scenario: TestHealthScenario): Promise<HealthConnectOutcome | null>;
}>;

export function createTestHealth(clock: Clock): TestHealth {
  let fake: FakeHealthPlatform | null = null;
  let active = false;

  return {
    platform(inner) {
      const own = createFakeHealthPlatform({ origin: inner.origin, clock });
      // Bis die Hintergrund-Tickets (#197, #199) einen Handler anmelden, löst eine Weckung der Attrappe den
      // Import des geöffneten Kontos aus; so serialisiert auch `zwei_weckungen` im Development- und E2E-Build.
      own.registerBackground(() => appHealthImport.current()?.importNow() ?? Promise.resolve());
      fake = own;
      const current = () => (active ? own : inner);
      return {
        origin: inner.origin,
        availability: () => current().availability(),
        requestReadAccess: () => current().requestReadAccess(),
        accessState: () => current().accessState(),
        readChanges: (type, cursor, since) => current().readChanges(type, cursor, since),
        recentOrigins: (days) => current().recentOrigins(days),
        backgroundCapability: () => current().backgroundCapability(),
        registerBackground(handler) {
          inner.registerBackground(handler);
          own.registerBackground(handler);
        },
      };
    },
    async apply(scenario) {
      if (fake === null) throw new Error('Die Health-Attrappe ist nicht angeschlossen');
      if (scenario === 'geraet') {
        active = false;
      } else {
        active = true;
        await applyHealthScenario(fake, scenario, clock);
      }
      return (await appHealthImport.current()?.connect()) ?? null;
    },
  };
}
