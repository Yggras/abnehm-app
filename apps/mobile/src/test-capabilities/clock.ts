import type { Clock } from '@abnehm/clock';
import { createTestClock, type ClockStart, type TestClock } from '@abnehm/clock/testing';

// Testuhr der App (Spezifikation 0, Abschnitt 12; #112): Bis ein Seed sie stellt, liest sie die
// Geräteuhr; danach steht sie auf der Uhr des Manifests und läuft nur, wenn ein Test sie stellt.
// Nur im Development Build und in Tests, nie im Produktions-Bundle (Release-Test).

export type AppTestClock = Clock & {
  /** Stellt die Uhr fest auf Zeitpunkt und Zone, etwa auf die Uhr eines Seed-Manifests. */
  fix(start: ClockStart): void;
  /** Die gestellte Uhr zum Weiterstellen, oder `null`, solange die Geräteuhr gilt. */
  fixed(): TestClock | null;
  /** Zurück zur Geräteuhr. */
  release(): void;
};

export function createAppTestClock(device: Clock): AppTestClock {
  let fixed: TestClock | null = null;
  return {
    read: (timeZone) => (fixed ?? device).read(timeZone),
    fix: (start) => {
      fixed = createTestClock(start);
    },
    fixed: () => fixed,
    release: () => {
      fixed = null;
    },
  };
}
