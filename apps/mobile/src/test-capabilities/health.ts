import type { Clock } from '@abnehm/clock';

import type { HealthConnectOutcome, HealthPlatformAdapter } from '../health';
import { appHealthImport } from '../health/app-health';
import { applyHealthScenario, createFakeHealthPlatform, type FakeHealthPlatform, type HealthScenario } from '../health/testing/fake-platform';

// Health-Attrappe in Test-Artefakten (Spezifikation 3, Abschnitt 9; #183): Development- und E2E-Build
// stellen sie per Link `health?szenario=<name>`. Bis zum ersten Link reicht der Adapter jeden Aufruf an
// die Plattform des Builds durch; danach antwortet die Attrappe. Nach dem Szenario verbindet der Link den
// Health-Import des geöffneten Kontos, damit die Daten ohne Onboarding-Schritt ankommen. Registriert als
// Testfähigkeit `health-attrappe` (`test/test-capabilities.ts`).

export type TestHealth = Readonly<{
  /** Umhüllt den Adapter der Plattform; einmal je Prozess. */
  platform(inner: HealthPlatformAdapter): HealthPlatformAdapter;
  /** Stellt die Attrappe auf ein Szenario und verbindet; ohne geöffnetes Konto `null`. */
  apply(scenario: HealthScenario): Promise<HealthConnectOutcome | null>;
}>;

export function createTestHealth(clock: Clock): TestHealth {
  let fake: FakeHealthPlatform | null = null;
  let active = false;

  return {
    platform(inner) {
      const own = createFakeHealthPlatform({ origin: inner.origin, clock });
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
      active = true;
      await applyHealthScenario(fake, scenario, clock);
      return (await appHealthImport.current()?.connect()) ?? null;
    },
  };
}
