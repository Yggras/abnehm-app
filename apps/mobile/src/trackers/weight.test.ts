/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { WeightEntryUpsert, WeightRecordedOutcome } from '@abnehm/contracts/trackers';

import { InvalidTrackerInputError } from '.';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #175: `recordWeight` und sein Undo im Tracker-Modul (Spezifikation 3, Abschnitte 3 und 4)
// gegen eine echte SQLite-Datei mit denselben Migrationen wie die App, gesteuert über die Testuhr.
// Jeder Befehl ist genau eine lokale Transaktion aus Gewichtseintrag, Outbox-Operation und
// `reevaluateDailyGoals`, wie das Wasser in #171.

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

/** 07:30 in Berlin am Mittwoch, 14.10.2026; die Testuhr steht auf 12:00. */
const morning = Instant.parse('2026-10-14T05:30:00.000Z');

describe('recordWeight', () => {
  it('legt den Eintrag samt Outbox-Operation an und meldet den Tag an reevaluateDailyGoals', async () => {
    const { trackers, weights, operations, reports } = await world();

    const outcome = trackers.recordWeight({ weightG: 82_400, measuredAt: morning });

    expect(WeightRecordedOutcome.parse(outcome)).toEqual({ messageKey: 'gewicht.eingetragen', values: { weightG: 82_400 }, undoToken: expect.any(String) });
    const [row] = weights();
    expect(weights()).toHaveLength(1);
    expect(row).toMatchObject({
      personId: philipp,
      weightG: 82_400,
      measuredAt: morning,
      origin: 'manuell',
      externalKey: null,
      hiddenAt: null,
      localDate: '2026-10-14',
      timeZone: 'Europe/Berlin',
      utcOffsetMinutes: 120,
      deletedAt: null,
      serverVersion: null,
    });
    expect(operations()).toEqual([
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'weight_entry',
        entityId: row!.id,
        knownServerVersion: null,
        payload: WeightEntryUpsert.parse({
          weightG: 82_400, origin: 'manuell', measuredAt: morning, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
        }),
      }),
    ]);
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it('bestimmt lokalen Tag und Offset aus dem Messzeitpunkt, auch nachgetragen über die Zeitumstellung', async () => {
    // Die Uhr steht am 26.10. (Winterzeit, UTC+1); gemessen wurde am 24.10. um 23:30 Berlin (Sommerzeit, UTC+2).
    const { trackers, weights, reports } = await world({ at: Instant.parse('2026-10-26T08:00:00.000Z') });

    trackers.recordWeight({ weightG: 82_400, measuredAt: Instant.parse('2026-10-24T21:30:00.000Z') });

    expect(weights()[0]).toMatchObject({ localDate: '2026-10-24', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 });
    expect(reports[0]!.localDates).toEqual(['2026-10-24']);
  });

  it('nimmt Zone und Tag der Uhr: nach einer Reise zählt derselbe Zeitpunkt in der neuen Zone', async () => {
    const { clock, trackers, weights } = await world({ at: Instant.parse('2026-10-14T22:30:00.000Z') });
    trackers.recordWeight({ weightG: 82_400, measuredAt: Instant.parse('2026-10-14T22:30:00.000Z') });

    clock.setTimeZone(TimeZone.parse('America/New_York'));
    trackers.recordWeight({ weightG: 82_400, measuredAt: Instant.parse('2026-10-14T22:30:00.000Z') });

    expect(weights().map(({ localDate, timeZone, utcOffsetMinutes }) => ({ localDate, timeZone, utcOffsetMinutes }))).toEqual([
      { localDate: '2026-10-15', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 },
      { localDate: '2026-10-14', timeZone: 'America/New_York', utcOffsetMinutes: -240 },
    ]);
  });

  it('speichert mehrere Messungen eines Tags jeweils als eigenen Eintrag', async () => {
    const { clock, trackers, weights, reports } = await world();

    trackers.recordWeight({ weightG: 82_400, measuredAt: morning });
    trackers.recordWeight({ weightG: 82_900, measuredAt: clock.read().instant });
    trackers.recordWeight({ weightG: 82_200, measuredAt: Instant.parse('2026-10-14T04:45:00.000Z') });

    expect(weights().map((row) => [row.weightG, row.localDate])).toEqual([
      [82_400, '2026-10-14'],
      [82_900, '2026-10-14'],
      [82_200, '2026-10-14'],
    ]);
    expect(reports.map((report) => report.localDates)).toEqual([['2026-10-14'], ['2026-10-14'], ['2026-10-14']]);
  });

  it.each([20_000, 350_000])('nimmt die Grenze %s g an', async (weightG) => {
    const { trackers, weights } = await world();

    trackers.recordWeight({ weightG, measuredAt: morning });

    expect(weights().map((row) => row.weightG)).toEqual([weightG]);
  });

  it('nimmt „jetzt“ als Messzeitpunkt an', async () => {
    const { clock, trackers, weights } = await world();

    trackers.recordWeight({ weightG: 82_400, measuredAt: clock.read().instant });

    expect(weights()).toHaveLength(1);
  });

  it.each([
    ['19,9 kg', 19_900, morning],
    ['350,1 kg', 350_100, morning],
    ['zwei Nachkommastellen', 82_450, morning],
    ['einen Zeitpunkt in der Zukunft', 82_400, Instant.parse('2026-10-14T10:00:01.000Z')],
  ])('lehnt %s ab, ohne etwas zu schreiben oder zu melden', async (_, weightG, measuredAt) => {
    const { trackers, weights, operations, reports, markers } = await world();

    expect(() => trackers.recordWeight({ weightG, measuredAt })).toThrow(InvalidTrackerInputError);

    expect(weights()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(reports).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleiben weder Eintrag noch Operation noch Dirty-Day-Marker', async () => {
    const { trackers, weights, operations, markers, failReevaluation } = await world();
    failReevaluation(true);

    expect(() => trackers.recordWeight({ weightG: 82_400, measuredAt: morning })).toThrow('Auswertung gescheitert');

    expect(weights()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it('trägt ohne Netz ein: Der Befehl schreibt nur lokal und ruft nie fetch auf', async () => {
    const { trackers, weights } = await world();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));

    const { undoToken } = trackers.recordWeight({ weightG: 82_400, measuredAt: morning });
    trackers.undo(undoToken);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(weights()).toHaveLength(1);
    fetchSpy.mockRestore();
  });
});

describe('Undo von recordWeight', () => {
  it('löscht den Eintrag genau einmal als Tombstone und meldet seinen Tag erneut', async () => {
    const { clock, trackers, weights, operations, reports } = await world();
    const { undoToken } = trackers.recordWeight({ weightG: 82_400, measuredAt: Instant.parse('2026-10-13T05:30:00.000Z') });
    const [created] = weights();
    clock.advanceBy(3_000);

    expect(trackers.undo(undoToken)).toEqual({ type: 'undone' });
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });

    expect(weights()).toEqual([expect.objectContaining({ id: created!.id, deletedAt: '2026-10-14T10:00:03.000Z' })]);
    expect(operations().filter((operation) => operation.type === 'delete_entity')).toEqual([
      expect.objectContaining({ entityType: 'weight_entry', entityId: created!.id }),
    ]);
    expect(reports).toEqual([
      { personId: philipp, localDates: ['2026-10-13'], cause: 'eingabe' },
      { personId: philipp, localDates: ['2026-10-13'], cause: 'rueckgaengig' },
    ]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleibt der Eintrag und der Token ist verbraucht', async () => {
    const { trackers, weights, operations, failReevaluation } = await world();
    const { undoToken } = trackers.recordWeight({ weightG: 82_400, measuredAt: morning });

    failReevaluation(true);
    expect(() => trackers.undo(undoToken)).toThrow('Auswertung gescheitert');

    expect(weights()[0]!.deletedAt).toBeNull();
    expect(operations().map((operation) => operation.type)).toEqual(['upsert_entity']);
    failReevaluation(false);
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });
  });
});
