import type { Clock } from '@abnehm/clock';
import type { TimeZone } from '@abnehm/contracts/base';
import { createTestClock, type ClockStart, type TestClock } from '@abnehm/clock/testing';

// Testuhr der App (Spezifikation 0, Abschnitt 12; #112): Bis ein Seed sie stellt, liest sie die
// Geräteuhr; danach steht sie auf der Uhr des Manifests und läuft nur, wenn ein Test sie stellt,
// etwa Maestro über den Deep Link `uhr` (#114). Nur in Test-Artefakten und Tests, nie im
// Produktions-Bundle (Release-Test).

/** Vorstellen der Uhr: Stunden vorwärts und/oder eine neue eigene Zone (Reise). */
export type ClockAdjustment = Readonly<{ advanceHours?: number; timeZone?: TimeZone }>;

export type AppTestClock = Clock & {
  /** Stellt die Uhr fest auf Zeitpunkt und Zone, etwa auf die Uhr eines Seed-Manifests. */
  fix(start: ClockStart): void;
  /** Stellt die Uhr vor; eine noch freie Uhr steht danach fest, ausgehend von der Geräteuhr. */
  adjust(adjustment: ClockAdjustment): void;
  /** Die gestellte Uhr zum Weiterstellen, oder `null`, solange die Geräteuhr gilt. */
  fixed(): TestClock | null;
  /** Zurück zur Geräteuhr. */
  release(): void;
  /**
   * Nach jedem Stellen. Wer die Uhr sonst nur im Takt liest, etwa Sync-Status und Zeitzone der
   * Person, liest dann sofort neu.
   */
  subscribe(listener: () => void): () => void;
};

export function createAppTestClock(device: Clock): AppTestClock {
  let fixed: TestClock | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    read: (timeZone) => (fixed ?? device).read(timeZone),
    fix: (start) => {
      fixed = createTestClock(start);
      changed();
    },
    adjust: ({ advanceHours, timeZone }) => {
      const clock = fixed ?? createTestClock(device.read());
      fixed = clock;
      if (advanceHours !== undefined) clock.advanceBy(advanceHours * 60 * 60 * 1000);
      if (timeZone !== undefined) clock.setTimeZone(timeZone);
      changed();
    },
    fixed: () => fixed,
    release: () => {
      fixed = null;
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
