import { describe, expect, it } from 'vitest';

import { clockConformanceCases, type ClockHarnessFactory } from '@abnehm/clock/conformance';
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createServerClock } from '../dev/server-clock.ts';

// Steuerbare Serveruhr des Development-Backends (#271): die Systemuhr, um eine Verschiebung gestellt.
// Hier steht eine Testuhr für die Systemuhr; sie zeigt einen anderen Tag als jeder gestellte Zeitpunkt.

const systemStart = { instant: Instant.parse('2026-11-04T09:00:00.000Z'), timeZone: TimeZone.parse('UTC') };

describe('Konformität der Serveruhr', () => {
  const harness: ClockHarnessFactory = (start) => {
    const system = createTestClock({ ...systemStart, timeZone: start.timeZone });
    const clock = createServerClock(system);
    clock.set(start.instant);
    return { clock, setInstant: (instant) => clock.set(instant), setTimeZone: (zone) => system.setTimeZone(zone) };
  };

  for (const conformanceCase of clockConformanceCases(harness)) {
    it(conformanceCase.name, conformanceCase.run);
  }
});

describe('Serveruhr', () => {
  it('liest ungestellt genau die Systemuhr', () => {
    const system = createTestClock(systemStart);
    const clock = createServerClock(system);

    expect(clock.read()).toEqual(system.read());
    expect(clock.read(TimeZone.parse('Europe/Berlin'))).toEqual(system.read(TimeZone.parse('Europe/Berlin')));
  });

  it('steht nach dem Stellen auf dem Zeitpunkt und läuft mit der Systemuhr weiter', () => {
    const system = createTestClock(systemStart);
    const clock = createServerClock(system);

    clock.set(Instant.parse('2026-10-14T12:00:00.000Z'));
    expect(clock.read(TimeZone.parse('Europe/Berlin'))).toEqual({
      instant: '2026-10-14T12:00:00.000Z',
      timeZone: 'Europe/Berlin',
      localDate: '2026-10-14',
      utcOffsetMinutes: 120,
    });

    system.advanceBy(13 * 60 * 60 * 1000);
    expect(clock.read(TimeZone.parse('Europe/Berlin'))).toMatchObject({ instant: '2026-10-15T01:00:00.000Z', localDate: '2026-10-15' });
  });

  it('jedes Stellen gilt absolut, auch rückwärts', () => {
    const system = createTestClock(systemStart);
    const clock = createServerClock(system);

    clock.set(Instant.parse('2026-10-15T13:00:00.000Z'));
    clock.set(Instant.parse('2026-10-14T12:00:00.000Z'));

    expect(clock.read().instant).toBe('2026-10-14T12:00:00.000Z');
  });

  it('liest ohne Zone in der Zone der Systemuhr, im Backend also UTC', () => {
    const clock = createServerClock(createTestClock(systemStart));
    clock.set(Instant.parse('2026-10-14T23:30:00.000Z'));

    expect(clock.read()).toEqual({ instant: '2026-10-14T23:30:00.000Z', timeZone: 'UTC', localDate: '2026-10-14', utcOffsetMinutes: 0 });
  });
});
