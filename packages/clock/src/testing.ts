import { Instant, TimeZone } from '@abnehm/contracts/base';

import type { Clock } from './clock.ts';
import { readingAt } from './reading.ts';

/**
 * Steuerbare Testuhr. Sie steht still, bis der Test sie stellt.
 * Nur in Tests und Development-Artefakten erlaubt; die Lint-Regeln sperren
 * `@abnehm/clock/testing` für Produktionscode.
 */
export type TestClock = Clock & {
  set(instant: Instant): void;
  advanceBy(milliseconds: number): void;
  setTimeZone(timeZone: TimeZone): void;
};

/** Womit eine Uhr im Test startet: Zeitpunkt und eigene Zone. */
export type ClockStart = { instant: Instant; timeZone: TimeZone };

export function createTestClock(start: ClockStart): TestClock {
  let epochMilliseconds = Date.parse(Instant.parse(start.instant));
  let ownTimeZone = TimeZone.parse(start.timeZone);
  return {
    read: (timeZone) => readingAt(epochMilliseconds, timeZone ?? ownTimeZone),
    set: (instant) => {
      epochMilliseconds = Date.parse(Instant.parse(instant));
    },
    advanceBy: (milliseconds) => {
      epochMilliseconds += milliseconds;
    },
    setTimeZone: (timeZone) => {
      ownTimeZone = TimeZone.parse(timeZone);
    },
  };
}
