import { afterEach, describe, expect, it, vi } from 'vitest';

import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createSystemClock, localDateAt } from '../src/clock.ts';
import { clockConformanceCases, type ClockHarness } from '../src/conformance.ts';
import { createTestClock } from '../src/testing.ts';

describe('Konformität der Systemuhr', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const harness = (start: { instant: Instant; timeZone: TimeZone }): ClockHarness => {
    // Die Systemuhr liest die echte Systemzeit; der Test verstellt sie über Vitests Fake-Timer.
    vi.useFakeTimers({ now: Date.parse(start.instant) });
    let deviceTimeZone: string = start.timeZone;
    return {
      clock: createSystemClock({ timeZone: () => deviceTimeZone }),
      setInstant: (instant) => vi.setSystemTime(Date.parse(instant)),
      setTimeZone: (timeZone) => {
        deviceTimeZone = timeZone;
      },
    };
  };

  for (const conformanceCase of clockConformanceCases(harness)) {
    it(conformanceCase.name, conformanceCase.run);
  }

  it('meldet eine ungültige Zone der Zonenquelle als Fehler', () => {
    const clock = createSystemClock({ timeZone: () => 'Mars/Olympus_Mons' });
    expect(() => clock.read()).toThrow();
  });
});

describe('Konformität der Testuhr', () => {
  const harness = (start: { instant: Instant; timeZone: TimeZone }): ClockHarness => {
    const clock = createTestClock(start);
    return { clock, setInstant: (instant) => clock.set(instant), setTimeZone: (zone) => clock.setTimeZone(zone) };
  };

  for (const conformanceCase of clockConformanceCases(harness)) {
    it(conformanceCase.name, conformanceCase.run);
  }
});

describe('localDateAt', () => {
  it.each([
    ['2026-10-25T01:30:00.000Z', 'Europe/Berlin', '2026-10-25'],
    ['2026-10-25T23:00:00.000Z', 'Europe/Berlin', '2026-10-26'],
    ['2026-10-14T10:00:00.000Z', 'Pacific/Pago_Pago', '2026-10-13'],
  ])('ordnet %s in %s dem Tag %s zu', (instant, timeZone, localDate) => {
    expect(localDateAt(Instant.parse(instant), TimeZone.parse(timeZone))).toBe(localDate);
  });
});

describe('Testuhr', () => {
  it('läuft nur, wenn der Test sie stellt', () => {
    const clock = createTestClock({
      instant: Instant.parse('2026-10-14T12:00:00.000Z'),
      timeZone: TimeZone.parse('Europe/Berlin'),
    });

    clock.advanceBy(90 * 60 * 1000);

    expect(clock.read()).toEqual({
      instant: '2026-10-14T13:30:00.000Z',
      timeZone: 'Europe/Berlin',
      localDate: '2026-10-14',
    });
    expect(clock.read()).toEqual(clock.read());
  });

  it('lehnt eine ungültige Zone ab', () => {
    const clock = createTestClock({
      instant: Instant.parse('2026-10-14T12:00:00.000Z'),
      timeZone: TimeZone.parse('Europe/Berlin'),
    });

    expect(() => clock.setTimeZone('Mars/Olympus_Mons' as TimeZone)).toThrow();
  });
});
