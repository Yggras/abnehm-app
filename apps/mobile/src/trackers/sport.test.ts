/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { SportEntryUpsert, SportRecordedOutcome } from '@abnehm/contracts/trackers';

import { createNutrition, type DayLog } from '../nutrition';
import { InvalidTrackerInputError } from '.';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';
import { withoutPhotos } from '../nutrition/testing/without-photos';

// Nachweis für #173: `recordSport` und sein Undo im Tracker-Modul (Spezifikation 3, Abschnitte 3 und 4)
// gegen eine echte SQLite-Datei mit denselben Migrationen wie die App, gesteuert über die Testuhr. Jeder
// Befehl ist genau eine lokale Transaktion aus Sporteintrag, Outbox-Operation und `reevaluateDailyGoals`,
// wie Wasser (#171) und Gewicht (#175). Zuletzt genutzte Art und Dauer sind Gerätezustand.

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

async function world({ at = noon }: { at?: Instant } = {}) {
  const clock = createTestClock({ instant: at, timeZone: berlin });
  const created = await createTrackerWorld(clock);
  worlds.push(created);
  return { ...created, clock };
}

/** 11:30 in Berlin am Mittwoch, 14.10.2026: 30 Minuten vor der Testuhr (12:00). */
const halfHourAgo = Instant.parse('2026-10-14T09:30:00.000Z');
const run = { activityType: 'laufen', durationMinutes: 30, startedAt: halfHourAgo, activeMilliKcal: null } as const;

describe('recordSport', () => {
  it('legt den Eintrag samt Outbox-Operation an und meldet den Tag an reevaluateDailyGoals', async () => {
    const { trackers, sports, operations, reports } = await world();

    const outcome = trackers.recordSport(run);

    expect(SportRecordedOutcome.parse(outcome)).toEqual({
      messageKey: 'sport.eingetragen', values: { activityType: 'laufen', durationMinutes: 30 }, undoToken: expect.any(String),
    });
    const [row] = sports();
    expect(sports()).toHaveLength(1);
    expect(row).toMatchObject({
      personId: philipp,
      activityType: 'laufen',
      overrideActivityType: null,
      startedAt: halfHourAgo,
      durationMinutes: 30,
      activeMilliKcal: null,
      origin: 'manuell',
      externalKey: null,
      hiddenAt: null,
      replacedByEntryId: null,
      reactivatedAt: null,
      localDate: '2026-10-14',
      timeZone: 'Europe/Berlin',
      utcOffsetMinutes: 120,
      deletedAt: null,
      serverVersion: null,
    });
    expect(operations()).toEqual([
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'sport_entry',
        entityId: row!.id,
        knownServerVersion: null,
        payload: SportEntryUpsert.parse({
          activityType: 'laufen', startedAt: halfHourAgo, durationMinutes: 30, activeMilliKcal: null, origin: 'manuell',
          replacedByEntryId: null, reactivatedAt: null, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
        }),
      }),
    ]);
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it('speichert optionale Kalorien in milli_kcal, ohne sie auf das Kalorienbudget gutzuschreiben', async () => {
    const { trackers, sports, dependencies } = await world();
    const nutrition = createNutrition({ ...dependencies, ...withoutPhotos });
    const logs: (DayLog | null)[] = [];
    const stop = nutrition.observeDayLog(LocalDate.parse('2026-10-14'), (log) => logs.push(log));

    trackers.recordSport({ ...run, activeMilliKcal: 210_000 });

    expect(sports()[0]).toMatchObject({ activeMilliKcal: 210_000 });
    // Die Tagesaufnahme, gegen die das Kalorienbudget rechnet, bleibt 0 kcal: Sport bucht nie Kalorien zurück.
    expect(logs.at(-1)).toMatchObject({ intakeKcal: 0 });
    stop();
  });

  it('bestimmt lokalen Tag und Offset aus dem Beginn, auch nachgetragen über die Zeitumstellung', async () => {
    // Die Uhr steht am 26.10. (Winterzeit, UTC+1); begonnen wurde am 24.10. um 23:30 Berlin (Sommerzeit, UTC+2).
    const { trackers, sports, reports } = await world({ at: Instant.parse('2026-10-26T08:00:00.000Z') });

    trackers.recordSport({ ...run, startedAt: Instant.parse('2026-10-24T21:30:00.000Z') });

    expect(sports()[0]).toMatchObject({ localDate: '2026-10-24', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 });
    expect(reports[0]!.localDates).toEqual(['2026-10-24']);
  });

  it('nimmt Zone und Tag der Uhr: Nach einer Reise zählt derselbe Beginn in der neuen Zone', async () => {
    const { clock, trackers, sports } = await world({ at: Instant.parse('2026-10-14T23:00:00.000Z') });
    const lateEvening = Instant.parse('2026-10-14T22:30:00.000Z');
    trackers.recordSport({ ...run, startedAt: lateEvening });

    clock.setTimeZone(TimeZone.parse('America/New_York'));
    trackers.recordSport({ ...run, startedAt: lateEvening });

    expect(sports().map(({ localDate, timeZone, utcOffsetMinutes }) => ({ localDate, timeZone, utcOffsetMinutes }))).toEqual([
      { localDate: '2026-10-15', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 },
      { localDate: '2026-10-14', timeZone: 'America/New_York', utcOffsetMinutes: -240 },
    ]);
  });

  it.each([
    ['1 Minute ohne Kalorien', { durationMinutes: 1, activeMilliKcal: null }],
    ['600 Minuten mit 0 kcal', { durationMinutes: 600, activeMilliKcal: 0 }],
    ['5000 kcal', { activeMilliKcal: 5_000_000 }],
    ['den Beginn „jetzt“', { startedAt: noon }],
  ])('nimmt %s an', async (_, change) => {
    const { trackers, sports } = await world();

    trackers.recordSport({ ...run, ...change });

    expect(sports()).toHaveLength(1);
  });

  it.each([
    ['0 Minuten', { durationMinutes: 0 }],
    ['601 Minuten', { durationMinutes: 601 }],
    ['Bruchteile von Minuten', { durationMinutes: 30.5 }],
    ['negative Kalorien', { activeMilliKcal: -1 }],
    ['über 5000 kcal', { activeMilliKcal: 5_000_001 }],
    ['eine unbekannte Art', { activityType: 'tanzen' as never }],
    ['einen Beginn in der Zukunft', { startedAt: Instant.parse('2026-10-14T10:00:01.000Z') }],
  ])('lehnt %s ab, ohne etwas zu schreiben oder zu melden', async (_, change) => {
    const { trackers, sports, operations, reports, markers } = await world();

    expect(() => trackers.recordSport({ ...run, ...change })).toThrow(InvalidTrackerInputError);

    expect(sports()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(reports).toEqual([]);
    expect(markers()).toEqual([]);
    expect(trackers.lastSport()).toBeNull();
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleiben weder Eintrag noch Operation noch Gerätezustand', async () => {
    const { trackers, sports, operations, markers, failReevaluation } = await world();
    failReevaluation(true);

    expect(() => trackers.recordSport(run)).toThrow('Auswertung gescheitert');

    expect(sports()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(markers()).toEqual([]);
    expect(trackers.lastSport()).toBeNull();
  });
});

describe('zuletzt genutzte Art und Dauer', () => {
  it('fehlen vor der ersten Einheit und folgen danach der zuletzt eingetragenen Einheit', async () => {
    const { trackers } = await world();
    expect(trackers.lastSport()).toBeNull();

    trackers.recordSport(run);
    trackers.recordSport({ ...run, activityType: 'radfahren', durationMinutes: 45 });

    expect(trackers.lastSport()).toEqual({ activityType: 'radfahren', durationMinutes: 45 });
  });

  it('sind lokaler Gerätezustand: Sie erzeugen keine eigene Outbox-Operation', async () => {
    const { trackers, operations } = await world();

    trackers.recordSport(run);

    expect(operations()).toEqual([expect.objectContaining({ type: 'upsert_entity', entityType: 'sport_entry' })]);
  });
});

describe('Undo von recordSport', () => {
  it('löscht den Eintrag genau einmal als Tombstone und meldet seinen Tag erneut', async () => {
    const { clock, trackers, sports, operations, reports } = await world();
    const { undoToken } = trackers.recordSport({ ...run, startedAt: Instant.parse('2026-10-13T16:00:00.000Z') });
    const [created] = sports();
    clock.advanceBy(3_000);

    expect(trackers.undo(undoToken)).toEqual({ type: 'undone' });
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });

    expect(sports()).toEqual([expect.objectContaining({ id: created!.id, deletedAt: '2026-10-14T10:00:03.000Z' })]);
    expect(operations().filter((operation) => operation.type === 'delete_entity')).toEqual([
      expect.objectContaining({ entityType: 'sport_entry', entityId: created!.id }),
    ]);
    expect(reports).toEqual([
      { personId: philipp, localDates: ['2026-10-13'], cause: 'eingabe' },
      { personId: philipp, localDates: ['2026-10-13'], cause: 'rueckgaengig' },
    ]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleibt der Eintrag und der Token ist verbraucht', async () => {
    const { trackers, sports, operations, failReevaluation } = await world();
    const { undoToken } = trackers.recordSport(run);

    failReevaluation(true);
    expect(() => trackers.undo(undoToken)).toThrow('Auswertung gescheitert');

    expect(sports()[0]!.deletedAt).toBeNull();
    expect(operations().map((operation) => operation.type)).toEqual(['upsert_entity']);
    failReevaluation(false);
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });
  });

  it('bucht ohne Netz: Befehl und Undo schreiben nur lokal und rufen nie fetch auf', async () => {
    const { trackers, sports } = await world();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));

    const { undoToken } = trackers.recordSport(run);
    trackers.undo(undoToken);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sports()).toHaveLength(1);
    fetchSpy.mockRestore();
  });
});
