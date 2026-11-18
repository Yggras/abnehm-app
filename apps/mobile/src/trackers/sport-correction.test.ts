/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { SportDeletedOutcome, SportEntryUpsert, SportUpdatedOutcome } from '@abnehm/contracts/trackers';

import { InvalidTrackerInputError } from '.';
import type { SportInput } from './sport';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #174: `updateSport` und `deleteSport` für manuelle Sporteinträge samt Undo (Spezifikation 3,
// Abschnitt 4) gegen eine echte SQLite-Datei mit denselben Migrationen wie die App. Jeder Befehl ist genau
// eine lokale Transaktion aus Fachänderung, Outbox-Operation und `reevaluateDailyGoals` für den alten und
// den neuen Tag, wie das Eintragen in #173 und die Gewichtskorrektur in #176.

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

async function world() {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const created = await createTrackerWorld(clock);
  worlds.push(created);
  return { ...created, clock };
}

/** 07:00 in Berlin am Mittwoch, 14.10.2026; die Testuhr steht auf 12:00. */
const morning = Instant.parse('2026-10-14T05:00:00.000Z');
/** 18:30 in Berlin am Dienstag, 13.10.2026. */
const yesterdayEvening = Instant.parse('2026-10-13T16:30:00.000Z');

const run: SportInput = { activityType: 'laufen', durationMinutes: 30, startedAt: yesterdayEvening, activeMilliKcal: null };
const ride: SportInput = { activityType: 'radfahren', durationMinutes: 45, startedAt: morning, activeMilliKcal: 210_000 };

/** Legt eine manuelle Einheit an und liefert ihre ID; die Meldung des Eintragens verfällt. */
function recorded({ trackers, sports }: TrackerWorld, input: SportInput): EntityId {
  const { undoToken } = trackers.recordSport(input);
  trackers.expire(undoToken);
  return EntityId.parse(sports().find((row) => row.startedAt === input.startedAt && row.deletedAt === null)!.id);
}

/** Importiert ein Training aus Apple Health über den Importbefehl des Tracker-Moduls und liefert seine ID. */
function imported({ trackers, sports }: TrackerWorld, startedAt: Instant): EntityId {
  trackers.importHealth(
    {
      origin: 'apple_health',
      type: 'workout',
      upserts: [
        {
          type: 'workout',
          externalKey: `training-${startedAt}`,
          sourceApp: { id: 'com.fitbit.FitbitMobile', name: 'Fitbit' },
          utcOffsetMinutes: 120,
          startedAt,
          endedAt: Instant.parse(new Date(Date.parse(startedAt) + 1_800_000).toISOString()),
          durationSeconds: 1_800,
          platformActivityType: 37,
          activeMilliKcal: null,
        },
      ],
      deletedKeys: [],
      reconcileSince: null,
      notBefore: Instant.parse('2026-10-01T00:00:00.000Z'),
    },
    () => {},
  );
  return EntityId.parse(sports().find((row) => row.startedAt === startedAt && row.origin !== 'manuell')!.id);
}

const unknownId = EntityId.parse('7d1c2f8e-0b3a-4c5d-9e6f-1a2b3c4d5e6f');

describe('updateSport', () => {
  it('ändert Art, Dauer, Beginn und Kalorien samt Outbox-Operation und meldet den alten und den neuen Tag', async () => {
    const created = await world();
    const { trackers, sports, operations, reports } = created;
    const id = recorded(created, run);
    reports.length = 0;

    const outcome = trackers.updateSport(id, ride);

    expect(SportUpdatedOutcome.parse(outcome)).toEqual({
      messageKey: 'sport.geaendert', values: { activityType: 'radfahren', durationMinutes: 45 }, undoToken: expect.any(String),
    });
    expect(sports()).toEqual([
      expect.objectContaining({
        id, activityType: 'radfahren', durationMinutes: 45, startedAt: morning, activeMilliKcal: 210_000, localDate: '2026-10-14', origin: 'manuell', deletedAt: null,
      }),
    ]);
    expect(operations().at(-1)).toEqual(
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'sport_entry',
        entityId: id,
        payload: SportEntryUpsert.parse({
          activityType: 'radfahren',
          startedAt: morning,
          durationMinutes: 45,
          activeMilliKcal: 210_000,
          origin: 'manuell',
          replacedByEntryId: null,
          reactivatedAt: null,
          localDate: '2026-10-14',
          timeZone: 'Europe/Berlin',
          utcOffsetMinutes: 120,
        }),
      }),
    );
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-13', '2026-10-14'], cause: 'eingabe' }]);
  });

  it('meldet bei gleichem Tag genau diesen Tag', async () => {
    const created = await world();
    const id = recorded(created, ride);
    created.reports.length = 0;

    created.trackers.updateSport(id, { ...ride, durationMinutes: 60 });

    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it('behält Zone und Offset der Anlage nach einer Reise; der Tag folgt dem Beginn in dieser Zone', async () => {
    const created = await world();
    const id = recorded(created, ride);
    created.clock.setTimeZone(TimeZone.parse('America/New_York'));

    // 00:30 in Berlin am Dienstag, in New York noch Montagabend.
    created.trackers.updateSport(id, { ...ride, startedAt: Instant.parse('2026-10-12T22:30:00.000Z') });

    expect(created.sports()[0]).toMatchObject({ localDate: '2026-10-13', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 });
  });

  it('ändert die zuletzt genutzte Einheit des Geräts nicht', async () => {
    const created = await world();
    const id = recorded(created, run);

    created.trackers.updateSport(id, ride);

    expect(created.trackers.lastSport()).toEqual({ activityType: 'laufen', durationMinutes: 30 });
  });

  it.each([
    ['0 Minuten', { ...ride, durationMinutes: 0 }],
    ['601 Minuten', { ...ride, durationMinutes: 601 }],
    ['über 5000 kcal', { ...ride, activeMilliKcal: 5_000_001 }],
    ['eine unbekannte Art', { ...ride, activityType: 'tanzen' as SportInput['activityType'] }],
    ['einen Beginn in der Zukunft', { ...ride, startedAt: Instant.parse('2026-10-14T10:00:01.000Z') }],
  ])('lehnt %s ab, ohne etwas zu schreiben oder zu melden', async (_, input) => {
    const created = await world();
    const id = recorded(created, run);
    const before = { rows: created.sports(), operations: created.operations(), reports: created.reports.length };

    expect(() => created.trackers.updateSport(id, input)).toThrow(InvalidTrackerInputError);

    expect(created.sports()).toEqual(before.rows);
    expect(created.operations()).toEqual(before.operations);
    expect(created.reports).toHaveLength(before.reports);
  });

  it('lehnt importierte, gelöschte und unbekannte Einträge ab', async () => {
    const created = await world();
    const importedId = imported(created, morning);
    const deletedId = recorded(created, run);
    created.trackers.expire(created.trackers.deleteSport(deletedId).undoToken);
    const before = created.sports();

    for (const id of [importedId, deletedId, unknownId]) expect(() => created.trackers.updateSport(id, ride)).toThrow(InvalidTrackerInputError);
    expect(created.sports()).toEqual(before);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleiben die alten Werte', async () => {
    const created = await world();
    const id = recorded(created, run);
    const operations = created.operations();
    created.failReevaluation(true);

    expect(() => created.trackers.updateSport(id, ride)).toThrow('Auswertung gescheitert');

    expect(created.sports()[0]).toMatchObject({ activityType: 'laufen', durationMinutes: 30, startedAt: yesterdayEvening });
    expect(created.operations()).toEqual(operations);
  });
});

describe('Undo von updateSport', () => {
  it('schreibt die vorherigen Werte zurück und meldet beide Tage erneut', async () => {
    const created = await world();
    const id = recorded(created, run);
    const { undoToken } = created.trackers.updateSport(id, ride);
    created.reports.length = 0;

    expect(created.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    expect(created.trackers.undo(undoToken)).toEqual({ type: 'noop' });

    expect(created.sports()).toEqual([
      expect.objectContaining({ id, activityType: 'laufen', durationMinutes: 30, startedAt: yesterdayEvening, activeMilliKcal: null, localDate: '2026-10-13', deletedAt: null }),
    ]);
    expect(created.operations().at(-1)).toEqual(
      expect.objectContaining({ type: 'upsert_entity', entityId: id, payload: expect.objectContaining({ activityType: 'laufen', startedAt: yesterdayEvening }) }),
    );
    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-14', '2026-10-13'], cause: 'rueckgaengig' }]);
  });

  it('lässt einen inzwischen gelöschten Eintrag gelöscht', async () => {
    const created = await world();
    const id = recorded(created, run);
    const { undoToken } = created.trackers.updateSport(id, ride);
    created.trackers.expire(created.trackers.deleteSport(id).undoToken);

    created.trackers.undo(undoToken);

    expect(created.sports()).toEqual([expect.objectContaining({ id, activityType: 'radfahren', deletedAt: expect.any(String) })]);
  });
});

describe('deleteSport', () => {
  it('löscht den Eintrag als Tombstone samt Outbox-Operation und meldet seinen Tag', async () => {
    const created = await world();
    const id = recorded(created, run);
    created.reports.length = 0;
    created.clock.advanceBy(2_000);

    const outcome = created.trackers.deleteSport(id);

    expect(SportDeletedOutcome.parse(outcome)).toEqual({
      messageKey: 'sport.geloescht', values: { activityType: 'laufen', durationMinutes: 30 }, undoToken: expect.any(String),
    });
    expect(created.sports()).toEqual([expect.objectContaining({ id, deletedAt: '2026-10-14T10:00:02.000Z' })]);
    expect(created.operations().at(-1)).toEqual(expect.objectContaining({ type: 'delete_entity', entityType: 'sport_entry', entityId: id }));
    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-13'], cause: 'eingabe' }]);
  });

  it('lehnt importierte, schon gelöschte und unbekannte Einträge ab', async () => {
    const created = await world();
    const importedId = imported(created, morning);
    const deletedId = recorded(created, run);
    created.trackers.expire(created.trackers.deleteSport(deletedId).undoToken);
    const before = created.sports();

    for (const id of [importedId, deletedId, unknownId]) expect(() => created.trackers.deleteSport(id)).toThrow(InvalidTrackerInputError);
    expect(created.sports()).toEqual(before);
  });
});

describe('Undo von deleteSport', () => {
  it('legt einen neuen Eintrag mit neuer ID und denselben fachlichen Werten an', async () => {
    const created = await world();
    const id = recorded(created, { ...run, activeMilliKcal: 320_000 });
    const { undoToken } = created.trackers.deleteSport(id);
    // Nach einer Reise: Der neue Eintrag behält Tag, Zone und Offset des gelöschten.
    created.clock.setTimeZone(TimeZone.parse('America/New_York'));
    created.reports.length = 0;

    expect(created.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    expect(created.trackers.undo(undoToken)).toEqual({ type: 'noop' });

    const deleted = created.sports().find((row) => row.id === id);
    const restored = created.sports().find((row) => row.id !== id);
    expect(deleted).toMatchObject({ deletedAt: expect.any(String) });
    expect(restored).toMatchObject({
      activityType: 'laufen',
      durationMinutes: 30,
      startedAt: yesterdayEvening,
      activeMilliKcal: 320_000,
      origin: 'manuell',
      replacedByEntryId: null,
      reactivatedAt: null,
      localDate: '2026-10-13',
      timeZone: 'Europe/Berlin',
      utcOffsetMinutes: 120,
      deletedAt: null,
    });
    expect(created.operations().at(-1)).toEqual(
      expect.objectContaining({ type: 'upsert_entity', entityType: 'sport_entry', entityId: restored!.id, knownServerVersion: null }),
    );
    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-13'], cause: 'rueckgaengig' }]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, entsteht kein neuer Eintrag', async () => {
    const created = await world();
    const id = recorded(created, run);
    const { undoToken } = created.trackers.deleteSport(id);
    created.failReevaluation(true);

    expect(() => created.trackers.undo(undoToken)).toThrow('Auswertung gescheitert');

    expect(created.sports()).toHaveLength(1);
  });
});
