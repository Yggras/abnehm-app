/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { WaterAddedOutcome, WaterEntryUpsert } from '@abnehm/contracts/trackers';

import { createQuickCommandRegistry } from '../shell/quick-commands';
import { InvalidTrackerInputError } from '.';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #171: das Tracker-Modul (Spezifikation 3, Abschnitte 2 und 4) mit `addWater`, `undo`
// und dem Quick-Command `water.quick_add` gegen eine echte SQLite-Datei mit denselben Migrationen
// wie die App, gesteuert über die Testuhr. Jeder Befehl ist genau eine lokale Transaktion aus
// Fachänderung, Outbox-Operation und `reevaluateDailyGoals`.

const worlds: TrackerWorld[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const world of worlds.splice(0)) world.close();
});

async function setup({ failReevaluation = false, at = noon }: { failReevaluation?: boolean; at?: Instant } = {}) {
  const clock = createTestClock({ instant: at, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  world.failReevaluation(failReevaluation);
  return { ...world, clock, rows: world.waters };
}

describe('addWater', () => {
  it('legt den Eintrag samt Outbox-Operation an und meldet den Tag an reevaluateDailyGoals', async () => {
    const { trackers, rows, operations, reports } = await setup();

    const outcome = trackers.addWater({ ml: 250 });

    expect(WaterAddedOutcome.parse(outcome)).toEqual({ messageKey: 'wasser.hinzugefuegt', values: { ml: 250 }, undoToken: expect.any(String) });
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row).toMatchObject({
      personId: philipp,
      amountMl: 250,
      origin: 'manuell',
      loggedAt: noon,
      localDate: '2026-10-14',
      timeZone: 'Europe/Berlin',
      utcOffsetMinutes: 120,
      deletedAt: null,
      serverVersion: null,
    });
    expect(operations()).toEqual([
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'water_entry',
        entityId: row!.id,
        knownServerVersion: null,
        payload: WaterEntryUpsert.parse({
          amountMl: 250, origin: 'manuell', loggedAt: noon, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
        }),
      }),
    ]);
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it.each([1, 3000])('nimmt die Grenze %s ml an', async (ml) => {
    const { trackers, rows } = await setup();

    trackers.addWater({ ml });

    expect(rows().map((row) => row.amountMl)).toEqual([ml]);
  });

  it.each([0, 3001, 250.5, -250])('lehnt %s ml ab, ohne etwas zu schreiben oder zu melden', async (ml) => {
    const { trackers, rows, operations, reports, markers } = await setup();

    expect(() => trackers.addWater({ ml })).toThrow(InvalidTrackerInputError);

    expect(rows()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(reports).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleiben weder Eintrag noch Operation noch Dirty-Day-Marker', async () => {
    const { trackers, rows, operations, markers } = await setup({ failReevaluation: true });

    expect(() => trackers.addWater({ ml: 250 })).toThrow('Auswertung gescheitert');

    expect(rows()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it('bucht ohne Netz: Der Befehl schreibt nur lokal und ruft nie fetch auf', async () => {
    const { trackers, rows, operations } = await setup();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    cleanups.push(() => fetchSpy.mockRestore());

    const { undoToken } = trackers.addWater({ ml: 250 });
    expect(trackers.undo(undoToken)).toEqual({ type: 'undone' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(operations().map((operation) => operation.type)).toEqual(['upsert_entity', 'delete_entity']);
  });
});

describe('lokaler Tag, Zeitzone und Offset', () => {
  it('speichert sie bei der Anlage aus der Uhr; nach einer Reise bleiben Zone und Tag des Eintrags', async () => {
    // 23:30 in Berlin am 14.10., in New York erst 17:30 desselben Tags.
    const { clock, trackers, rows } = await setup({ at: Instant.parse('2026-10-14T21:30:00.000Z') });
    trackers.addWater({ ml: 250 });

    clock.setTimeZone(TimeZone.parse('America/New_York'));
    clock.advanceBy(60 * 60 * 1000);
    trackers.addWater({ ml: 500 });

    expect(rows().map(({ amountMl, localDate, timeZone, utcOffsetMinutes }) => ({ amountMl, localDate, timeZone, utcOffsetMinutes }))).toEqual([
      { amountMl: 250, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 },
      { amountMl: 500, localDate: '2026-10-14', timeZone: 'America/New_York', utcOffsetMinutes: -240 },
    ]);
  });

  it('nach Mitternacht in Berlin bucht derselbe Zeitpunkt in New York noch auf den Vortag', async () => {
    const { clock, trackers, rows } = await setup({ at: Instant.parse('2026-10-14T22:30:00.000Z') });
    trackers.addWater({ ml: 250 });
    clock.setTimeZone(TimeZone.parse('America/New_York'));
    trackers.addWater({ ml: 250 });

    expect(rows().map((row) => row.localDate)).toEqual(['2026-10-15', '2026-10-14']);
  });
});

describe('undo', () => {
  it('löscht den Eintrag genau einmal als Tombstone und meldet seinen Tag erneut', async () => {
    const { clock, trackers, rows, operations, reports } = await setup();
    const { undoToken } = trackers.addWater({ ml: 250 });
    const [created] = rows();
    clock.advanceBy(3_000);

    expect(trackers.undo(undoToken)).toEqual({ type: 'undone' });
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });

    expect(rows()).toEqual([expect.objectContaining({ id: created!.id, deletedAt: '2026-10-14T10:00:03.000Z' })]);
    expect(operations().filter((operation) => operation.type === 'delete_entity')).toEqual([
      expect.objectContaining({ entityType: 'water_entry', entityId: created!.id }),
    ]);
    expect(reports.map((report) => report.cause)).toEqual(['eingabe', 'rueckgaengig']);
    expect(reports[1]!.localDates).toEqual(['2026-10-14']);
  });

  it('meldet nach einer Reise den gespeicherten Tag des Eintrags, nicht den heutigen', async () => {
    const { clock, trackers, reports } = await setup({ at: Instant.parse('2026-10-14T22:30:00.000Z') });
    const { undoToken } = trackers.addWater({ ml: 250 });

    clock.setTimeZone(TimeZone.parse('America/New_York'));
    trackers.undo(undoToken);

    expect(reports).toEqual([
      { personId: philipp, localDates: ['2026-10-15'], cause: 'eingabe' },
      { personId: philipp, localDates: ['2026-10-15'], cause: 'rueckgaengig' },
    ]);
  });

  it('ein abgelaufener Token macht nichts rückgängig', async () => {
    const { trackers, rows, reports } = await setup();
    const { undoToken } = trackers.addWater({ ml: 250 });

    trackers.expire(undoToken);

    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });
    expect(rows()[0]!.deletedAt).toBeNull();
    expect(reports).toHaveLength(1);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleibt der Eintrag unverändert und der Token ist verbraucht', async () => {
    const { trackers, rows, operations, failReevaluation } = await setup();
    const { undoToken } = trackers.addWater({ ml: 250 });

    failReevaluation(true);
    expect(() => trackers.undo(undoToken)).toThrow('Auswertung gescheitert');

    expect(rows()[0]!.deletedAt).toBeNull();
    expect(operations().map((operation) => operation.type)).toEqual(['upsert_entity']);
    failReevaluation(false);
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });
  });
});

describe('Quick-Command water.quick_add', () => {
  it('bucht über die Registry der Shell ohne Navigation, und „Rückgängig“ löscht den Eintrag genau einmal', async () => {
    const { database, trackers, rows, operations, reports } = await setup();
    const registry = createQuickCommandRegistry();
    registry.opened(database, trackers.quickCommands);

    const outcome = registry.execute({ type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } });

    expect(WaterAddedOutcome.parse(outcome).values).toEqual({ ml: 250 });
    expect(rows()).toEqual([expect.objectContaining({ amountMl: 250, deletedAt: null })]);

    expect(registry.undo(outcome.undoToken)).toEqual({ type: 'undone' });
    expect(registry.undo(outcome.undoToken)).toEqual({ type: 'noop' });

    expect(rows()[0]!.deletedAt).not.toBeNull();
    expect(operations().map((operation) => operation.type)).toEqual(['upsert_entity', 'delete_entity']);
    expect(reports.map((report) => report.cause)).toEqual(['eingabe', 'rueckgaengig']);
  });
});

describe('Interface', () => {
  it('exportiert keine Drizzle- oder expo-sqlite-Typen', () => {
    for (const file of ['index.ts', 'trackers.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/from 'drizzle-orm|from 'expo-sqlite|from 'better-sqlite3|local-db\/schema|local-db\/sqlite/);
    }
  });
});
