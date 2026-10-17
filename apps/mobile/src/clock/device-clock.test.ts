import { clockConformanceCases, type ClockHarnessFactory } from '@abnehm/clock/conformance';
import { getCalendars, type Calendar } from 'expo-localization';

import { deviceClock } from './device-clock';

jest.mock('expo-localization', () => ({ getCalendars: jest.fn() }));

function systemReportsTimeZone(timeZone: string | null) {
  const calendar: Calendar = { calendar: null, timeZone, uses24hourClock: true, firstWeekday: 2 };
  jest.mocked(getCalendars).mockReturnValue([calendar]);
}

afterEach(() => {
  jest.useRealTimers();
});

describe('Konformität der Geräteuhr', () => {
  // Echter Produktionsadapter: Systemzeit über Jests Fake-Timer, Gerätezone über expo-localization.
  const harness: ClockHarnessFactory = (start) => {
    jest.useFakeTimers({ now: Date.parse(start.instant) });
    systemReportsTimeZone(start.timeZone);
    return {
      clock: deviceClock,
      setInstant: (instant) => jest.setSystemTime(Date.parse(instant)),
      setTimeZone: (timeZone) => systemReportsTimeZone(timeZone),
    };
  };

  for (const conformanceCase of clockConformanceCases(harness)) {
    test(conformanceCase.name, conformanceCase.run);
  }
});

test('nimmt die Zone der Laufzeit, wenn das System keine Zone meldet', () => {
  systemReportsTimeZone(null);

  expect(deviceClock.read().timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});
