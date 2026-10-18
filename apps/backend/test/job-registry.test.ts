import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createJobRegistry, type Job } from '../src/jobs/job-registry.ts';

// Job-Registry (Spezifikation 0, Abschnitt 9; #97): Fälligkeit nach der Uhr, ausgelöst über die Testuhr.

const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('UTC') };

function countingJob(name: string, intervalMs: number, run: () => Promise<void> = async () => {}) {
  const job = {
    name,
    intervalMs,
    runs: 0,
    run: async () => {
      job.runs++;
      await run();
    },
  };
  return job;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Job-Registry', () => {
  it('führt einen Job beim ersten Durchgang und danach je abgelaufenem Intervall aus', async () => {
    const clock = createTestClock(start);
    const jobs = createJobRegistry({ clock });
    const hourly = countingJob('stuendlich', 60 * 60_000);
    const daily = countingJob('taeglich', 24 * 60 * 60_000);
    jobs.register(hourly);
    jobs.register(daily);

    await jobs.runDue();
    await jobs.runDue();
    expect([hourly.runs, daily.runs]).toEqual([1, 1]);

    clock.advanceBy(60 * 60_000 - 1);
    await jobs.runDue();
    expect([hourly.runs, daily.runs]).toEqual([1, 1]);

    clock.advanceBy(1);
    await jobs.runDue();
    expect([hourly.runs, daily.runs]).toEqual([2, 1]);

    clock.advanceBy(23 * 60 * 60_000);
    await jobs.runDue();
    expect([hourly.runs, daily.runs]).toEqual([3, 2]);
  });

  it('startet einen noch laufenden Job nicht doppelt', async () => {
    const clock = createTestClock(start);
    const jobs = createJobRegistry({ clock });
    let finish = () => {};
    const slow = countingJob('langsam', 1_000, () => new Promise<void>((resolve) => (finish = resolve)));
    jobs.register(slow);

    const first = jobs.runDue();
    clock.advanceBy(5_000);
    const second = jobs.runDue();
    finish();
    await Promise.all([first, second]);

    expect(slow.runs).toBe(1);
  });

  it('lässt die übrigen Jobs laufen, wenn einer scheitert, und versucht ihn im nächsten Intervall erneut', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = createTestClock(start);
    const jobs = createJobRegistry({ clock });
    const failing = countingJob('scheitert', 1_000, async () => {
      throw new Error('kaputt');
    });
    const healthy = countingJob('gesund', 1_000);
    jobs.register(failing);
    jobs.register(healthy);

    await jobs.runDue();
    clock.advanceBy(1_000);
    await jobs.runDue();

    expect([failing.runs, healthy.runs]).toEqual([2, 2]);
    expect(console.error).toHaveBeenCalledWith('[jobs] scheitert fehlgeschlagen:', 'Error');
  });

  it('lehnt doppelte Namen und ungültige Intervalle ab', () => {
    const jobs = createJobRegistry({ clock: createTestClock(start) });
    jobs.register(countingJob('einmalig', 1_000));

    expect(() => jobs.register(countingJob('einmalig', 1_000))).toThrow(/bereits registriert/);
    for (const intervalMs of [0, -1, 1.5]) {
      expect(() => jobs.register(countingJob(`intervall-${intervalMs}`, intervalMs))).toThrow(/Intervall/);
    }
  });

  it('prüft im Backend-Prozess regelmäßig auf fällige Jobs und hält auf Wunsch an', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clock = createTestClock(start);
    const jobs = createJobRegistry({ clock });
    const job: Job & { runs: number } = countingJob('minuetlich', 60_000);
    jobs.register(job);

    const stop = jobs.start({ pollIntervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(job.runs).toBe(1);

    clock.advanceBy(60_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(job.runs).toBe(2);

    await stop();
    clock.advanceBy(60_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(job.runs).toBe(2);
  });
});
