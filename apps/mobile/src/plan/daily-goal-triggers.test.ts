/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { followDailyGoalTriggers } from './daily-goal-triggers';

// Nachweis für #131: Auslöser von „Tagesziele sicherstellen“ (Spezifikation 1, Abschnitt 5). Jeder
// Auslöser stellt den heutigen Tag sicher: App-Start, Wechsel in den Vordergrund und der lokale
// Tageswechsel bei geöffneter App. Der Takt allein löst nichts aus, solange der Tag derselbe bleibt.

function sources() {
  const clock = createTestClock({ instant: Instant.parse('2026-10-14T21:58:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
  const listeners = { foreground: [] as (() => void)[], tick: [] as (() => void)[] };
  const ensured: string[] = [];
  const errors: unknown[] = [];
  let failing = false;
  const stop = followDailyGoalTriggers({
    ensure: () => {
      if (failing) throw new Error('kaputt');
      ensured.push(clock.read().localDate);
    },
    today: () => clock.read().localDate,
    observeForeground: (listener) => {
      listeners.foreground.push(listener);
      return () => listeners.foreground.splice(listeners.foreground.indexOf(listener), 1);
    },
    observeTicks: (listener) => {
      listeners.tick.push(listener);
      return () => listeners.tick.splice(listeners.tick.indexOf(listener), 1);
    },
    onError: (error) => errors.push(error),
  });
  return {
    clock,
    ensured,
    errors,
    stop,
    foreground: () => listeners.foreground.forEach((listener) => listener()),
    tick: () => listeners.tick.forEach((listener) => listener()),
    fail: () => {
      failing = true;
    },
    listeners,
  };
}

describe('Auslöser für Tagesziele sicherstellen', () => {
  it('stellt beim App-Start sofort den heutigen Tag sicher', () => {
    expect(sources().ensured).toEqual(['2026-10-14']);
  });

  it('stellt bei jeder Rückkehr in den Vordergrund sicher, auch am selben Tag', () => {
    const world = sources();
    world.foreground();
    world.foreground();
    expect(world.ensured).toEqual(['2026-10-14', '2026-10-14', '2026-10-14']);
  });

  it('stellt bei geöffneter App am lokalen Tageswechsel sicher, sonst nicht', () => {
    const world = sources();
    world.tick();
    world.clock.advanceBy(60_000);
    world.tick();
    expect(world.ensured).toEqual(['2026-10-14']);

    // 22:00 UTC ist Mitternacht in Berlin.
    world.clock.advanceBy(60_000);
    world.tick();
    world.tick();
    expect(world.ensured).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('meldet einen Fehler, ohne die Auslöser zu beenden', () => {
    const world = sources();
    world.fail();
    world.foreground();
    expect(world.errors).toEqual([new Error('kaputt')]);
    expect(world.listeners.foreground).toHaveLength(1);
  });

  it('löst nach dem Beenden nichts mehr aus', () => {
    const world = sources();
    world.stop();
    expect(world.listeners).toEqual({ foreground: [], tick: [] });
  });
});
