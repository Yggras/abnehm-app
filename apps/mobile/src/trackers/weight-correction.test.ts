/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { WeightDeletedOutcome, WeightEntryUpsert, WeightUpdatedOutcome } from '@abnehm/contracts/trackers';

import { InvalidTrackerInputError } from '.';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #176: `updateWeight` und `deleteWeight` für manuelle Gewichtseinträge samt Undo
// (Spezifikation 3, Abschnitt 4) gegen eine echte SQLite-Datei mit denselben Migrationen wie die App.
// Jeder Befehl ist genau eine lokale Transaktion aus Fachänderung, Outbox-Operation und
// `reevaluateDailyGoals` für den alten und den neuen Tag, wie das Eintragen in #171 und #175.

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

/** 07:30 und 08:00 in Berlin am Mittwoch, 14.10.2026; die Testuhr steht auf 12:00. */
const morning = Instant.parse('2026-10-14T05:30:00.000Z');
const later = Instant.parse('2026-10-14T06:00:00.000Z');
/** 07:30 in Berlin am Dienstag, 13.10.2026. */
const yesterday = Instant.parse('2026-10-13T05:30:00.000Z');

/** Legt einen manuellen Eintrag an und liefert seine ID; die Meldung des Eintragens verfällt. */
function recorded({ trackers, weights }: TrackerWorld, weightG: number, measuredAt: Instant): EntityId {
  const { undoToken } = trackers.recordWeight({ weightG, measuredAt });
  trackers.expire(undoToken);
  return EntityId.parse(weights().find((row) => row.measuredAt === measuredAt)!.id);
}

/** Importiert ein Gewicht aus Apple Health über den Importbefehl des Tracker-Moduls und liefert seine ID. */
function imported({ trackers, weights }: TrackerWorld, weightG: number, measuredAt: Instant): EntityId {
  trackers.importHealth(
    {
      origin: 'apple_health',
      type: 'weight',
      upserts: [{ type: 'weight', externalKey: `waage-${measuredAt}`, sourceApp: { id: 'com.withings.wiScaleNG', name: 'Withings' }, utcOffsetMinutes: 120, measuredAt, weightG }],
      deletedKeys: [],
      reconcileSince: null,
      notBefore: Instant.parse('2026-09-14T00:00:00.000Z'),
    },
    () => {},
  );
  return EntityId.parse(weights().find((row) => row.measuredAt === measuredAt)!.id);
}

describe('updateWeight', () => {
  it('ändert Wert und Messzeitpunkt samt Outbox-Operation und meldet den alten und den neuen Tag', async () => {
    const created = await world();
    const { trackers, weights, operations, reports } = created;
    const id = recorded(created, 82_400, yesterday);
    reports.length = 0;

    const outcome = trackers.updateWeight(id, { weightG: 82_100, measuredAt: morning });

    expect(WeightUpdatedOutcome.parse(outcome)).toEqual({ messageKey: 'gewicht.geaendert', values: { weightG: 82_100 }, undoToken: expect.any(String) });
    expect(weights()).toEqual([expect.objectContaining({ id, weightG: 82_100, measuredAt: morning, localDate: '2026-10-14', origin: 'manuell', deletedAt: null })]);
    expect(operations().at(-1)).toEqual(
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'weight_entry',
        entityId: id,
        payload: WeightEntryUpsert.parse({
          weightG: 82_100, origin: 'manuell', measuredAt: morning, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
        }),
      }),
    );
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-13', '2026-10-14'], cause: 'eingabe' }]);
  });

  it('meldet bei gleichem Tag genau diesen Tag', async () => {
    const created = await world();
    const id = recorded(created, 82_400, morning);
    created.reports.length = 0;

    created.trackers.updateWeight(id, { weightG: 82_500, measuredAt: later });

    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it('behält Zone und Offset der Anlage, auch nach einer Reise', async () => {
    const created = await world();
    const id = recorded(created, 82_400, morning);
    created.clock.setTimeZone(TimeZone.parse('America/New_York'));

    created.trackers.updateWeight(id, { weightG: 82_400, measuredAt: yesterday });

    expect(created.weights()[0]).toMatchObject({ localDate: '2026-10-13', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 });
  });

  it.each([
    ['19,9 kg', 19_900, morning],
    ['zwei Nachkommastellen', 82_450, morning],
    ['einen Zeitpunkt in der Zukunft', 82_400, Instant.parse('2026-10-14T10:00:01.000Z')],
  ])('lehnt %s ab, ohne etwas zu schreiben oder zu melden', async (_, weightG, measuredAt) => {
    const created = await world();
    const id = recorded(created, 82_400, morning);
    const before = { rows: created.weights(), operations: created.operations(), reports: created.reports.length };

    expect(() => created.trackers.updateWeight(id, { weightG, measuredAt })).toThrow(InvalidTrackerInputError);

    expect(created.weights()).toEqual(before.rows);
    expect(created.operations()).toEqual(before.operations);
    expect(created.reports).toHaveLength(before.reports);
  });

  it('lehnt importierte, gelöschte und unbekannte Einträge ab', async () => {
    const created = await world();
    const importedId = imported(created, 82_137, yesterday);
    const deletedId = recorded(created, 82_400, morning);
    created.trackers.expire(created.trackers.deleteWeight(deletedId).undoToken);
    const before = created.weights();

    for (const id of [importedId, deletedId, EntityId.parse('7d1c2f8e-0b3a-4c5d-9e6f-1a2b3c4d5e6f')]) {
      expect(() => created.trackers.updateWeight(id, { weightG: 82_000, measuredAt: morning })).toThrow(InvalidTrackerInputError);
    }
    expect(created.weights()).toEqual(before);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleibt der alte Wert', async () => {
    const created = await world();
    const id = recorded(created, 82_400, morning);
    const operations = created.operations();
    created.failReevaluation(true);

    expect(() => created.trackers.updateWeight(id, { weightG: 82_100, measuredAt: morning })).toThrow('Auswertung gescheitert');

    expect(created.weights()[0]).toMatchObject({ weightG: 82_400 });
    expect(created.operations()).toEqual(operations);
  });
});

describe('Undo von updateWeight', () => {
  it('schreibt die vorherigen Werte zurück und meldet beide Tage erneut', async () => {
    const created = await world();
    const id = recorded(created, 82_400, yesterday);
    const { undoToken } = created.trackers.updateWeight(id, { weightG: 82_100, measuredAt: morning });
    created.reports.length = 0;

    expect(created.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    expect(created.trackers.undo(undoToken)).toEqual({ type: 'noop' });

    expect(created.weights()).toEqual([expect.objectContaining({ id, weightG: 82_400, measuredAt: yesterday, localDate: '2026-10-13', deletedAt: null })]);
    expect(created.operations().at(-1)).toEqual(
      expect.objectContaining({ type: 'upsert_entity', entityId: id, payload: expect.objectContaining({ weightG: 82_400, measuredAt: yesterday }) }),
    );
    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-14', '2026-10-13'], cause: 'rueckgaengig' }]);
  });

  it('lässt einen inzwischen gelöschten Eintrag gelöscht', async () => {
    const created = await world();
    const id = recorded(created, 82_400, morning);
    const { undoToken } = created.trackers.updateWeight(id, { weightG: 82_100, measuredAt: morning });
    created.trackers.expire(created.trackers.deleteWeight(id).undoToken);

    created.trackers.undo(undoToken);

    expect(created.weights()).toEqual([expect.objectContaining({ id, weightG: 82_100, deletedAt: expect.any(String) })]);
  });
});

describe('deleteWeight', () => {
  it('löscht den Eintrag als Tombstone samt Outbox-Operation und meldet seinen Tag', async () => {
    const created = await world();
    const id = recorded(created, 82_400, yesterday);
    created.reports.length = 0;
    created.clock.advanceBy(2_000);

    const outcome = created.trackers.deleteWeight(id);

    expect(WeightDeletedOutcome.parse(outcome)).toEqual({ messageKey: 'gewicht.geloescht', values: { weightG: 82_400 }, undoToken: expect.any(String) });
    expect(created.weights()).toEqual([expect.objectContaining({ id, deletedAt: '2026-10-14T10:00:02.000Z' })]);
    expect(created.operations().at(-1)).toEqual(expect.objectContaining({ type: 'delete_entity', entityType: 'weight_entry', entityId: id }));
    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-13'], cause: 'eingabe' }]);
  });

  it('lehnt importierte und schon gelöschte Einträge ab', async () => {
    const created = await world();
    const importedId = imported(created, 82_137, yesterday);
    const deletedId = recorded(created, 82_400, morning);
    created.trackers.expire(created.trackers.deleteWeight(deletedId).undoToken);
    const before = created.weights();

    expect(() => created.trackers.deleteWeight(importedId)).toThrow(InvalidTrackerInputError);
    expect(() => created.trackers.deleteWeight(deletedId)).toThrow(InvalidTrackerInputError);
    expect(created.weights()).toEqual(before);
  });

  it('macht die nächste Messung des Tags zum Tagesgewicht, wenn die früheste gelöscht wird', async () => {
    const created = await world();
    const earliest = recorded(created, 82_400, morning);
    recorded(created, 82_900, later);
    expect(created.trackers.lastWeights()?.dayWeight).toEqual({ localDate: '2026-10-14', weightG: 82_400 });

    created.trackers.expire(created.trackers.deleteWeight(earliest).undoToken);

    expect(created.trackers.lastWeights()?.dayWeight).toEqual({ localDate: '2026-10-14', weightG: 82_900 });
    await expect(created.trackers.weightTrendReader.latest(philipp)).resolves.toEqual({
      lastDayWeight: { localDate: '2026-10-14', dayWeightG: 82_900 },
      dayWeightCount: 1,
      trend: { type: 'noch_nicht_verfuegbar' },
    });
  });
});

describe('Undo von deleteWeight', () => {
  it('legt einen neuen Eintrag mit neuer ID und denselben fachlichen Werten an', async () => {
    const created = await world();
    const id = recorded(created, 82_400, yesterday);
    const { undoToken } = created.trackers.deleteWeight(id);
    // Nach einer Reise: Der neue Eintrag behält Zone und Offset des gelöschten.
    created.clock.setTimeZone(TimeZone.parse('America/New_York'));
    created.reports.length = 0;

    expect(created.trackers.undo(undoToken)).toEqual({ type: 'undone' });

    const [deleted, restored] = [created.weights().find((row) => row.id === id), created.weights().find((row) => row.id !== id)];
    expect(deleted).toMatchObject({ deletedAt: expect.any(String) });
    expect(restored).toMatchObject({
      weightG: 82_400, measuredAt: yesterday, origin: 'manuell', localDate: '2026-10-13', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, deletedAt: null,
    });
    expect(created.operations().at(-1)).toEqual(
      expect.objectContaining({ type: 'upsert_entity', entityType: 'weight_entry', entityId: restored!.id, knownServerVersion: null }),
    );
    expect(created.reports).toEqual([{ personId: philipp, localDates: ['2026-10-13'], cause: 'rueckgaengig' }]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, entsteht kein neuer Eintrag', async () => {
    const created = await world();
    const id = recorded(created, 82_400, morning);
    const { undoToken } = created.trackers.deleteWeight(id);
    created.failReevaluation(true);

    expect(() => created.trackers.undo(undoToken)).toThrow('Auswertung gescheitert');

    expect(created.weights()).toHaveLength(1);
  });
});
