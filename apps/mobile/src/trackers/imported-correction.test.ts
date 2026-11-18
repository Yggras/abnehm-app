/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';
import { ActivityTypeOverriddenOutcome, ImportHiddenOutcome, type SportEntryRecord } from '@abnehm/contracts/trackers';

import { fakeAreaPorts, fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import type { HealthWeightRecord, HealthWorkoutRecord } from '../health/platform';
import type { Source } from '../shell/followed-source';
import { InvalidTrackerInputError, sportEntryEntity } from '.';
import type { SportWeekState } from './sport-week';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';
import type { WeightDetailState } from './weight-detail';

// Nachweis für #186: `hideImported` und `overrideActivityType` für importierte Einträge samt Undo
// (Spezifikation 3, Abschnitte 3, 4 und 6) gegen eine echte SQLite-Datei mit denselben Migrationen wie die
// App. Jeder Befehl ist genau eine lokale Transaktion aus Fachänderung, Outbox-Operation und
// `reevaluateDailyGoals` für den Tag des Eintrags, wie die Befehle aus #171. Ausblendung und überschriebene
// Art überdauern einen späteren Upsert aus der Quelle. Heute ist Mittwoch, der 14.10.2026, 12:00 in Berlin.

const worlds: TrackerWorld[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const world of worlds.splice(0)) world.close();
});

async function world() {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const created = await createTrackerWorld(clock);
  worlds.push(created);
  return { ...created, clock };
}

/** Wartet, bis die asynchronen Plan-Abfragen ihren Zustand gemeldet haben. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

const goal: FakeGoalVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 1_800_000,
  lowerBoundMilliKcal: 1_500_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 80_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
};
const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
/** Wochenplan mit dem Mittwoch als einzigem Wiegetag. */
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  days: Object.fromEntries(
    weekdays.map((weekday): [Weekday, [BausteinKey, BausteinKey, BausteinKey]] => [
      weekday,
      weekday === 'mittwoch' ? ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] : ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    ]),
  ) as FakeWeeklyPlanVersion['days'],
};
const planReader: PlanReader = fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) }).planReader;
const noRefresh = () => () => {};

/** Folgt einer Quelle und liefert jeweils ihren jüngsten Zustand. */
function follow<S>(source: Source<S>): () => S | undefined {
  let latest: S | undefined;
  stops.push(source.subscribe((state) => (latest = state)));
  return () => latest;
}

/** 07:00 in Berlin am Mittwoch, 14.10.2026. */
const morning = Instant.parse('2026-10-14T05:00:00.000Z');
/** 06:30 und 08:00 in Berlin am Mittwoch, 14.10.2026. */
const early = Instant.parse('2026-10-14T04:30:00.000Z');
const later = Instant.parse('2026-10-14T06:00:00.000Z');
const fitbit = { id: 'com.fitbit.FitbitMobile', name: null } as const;

/** Ein Training aus Apple Health; HKWorkoutActivityType 13 ist Radfahren. */
function workout(externalKey: string, startedAt: Instant, durationSeconds: number): HealthWorkoutRecord {
  return {
    type: 'workout',
    externalKey,
    sourceApp: fitbit,
    utcOffsetMinutes: 120,
    startedAt,
    endedAt: Instant.parse(new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString()),
    durationSeconds,
    platformActivityType: 13,
    activeMilliKcal: 412_000,
  };
}

function weight(externalKey: string, measuredAt: Instant, weightG: number): HealthWeightRecord {
  return { type: 'weight', externalKey, sourceApp: fitbit, utcOffsetMinutes: 120, measuredAt, weightG };
}

const notBefore = Instant.parse('2026-10-01T00:00:00.000Z');

/** Importiert Datensätze über den Importbefehl des Tracker-Moduls, wie der Health-Import-Dienst. */
function importWorkouts({ trackers }: TrackerWorld, ...upserts: HealthWorkoutRecord[]) {
  trackers.importHealth({ origin: 'apple_health', type: 'workout', upserts, deletedKeys: [], reconcileSince: null, notBefore }, () => {});
}
function importWeights({ trackers }: TrackerWorld, ...upserts: HealthWeightRecord[]) {
  trackers.importHealth({ origin: 'apple_health', type: 'weight', upserts, deletedKeys: [], reconcileSince: null, notBefore }, () => {});
}

const importedSportId = (world: TrackerWorld, externalKey: string) => EntityId.parse(world.sports().find((row) => row.externalKey === externalKey)!.id);
const importedWeightId = (world: TrackerWorld, externalKey: string) => EntityId.parse(world.weights().find((row) => row.externalKey === externalKey)!.id);

/** Ein manueller Sporteintrag, wie ihn ein Pull vom Server übernimmt, etwa einer, den #185 ersetzt hat. */
function pulledManual(world: TrackerWorld, data: Partial<SportEntryRecord>) {
  const id = EntityId.parse(randomUUID());
  const record = {
    activityType: 'laufen', startedAt: morning, durationMinutes: 40, activeMilliKcal: null, origin: 'manuell', replacedByEntryId: null, reactivatedAt: null,
    localDate: LocalDate.parse('2026-10-14'), timeZone: TimeZone.parse('Europe/Berlin'), utcOffsetMinutes: 120, personId: philipp, createdAt: noon, updatedAt: noon,
    ...data,
  } as SportEntryRecord;
  world.database.transaction((tx) => sportEntryEntity.applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse('1'), data: record }));
  return id;
}

const unknownId = EntityId.parse('7d1c2f8e-0b3a-4c5d-9e6f-1a2b3c4d5e6f');

describe('hideImported', () => {
  it('blendet ein Training aus, samt Outbox-Operation, gemeldetem Tag und Meldung mit „Rückgängig“; es verschwindet aus Liste und Wochensumme', async () => {
    const created = await world();
    const { trackers, sports, operations, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    const week = follow(trackers.sportWeek(planReader, noRefresh, null));
    await settled();
    expect(week()).toMatchObject({ type: 'ready', week: { weekMinutes: 52 } });
    reports.length = 0;

    const outcome = trackers.hideImported(id);

    expect(ImportHiddenOutcome.parse(outcome)).toEqual({
      messageKey: 'sport.ausgeblendet',
      values: { activityType: 'radfahren', durationMinutes: 52 },
      undoToken: expect.any(String),
    });
    expect(sports().find((row) => row.id === id)).toMatchObject({ hiddenAt: noon, deletedAt: null, durationMinutes: 52 });
    expect(operations().at(-1)).toMatchObject({ type: 'upsert_entity', entityType: 'sport_entry', entityId: id, payload: { hiddenAt: noon, origin: 'apple_health' } });
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
    await settled();
    expect(week()).toEqual({ type: 'ready', week: expect.objectContaining({ weekMinutes: 0, days: [] }) });
  });

  it('„Rückgängig“ entfernt die Ausblendung wieder, mit eigener Outbox-Operation und `rueckgaengig`', async () => {
    const created = await world();
    const { trackers, sports, operations, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    const { undoToken } = trackers.hideImported(id);
    reports.length = 0;

    expect(trackers.undo(undoToken)).toEqual({ type: 'undone' });

    expect(sports().find((row) => row.id === id)).toMatchObject({ hiddenAt: null, deletedAt: null });
    expect(operations().at(-1)).toMatchObject({ type: 'upsert_entity', entityId: id, payload: { hiddenAt: null } });
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'rueckgaengig' }]);
    expect(trackers.undo(undoToken)).toEqual({ type: 'noop' });
  });

  it('ein späterer Upsert aus der Quelle aktualisiert die Werte und blendet den Eintrag nicht wieder ein', async () => {
    const created = await world();
    const { trackers, sports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    trackers.expire(trackers.hideImported(id).undoToken);

    created.clock.advanceBy(3_600_000);
    importWorkouts(created, workout('training', morning, 61 * 60));

    expect(sports().find((row) => row.id === id)).toMatchObject({ durationMinutes: 61, hiddenAt: noon, deletedAt: null });
  });

  it('Rückgängig nach einer Löschung in der Quelle ändert nichts mehr', async () => {
    const created = await world();
    const { trackers, sports, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    const { undoToken } = trackers.hideImported(id);
    trackers.importHealth({ origin: 'apple_health', type: 'workout', upserts: [], deletedKeys: ['training'], reconcileSince: null, notBefore }, () => {});
    reports.length = 0;

    trackers.undo(undoToken);

    expect(sports().find((row) => row.id === id)).toMatchObject({ hiddenAt: noon, deletedAt: expect.any(String) });
    expect(reports).toEqual([]);
  });

  it('blendet ein ersetzendes Training aus; der ersetzte manuelle Eintrag zählt danach wieder, Rückgängig ersetzt ihn erneut', async () => {
    const created = await world();
    const { trackers } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const importId = importedSportId(created, 'training');
    pulledManual(created, { durationMinutes: 40, replacedByEntryId: importId });
    const week = follow(trackers.sportWeek(planReader, noRefresh, null));
    const today = follow(trackers.sportToday(planReader, noRefresh));
    await settled();
    expect(week()).toMatchObject({ week: { weekMinutes: 52 } });

    const { undoToken } = trackers.hideImported(importId);
    await settled();

    expect(week()).toMatchObject({ week: { weekMinutes: 40 } });
    expect(today()).toMatchObject({ type: 'ready', data: { weekMinutes: 40 } });

    trackers.undo(undoToken);
    await settled();
    expect(week()).toMatchObject({ week: { weekMinutes: 52 } });
    expect(today()).toMatchObject({ type: 'ready', data: { weekMinutes: 52 } });
  });

  it('blendet ein importiertes Gewicht aus, das Tagesgewicht war: Tagesgewicht, Trend, Verlauf und „Gewogen“ folgen sofort', async () => {
    const created = await world();
    const { trackers, weights, operations, reports } = created;
    importWeights(created, weight('waage', early, 82_437));
    const scale = importedWeightId(created, 'waage');
    const detail = follow<WeightDetailState>(trackers.weightDetail(planReader, noRefresh));
    const today = follow(trackers.weightToday(planReader, noRefresh));
    await settled();
    await expect(trackers.weightTrendReader.latest(philipp)).resolves.toMatchObject({ lastDayWeight: { dayWeightG: 82_437 }, dayWeightCount: 1 });
    expect(today()).toMatchObject({ type: 'ready', data: { status: { type: 'gewogen' } } });
    reports.length = 0;

    const outcome = trackers.hideImported(scale);
    await settled();

    expect(ImportHiddenOutcome.parse(outcome)).toEqual({ messageKey: 'gewicht.ausgeblendet', values: { weightG: 82_437 }, undoToken: expect.any(String) });
    expect(weights().find((row) => row.id === scale)).toMatchObject({ hiddenAt: noon, weightG: 82_437 });
    expect(operations().at(-1)).toMatchObject({ type: 'upsert_entity', entityType: 'weight_entry', entityId: scale, payload: { hiddenAt: noon } });
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
    expect(detail()).toEqual({ type: 'ready', detail: expect.objectContaining({ lastDayWeight: null, entries: [] }) });
    expect(today()).toMatchObject({ type: 'ready', data: { status: { type: 'wiegetag_offen' } } });
    await expect(trackers.weightTrendReader.latest(philipp)).resolves.toMatchObject({ lastDayWeight: null, dayWeightCount: 0 });

    // Eine spätere Messung desselben Tags wird Tagesgewicht; Rückgängig macht die Waage wieder dazu.
    trackers.expire(trackers.recordWeight({ weightG: 82_900, measuredAt: later }).undoToken);
    await settled();
    expect(detail()).toMatchObject({ type: 'ready', detail: { lastDayWeight: { localDate: '2026-10-14', weightG: 82_900 } } });
    trackers.undo(outcome.undoToken);
    await settled();
    expect(detail()).toMatchObject({ type: 'ready', detail: { lastDayWeight: { localDate: '2026-10-14', weightG: 82_437 } } });
    expect(today()).toMatchObject({ type: 'ready', data: { status: { type: 'gewogen' } } });
  });

  it('ein späterer Upsert eines ausgeblendeten Gewichts blendet es nicht wieder ein', async () => {
    const created = await world();
    const { trackers, weights } = created;
    importWeights(created, weight('waage', early, 82_437));
    const scale = importedWeightId(created, 'waage');
    trackers.expire(trackers.hideImported(scale).undoToken);

    importWeights(created, weight('waage', early, 82_512));

    expect(weights().find((row) => row.id === scale)).toMatchObject({ weightG: 82_512, hiddenAt: noon });
  });

  it('lehnt manuelle, unbekannte, gelöschte und schon ausgeblendete Einträge ab, ohne etwas zu schreiben', async () => {
    const created = await world();
    const { trackers, operations, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60), workout('weg', later, 20 * 60));
    const hidden = importedSportId(created, 'training');
    const deleted = importedSportId(created, 'weg');
    trackers.expire(trackers.hideImported(hidden).undoToken);
    trackers.importHealth({ origin: 'apple_health', type: 'workout', upserts: [], deletedKeys: ['weg'], reconcileSince: null, notBefore }, () => {});
    const { undoToken } = trackers.recordWeight({ weightG: 82_400, measuredAt: morning });
    trackers.expire(undoToken);
    const manualWeight = EntityId.parse(created.weights().find((row) => row.origin === 'manuell')!.id);
    const manualSport = pulledManual(created, {});
    const before = operations().length;
    reports.length = 0;

    for (const id of [hidden, deleted, manualWeight, manualSport, unknownId]) expect(() => trackers.hideImported(id)).toThrow(InvalidTrackerInputError);

    expect(operations()).toHaveLength(before);
    expect(reports).toEqual([]);
  });

  it('scheitert die Auswertung, bleibt nichts von der Ausblendung', async () => {
    const created = await world();
    const { trackers, sports, operations, failReevaluation } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    const before = operations().length;
    failReevaluation(true);

    expect(() => trackers.hideImported(id)).toThrow('Auswertung gescheitert');

    expect(sports().find((row) => row.id === id)).toMatchObject({ hiddenAt: null });
    expect(operations()).toHaveLength(before);
  });
});

describe('overrideActivityType', () => {
  it('überschreibt die Art eines Trainings, samt Outbox-Operation, gemeldetem Tag und Meldung; angezeigt wird die überschriebene Art', async () => {
    const created = await world();
    const { trackers, sports, operations, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    const week = follow<SportWeekState>(trackers.sportWeek(planReader, noRefresh, null));
    reports.length = 0;

    const outcome = trackers.overrideActivityType(id, 'krafttraining');
    await settled();

    expect(ActivityTypeOverriddenOutcome.parse(outcome)).toEqual({
      messageKey: 'sport.art_geaendert',
      values: { activityType: 'krafttraining', durationMinutes: 52 },
      undoToken: expect.any(String),
    });
    expect(sports().find((row) => row.id === id)).toMatchObject({ activityType: 'radfahren', overrideActivityType: 'krafttraining' });
    expect(operations().at(-1)).toMatchObject({ type: 'upsert_entity', entityId: id, payload: { activityType: 'radfahren', overrideActivityType: 'krafttraining' } });
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
    expect(week()).toMatchObject({
      type: 'ready',
      week: { weekMinutes: 52, days: [{ entries: [{ id, activityType: 'krafttraining', recognizedActivityType: 'radfahren' }] }] },
    });
  });

  it('„Rückgängig“ stellt die vorher überschriebene Art wieder her, beim ersten Mal die erkannte', async () => {
    const created = await world();
    const { trackers, sports, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    const first = trackers.overrideActivityType(id, 'krafttraining');
    const second = trackers.overrideActivityType(id, 'yoga_dehnen');
    reports.length = 0;

    trackers.undo(second.undoToken);
    expect(sports().find((row) => row.id === id)).toMatchObject({ overrideActivityType: 'krafttraining' });
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'rueckgaengig' }]);

    trackers.undo(first.undoToken);
    expect(sports().find((row) => row.id === id)).toMatchObject({ activityType: 'radfahren', overrideActivityType: null });
  });

  it('ein späterer Upsert aus der Quelle lässt die überschriebene Art unverändert', async () => {
    const created = await world();
    const { trackers, sports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60));
    const id = importedSportId(created, 'training');
    trackers.expire(trackers.overrideActivityType(id, 'krafttraining').undoToken);

    importWorkouts(created, { ...workout('training', morning, 58 * 60), platformActivityType: 37 });

    expect(sports().find((row) => row.id === id)).toMatchObject({ durationMinutes: 58, activityType: 'laufen', overrideActivityType: 'krafttraining' });
  });

  it('lehnt unbekannte Arten, Gewichte, manuelle, ausgeblendete und unbekannte Einträge ab, ohne etwas zu schreiben', async () => {
    const created = await world();
    const { trackers, operations, reports } = created;
    importWorkouts(created, workout('training', morning, 52 * 60), workout('versteckt', later, 20 * 60));
    importWeights(created, weight('waage', early, 82_437));
    const id = importedSportId(created, 'training');
    const hidden = importedSportId(created, 'versteckt');
    trackers.expire(trackers.hideImported(hidden).undoToken);
    const manual = pulledManual(created, {});
    const before = operations().length;
    reports.length = 0;

    expect(() => trackers.overrideActivityType(id, 'tanzen' as never)).toThrow(InvalidTrackerInputError);
    for (const other of [importedWeightId(created, 'waage'), manual, hidden, unknownId]) {
      expect(() => trackers.overrideActivityType(other, 'laufen')).toThrow(InvalidTrackerInputError);
    }

    expect(operations()).toHaveLength(before);
    expect(reports).toEqual([]);
  });
});
