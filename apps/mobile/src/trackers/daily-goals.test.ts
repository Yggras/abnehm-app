/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, type BausteinKey } from '@abnehm/contracts/base';
import { DailyGoalSnapshot, type DailyGoalEvaluation } from '@abnehm/contracts/daily-goals';
import { EffectivePlan } from '@abnehm/contracts/ports';
import type { SportEntryRecord } from '@abnehm/contracts/trackers';

import {
  createDailyGoalRegistry,
  type DailyGoalRegistry,
  type DailyGoalSnapshotOf,
  type ValidPlan,
} from '../daily-goals';
import { completionConformanceCases } from '../daily-goals/testing/completion-conformance';
import { bausteinConformanceCases, checkInConformanceCases, type BausteinTruthRow, type CheckInTruthRow } from '../daily-goals/testing/conformance';
import { insertDailyGoalForTest } from '../daily-goals/testing/persisted';
import { dailyGoalCompletion, energyBooking } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sportEntryEntity, trackerDailyGoals, type SportDayFacts, type WaterDayFacts, type WeightDayFacts } from '.';
import type { SportInput } from './sport';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #178: die Beiträge von Wasser, Sport und Gewicht zu den Verträgen aus Spezifikation 0,
// Abschnitt 3 (Spezifikation 3, Abschnitt 7). Die Evaluatoren für Wasserziel, Sporteinheit und Gewogen und
// die Tages-Check-ins `wasser`, `sport` und `gewicht` bestehen das Konformitäts-Testkit aus #104 mit ihren
// Wahrheitstabellen. Danach laufen Reader, Registry und Persistenzdienst (#105) gegen eine echte
// SQLite-Datei mit denselben Migrationen wie die App, über die Befehle des Tracker-Moduls.

const [waterGoal, sportGoal, weighedGoal] = trackerDailyGoals.bausteine;
const [waterCheckIn, sportCheckIn, weightCheckIn] = trackerDailyGoals.checkIns;

const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const today = LocalDate.parse('2026-10-14');
const yesterday = LocalDate.parse('2026-10-13');
/** Mittwoch, 14.10.2026, in Berlin (Sommerzeit, UTC+2): Abend, Tagesende und kurz danach. */
const evening = Instant.parse('2026-10-14T17:00:00.000Z');
const dayEnd = Instant.parse('2026-10-14T22:00:00.000Z');
const afterDayEnd = Instant.parse('2026-10-14T22:00:00.001Z');

const snapshotBase = { personId: philipp, localDate: today, slot: 2, timeZone: berlin, dayEndsAt: dayEnd } as const;
const waterSnapshot = DailyGoalSnapshot.parse({ ...snapshotBase, type: 'wasserziel', targetMl: 2_500 }) as DailyGoalSnapshotOf<'wasserziel'>;
const sportSnapshot = DailyGoalSnapshot.parse({ ...snapshotBase, slot: 3, type: 'sporteinheit', minimumSingleSessionMinutes: 20 }) as DailyGoalSnapshotOf<'sporteinheit'>;
const weighedSnapshot = DailyGoalSnapshot.parse({ ...snapshotBase, slot: 1, type: 'gewogen' }) as DailyGoalSnapshotOf<'gewogen'>;

const goalVersion = {
  id: EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c02'),
  calorieBudgetMilliKcal: 2_417_875,
  lowerBoundMilliKcal: 1_882_500,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 78_000,
  waterTargetMl: 2_500,
  weeklySportTargetMinutes: 150,
} as const;

/** Gültiger Plan eines Tags mit Philipps Zielversion und den Bausteinen des Wochenplantags. */
const validPlan = (localDate: LocalDate, bausteine: [BausteinKey, BausteinKey, BausteinKey]): ValidPlan =>
  EffectivePlan.parse({
    type: 'gueltig',
    localDate,
    goal: { ...goalVersion, validFrom: '2026-10-01' },
    weeklyPlanDay: { weeklyPlanVersionId: '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c01', validFrom: '2026-10-01', bausteine },
  }) as ValidPlan;

/** Wochenplantage: mit allen drei Trackern, ohne Sporteinheit und ohne Gewogen. */
const allTrackers = validPlan(today, ['wasserziel', 'sporteinheit', 'gewogen']);
const restDay = validPlan(today, ['ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel']);

const water = (countedMl: number): WaterDayFacts => ({ countedMl });
const sport = (...countingSessionMinutes: number[]): SportDayFacts => ({ countingSessionMinutes });
const weight = (countingEntries: number): WeightDayFacts => ({ countingEntries });

describe('Konformitäts-Testkit: Wasserziel', () => {
  const progress = (countedMl: number) => ({ type: 'wasserziel' as const, countedMl, targetMl: 2_500 });
  const row = (name: string, at: Instant, ml: number, currentState: 'offen' | 'teilweise' | 'erfuellt'): BausteinTruthRow<'wasserziel', WaterDayFacts> => ({
    name,
    snapshot: waterSnapshot,
    at,
    facts: water(ml),
    expected: { currentState, progress: progress(ml) },
  });
  const rows = [
    row('0 ml: offen', noon, 0, 'offen'),
    row('1 ml: teilweise', noon, 1, 'teilweise'),
    row('Ziel −1 ml: teilweise', evening, 2_499, 'teilweise'),
    row('genau das Ziel: erfüllt', evening, 2_500, 'erfuellt'),
    row('Ziel +1 ml: erfüllt', evening, 2_501, 'erfuellt'),
    row('0 ml nach Tagesende: offen', afterDayEnd, 0, 'offen'),
    row('Ziel nach Tagesende: erfüllt', afterDayEnd, 2_500, 'erfuellt'),
  ];
  for (const { name, run } of bausteinConformanceCases(waterGoal, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Sporteinheit', () => {
  const progress = (longestSessionMinutes: number) => ({ type: 'sporteinheit' as const, longestSessionMinutes, minimumSingleSessionMinutes: 20 });
  const row = (name: string, at: Instant, facts: SportDayFacts, longest: number, currentState: 'offen' | 'teilweise' | 'erfuellt'): BausteinTruthRow<'sporteinheit', SportDayFacts> => ({
    name,
    snapshot: sportSnapshot,
    at,
    facts,
    expected: { currentState, progress: progress(longest) },
  });
  const rows = [
    row('kein zählender Eintrag: offen', noon, sport(), 0, 'offen'),
    row('längste Einheit Schwelle −1: teilweise', noon, sport(19), 19, 'teilweise'),
    row('zwei kurze Einheiten addieren sich nicht: teilweise', evening, sport(15, 19, 10), 19, 'teilweise'),
    row('längste Einheit genau auf der Schwelle: erfüllt', evening, sport(5, 20), 20, 'erfuellt'),
    row('längste Einheit Schwelle +1: erfüllt', evening, sport(21, 3), 21, 'erfuellt'),
    row('kein Eintrag nach Tagesende: offen', afterDayEnd, sport(), 0, 'offen'),
  ];
  for (const { name, run } of bausteinConformanceCases(sportGoal, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Gewogen', () => {
  const row = (name: string, at: Instant, entries: number, currentState: 'offen' | 'erfuellt'): BausteinTruthRow<'gewogen', WeightDayFacts> => ({
    name,
    snapshot: weighedSnapshot,
    at,
    facts: weight(entries),
    expected: { currentState, progress: { type: 'gewogen', weightEntryCount: entries } },
  });
  const rows = [
    row('kein zählender Eintrag: offen', noon, 0, 'offen'),
    row('ein Eintrag: erfüllt, nie teilweise', noon, 1, 'erfuellt'),
    row('zwei Einträge: erfüllt', evening, 2, 'erfuellt'),
    row('kein Eintrag nach Tagesende: offen', afterDayEnd, 0, 'offen'),
  ];
  for (const { name, run } of bausteinConformanceCases(weighedGoal, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Tages-Check-in Wasser', () => {
  // Ziel 2500 ml: ⅓ = 833,3 ml, ⅔ = 1666,7 ml. Hinterher ist, wer darunter liegt.
  const row = (moment: 'mittag' | 'abend', ml: number, behind: boolean, plan: ValidPlan = allTrackers, label = ''): CheckInTruthRow<'wasser', WaterDayFacts> => ({
    name: `${moment} mit ${ml} ml${label}: ${behind ? 'hinterher' : 'nicht hinterher'}`,
    moment,
    plan,
    facts: water(ml),
    expected: { behind, reason: { type: 'wasser', countedMl: ml, targetMl: 2_500 } },
  });
  const rows = [
    row('mittag', 0, true),
    row('mittag', 833, true),
    row('mittag', 834, false),
    row('abend', 834, true),
    row('abend', 1_666, true),
    row('abend', 1_667, false),
    row('abend', 2_600, false),
    row('mittag', 0, true, validPlan(today, ['ernaehrung_erfasst', 'im_kalorienbudget', 'gewogen']), ' ohne Wasserziel im Wochenplan'),
  ];
  for (const { name, run } of checkInConformanceCases(waterCheckIn, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Tages-Check-in Sport', () => {
  const reason = (sportDay: boolean, hasCountingEntry: boolean) => ({ type: 'sport' as const, sportDay, hasCountingEntry, messageKey: 'checkin.sport.schon_trainiert' });
  const row = (moment: 'mittag' | 'abend', plan: ValidPlan, facts: SportDayFacts, behind: boolean): CheckInTruthRow<'sport', SportDayFacts> => {
    const sportDay = plan === allTrackers;
    const hasEntry = facts.countingSessionMinutes.length > 0;
    return {
      name: `${moment} ${sportDay ? 'am Sporttag' : 'ohne Sporttag'} ${hasEntry ? 'mit' : 'ohne'} Eintrag: ${behind ? 'hinterher' : 'nicht hinterher'}`,
      moment,
      plan,
      facts,
      expected: { behind, reason: reason(sportDay, hasEntry) },
    };
  };
  const rows = [
    row('mittag', allTrackers, sport(), false),
    row('mittag', allTrackers, sport(5), false),
    row('abend', allTrackers, sport(), true),
    // Auch eine Einheit unter der Mindestdauer ist ein zählender Eintrag.
    row('abend', allTrackers, sport(5), false),
    row('abend', restDay, sport(), false),
    row('mittag', restDay, sport(), false),
  ];
  for (const { name, run } of checkInConformanceCases(sportCheckIn, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Tages-Check-in Gewicht', () => {
  const row = (moment: 'mittag' | 'abend', plan: ValidPlan, entries: number, behind: boolean): CheckInTruthRow<'gewicht', WeightDayFacts> => {
    const weighDay = plan === allTrackers;
    return {
      name: `${moment} ${weighDay ? 'am Wiegetag' : 'ohne Wiegetag'} mit ${entries} Einträgen: ${behind ? 'hinterher' : 'nicht hinterher'}`,
      moment,
      plan,
      facts: weight(entries),
      expected: { behind, reason: { type: 'gewicht', weighDay, hasCountingEntry: entries > 0 } },
    };
  };
  const rows = [
    row('mittag', allTrackers, 0, true),
    row('abend', allTrackers, 0, true),
    row('mittag', allTrackers, 1, false),
    row('abend', allTrackers, 2, false),
    row('mittag', restDay, 0, false),
    row('abend', restDay, 0, false),
  ];
  for (const { name, run } of checkInConformanceCases(weightCheckIn, rows)) test(name, run);
});

describe('Konformitäts-Testkit, Teil 2: Erfüllung über den Orchestrator', () => {
  const correctedAt = Instant.parse('2026-10-14T18:00:00.000Z');
  for (const { name, run } of [
    ...completionConformanceCases({
      evaluator: waterGoal,
      snapshot: waterSnapshot,
      fulfilled: { at: evening, facts: water(2_500) },
      corrected: { at: correctedAt, facts: water(2_000) },
    }),
    ...completionConformanceCases({
      evaluator: sportGoal,
      snapshot: sportSnapshot,
      fulfilled: { at: evening, facts: sport(30) },
      corrected: { at: correctedAt, facts: sport() },
    }),
    ...completionConformanceCases({
      evaluator: weighedGoal,
      snapshot: weighedSnapshot,
      fulfilled: { at: evening, facts: weight(1) },
      corrected: { at: correctedAt, facts: weight(0) },
    }),
  ]) {
    test(name, run);
  }
});

it('Wasser, Sport und Gewicht registrieren je einen Baustein und einen Check-in, das Kalorienbudget keinen', () => {
  expect(trackerDailyGoals.bausteine.map((evaluator) => evaluator.baustein)).toEqual(['wasserziel', 'sporteinheit', 'gewogen']);
  expect(trackerDailyGoals.checkIns.map((evaluator) => evaluator.tracker)).toEqual(['wasser', 'sport', 'gewicht']);
});

// Über das Tracker-Modul: echte Befehle, echte Registry und echter Persistenzdienst.

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

/** 07:00 in Berlin; die Uhr der Welten steht später. */
const morning = Instant.parse('2026-10-14T05:00:00.000Z');
const yesterdayMorning = Instant.parse('2026-10-13T05:00:00.000Z');
const fitbit = { id: 'com.fitbit.FitbitMobile', name: 'Fitbit' } as const;
const notBefore = Instant.parse('2026-10-01T00:00:00.000Z');

async function world({ at = evening }: { at?: Instant } = {}) {
  const clock: TestClock = createTestClock({ instant: at, timeZone: berlin });
  const created = await createTrackerWorld(clock, { bausteine: trackerDailyGoals.bausteine });
  worlds.push(created);
  const registry: DailyGoalRegistry = createDailyGoalRegistry(trackerDailyGoals);
  const goals: Record<string, DailyGoalSnapshot> = {};
  const { database } = created;
  return {
    ...created,
    clock,
    registry,
    /** Legt ein Tagesziel an, wie es die Materialisierung aus Spezifikation 1 täte. */
    goal(name: string, snapshot: DailyGoalSnapshot) {
      database.transaction((tx) => insertDailyGoalForTest(tx, EntityId.parse(randomUUID()), snapshot));
      goals[name] = snapshot;
    },
    evaluate(name: string): DailyGoalEvaluation {
      return database.read((tx) => registry.evaluateDailyGoal(tx, goals[name]!, Instant.parse(clock.read().instant)));
    },
    checkIn(tracker: 'wasser' | 'sport' | 'gewicht', moment: 'mittag' | 'abend', plan: ValidPlan = allTrackers, personId: EntityId = philipp) {
      return database.read((tx) => registry.evaluateCheckIn(tx, { tracker, personId, localDate: plan.localDate, moment, plan }));
    },
    completions: () => database.read((tx) => sqliteOf(tx).select().from(dailyGoalCompletion).all()),
    bookings: () => database.read((tx) => sqliteOf(tx).select().from(energyBooking).all()),
    importWorkout(startedAt: Instant, minutes: number) {
      created.trackers.importHealth(
        {
          origin: 'apple_health',
          type: 'workout',
          upserts: [
            {
              type: 'workout',
              externalKey: `training-${startedAt}`,
              sourceApp: fitbit,
              utcOffsetMinutes: 120,
              startedAt,
              endedAt: Instant.parse(new Date(Date.parse(startedAt) + minutes * 60_000).toISOString()),
              durationSeconds: minutes * 60,
              platformActivityType: 37,
              activeMilliKcal: null,
            },
          ],
          deletedKeys: [],
          reconcileSince: null,
          notBefore,
        },
        () => {},
      );
      return EntityId.parse(created.sports().find((row) => row.startedAt === startedAt && row.origin !== 'manuell')!.id);
    },
    importWeight(measuredAt: Instant, weightG: number) {
      created.trackers.importHealth(
        {
          origin: 'apple_health',
          type: 'weight',
          upserts: [{ type: 'weight', externalKey: `waage-${measuredAt}`, sourceApp: fitbit, utcOffsetMinutes: 120, measuredAt, weightG }],
          deletedKeys: [],
          reconcileSince: null,
          notBefore,
        },
        () => {},
      );
      return EntityId.parse(created.weights().find((row) => row.measuredAt === measuredAt)!.id);
    },
  };
}

/** Ein Sporteintrag, wie ihn ein Pull vom Server übernimmt; ohne Angaben eine Einheit von heute. */
function pulled({ database }: TrackerWorld, data: Partial<SportEntryRecord> & Pick<SportEntryRecord, 'origin'>): EntityId {
  const id = EntityId.parse(randomUUID());
  const base = {
    activityType: 'laufen', startedAt: morning, durationMinutes: 30, activeMilliKcal: null,
    localDate: today, timeZone: berlin, utcOffsetMinutes: 120, personId: philipp, createdAt: noon, updatedAt: noon,
  };
  const byOrigin = data.origin === 'manuell'
    ? { replacedByEntryId: null, reactivatedAt: null }
    : { overrideActivityType: null, externalKey: randomUUID(), sourceAppId: fitbit.id, sourceAppName: null, hiddenAt: null };
  database.transaction((tx) =>
    sportEntryEntity.applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse('1'), data: { ...base, ...byOrigin, ...data } as SportEntryRecord }));
  return id;
}

const session = (startedAt: Instant, durationMinutes: number): SportInput => ({ activityType: 'laufen', durationMinutes, startedAt, activeMilliKcal: null });

describe('Bereichsreader', () => {
  it('Wasser: zählt nur nicht gelöschte Einträge der Person an diesem lokalen Tag', async () => {
    const created = await world();
    created.trackers.addWater({ ml: 250 });
    const removed = created.trackers.addWater({ ml: 500 });
    created.trackers.addWater({ ml: 250 });
    created.trackers.undo(removed.undoToken);

    expect(created.database.read((tx) => waterGoal.readFacts(tx, philipp, today))).toEqual({ countedMl: 500 });
    expect(created.database.read((tx) => waterGoal.readFacts(tx, philipp, yesterday))).toEqual({ countedMl: 0 });
    expect(created.database.read((tx) => waterGoal.readFacts(tx, anna, today))).toEqual({ countedMl: 0 });
  });

  it('Sport: Einheiten des Tags nach der Zählregel, ohne ausgeblendete Importe und ersetzte manuelle Einheiten', async () => {
    const created = await world();
    const facts = () => created.database.read((tx) => sportGoal.readFacts(tx, philipp, today));
    created.trackers.recordSport(session(yesterdayMorning, 40));
    created.trackers.recordSport(session(morning, 25));
    expect(facts()).toEqual({ countingSessionMinutes: [25] });

    // Ein Training über Mitternacht von gestern ersetzt eine manuelle Einheit von heute, wie es der Pull
    // eines anderen Geräts bringt (Ersetzung nach Spezifikation 3, Abschnitt 3).
    const lateImport = pulled(created, { origin: 'apple_health', startedAt: Instant.parse('2026-10-13T21:30:00.000Z'), localDate: yesterday, durationMinutes: 60 });
    const replaced = pulled(created, { origin: 'manuell', startedAt: Instant.parse('2026-10-13T22:00:00.000Z'), durationMinutes: 30, replacedByEntryId: lateImport });
    expect(facts()).toEqual({ countingSessionMinutes: [25] });

    // Ausgeblendet zählt der Import nicht mehr, die ersetzte manuelle Einheit wieder.
    created.trackers.hideImported(lateImport);
    expect(facts()).toEqual({ countingSessionMinutes: [30, 25] });

    const imported = created.importWorkout(Instant.parse('2026-10-14T15:00:00.000Z'), 45);
    expect(facts()).toEqual({ countingSessionMinutes: [30, 25, 45] });
    created.trackers.hideImported(imported);
    created.trackers.deleteSport(replaced);
    expect(facts()).toEqual({ countingSessionMinutes: [25] });
    expect(created.database.read((tx) => sportGoal.readFacts(tx, anna, today))).toEqual({ countingSessionMinutes: [] });
  });

  it('Gewicht: zählt alle Messungen des Tags außer gelöschten und ausgeblendeten', async () => {
    const created = await world();
    const facts = () => created.database.read((tx) => weighedGoal.readFacts(tx, philipp, today));
    created.trackers.recordWeight({ weightG: 82_000, measuredAt: yesterdayMorning });
    expect(facts()).toEqual({ countingEntries: 0 });

    created.trackers.recordWeight({ weightG: 81_400, measuredAt: morning });
    const scale = created.importWeight(Instant.parse('2026-10-14T05:30:00.000Z'), 81_350);
    expect(facts()).toEqual({ countingEntries: 2 });

    created.trackers.hideImported(scale);
    expect(facts()).toEqual({ countingEntries: 1 });
  });
});

describe('Tagesziele über Tracker-Modul, Registry und Persistenzdienst', () => {
  it('Wasser: die Buchung, die das Ziel erreicht, erfüllt das Tagesziel; genau eine Erfüllung und +1', async () => {
    const created = await world();
    created.goal('wasser', waterSnapshot);

    created.trackers.addWater({ ml: 1_500 });
    expect(created.evaluate('wasser')).toMatchObject({ currentState: 'teilweise', progress: { countedMl: 1_500, targetMl: 2_500 }, completion: { type: 'nie' } });
    expect(created.completions()).toEqual([]);

    created.trackers.addWater({ ml: 1_000 });
    expect(created.evaluate('wasser')).toMatchObject({
      currentState: 'erfuellt',
      messageKey: 'tagesziel.wasserziel.erfuellt',
      values: { countedMl: 2_500, targetMl: 2_500 },
      completion: { type: 'festgehalten', firstCompletedAt: evening },
    });
    expect(created.completions()).toMatchObject([{ baustein: 'wasserziel', slot: 2, localDate: today }]);
    expect(created.bookings().map((booking) => booking.type)).toEqual(['daily_goal_credit']);
  });

  it('Wasser: eine Korrektur danach ergibt „offen · bereits gutgeschrieben“ ohne Gegenbuchung', async () => {
    const created = await world();
    created.goal('wasser', waterSnapshot);
    const added = created.trackers.addWater({ ml: 2_500 });
    const bookings = created.bookings();
    expect(bookings).toHaveLength(1);

    created.clock.set(Instant.parse('2026-10-14T17:30:00.000Z'));
    expect(created.trackers.undo(added.undoToken)).toEqual({ type: 'undone' });

    expect(created.evaluate('wasser')).toMatchObject({ currentState: 'offen', progress: { countedMl: 0 }, completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.bookings()).toEqual(bookings);
    expect(created.completions()).toHaveLength(1);

    // Erneut erfüllt und erneut ausgewertet: dieselbe Erfüllung, keine zweite Gutschrift.
    created.trackers.addWater({ ml: 3_000 });
    created.database.transaction((tx) => created.dependencies.persistence.reevaluateDailyGoals(tx, philipp, [today], 'app_oeffnung'));
    expect(created.evaluate('wasser')).toMatchObject({ currentState: 'erfuellt', completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.completions()).toHaveLength(1);
    expect(created.bookings()).toEqual(bookings);
  });

  it('Sport: erst die ausreichend lange Einheit erfüllt; Löschen danach lässt die Erfüllung stehen', async () => {
    const created = await world();
    created.goal('sport', sportSnapshot);

    created.trackers.recordSport(session(morning, 15));
    expect(created.evaluate('sport')).toMatchObject({ currentState: 'teilweise', progress: { longestSessionMinutes: 15 }, completion: { type: 'nie' } });

    created.trackers.recordSport(session(Instant.parse('2026-10-14T15:00:00.000Z'), 20));
    expect(created.evaluate('sport')).toMatchObject({ currentState: 'erfuellt', progress: { longestSessionMinutes: 20 }, completion: { type: 'festgehalten' } });
    const bookings = created.bookings();
    expect(bookings).toHaveLength(1);

    for (const row of created.sports()) created.trackers.deleteSport(EntityId.parse(row.id));
    expect(created.evaluate('sport')).toMatchObject({ currentState: 'offen', progress: { longestSessionMinutes: 0 }, completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.completions()).toHaveLength(1);
    expect(created.bookings()).toEqual(bookings);
  });

  it('Sport: ein Import erfüllt; wiederholter Import erzeugt keine zweite Erfüllung', async () => {
    const created = await world();
    created.goal('sport', sportSnapshot);

    created.importWorkout(morning, 45);
    created.importWorkout(morning, 45);

    expect(created.evaluate('sport')).toMatchObject({ currentState: 'erfuellt', progress: { longestSessionMinutes: 45 } });
    expect(created.completions()).toHaveLength(1);
    expect(created.bookings()).toHaveLength(1);
  });

  it('Gewogen: ein importierter Waagenwert erfüllt; Ausblenden danach ergibt „offen · bereits gutgeschrieben“', async () => {
    const created = await world();
    created.goal('gewogen', weighedSnapshot);

    const scale = created.importWeight(morning, 81_350);
    expect(created.evaluate('gewogen')).toMatchObject({ currentState: 'erfuellt', progress: { weightEntryCount: 1 }, completion: { type: 'festgehalten', firstCompletedAt: evening } });

    created.trackers.hideImported(scale);
    expect(created.evaluate('gewogen')).toMatchObject({ currentState: 'offen', progress: { weightEntryCount: 0 }, completion: { type: 'festgehalten' } });
    expect(created.completions()).toHaveLength(1);
    expect(created.bookings()).toHaveLength(1);
  });

  it('Gewogen: Nachtragen für gestern erfüllt das Tagesziel von gestern', async () => {
    const created = await world();
    created.goal('gestern', { ...weighedSnapshot, localDate: yesterday, dayEndsAt: Instant.parse('2026-10-13T22:00:00.000Z') });

    created.trackers.recordWeight({ weightG: 82_000, measuredAt: yesterdayMorning });

    expect(created.evaluate('gestern')).toMatchObject({ currentState: 'erfuellt', dayClosed: true, completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.completions()).toMatchObject([{ localDate: yesterday, baustein: 'gewogen' }]);
  });
});

describe('Tages-Check-in über die Registry', () => {
  it('Wasser: liest die gezählte Menge, auch ohne Momo-Platz für das Wasser', async () => {
    const created = await world();
    const withoutWater = validPlan(today, ['ernaehrung_erfasst', 'im_kalorienbudget', 'sporteinheit']);
    expect(created.checkIn('wasser', 'mittag', withoutWater)).toEqual({
      type: 'evaluated',
      tracker: 'wasser',
      moment: 'mittag',
      behind: true,
      reason: { type: 'wasser', countedMl: 0, targetMl: 2_500 },
    });

    created.trackers.addWater({ ml: 1_000 });
    expect(created.checkIn('wasser', 'mittag', withoutWater)).toMatchObject({ behind: false, reason: { countedMl: 1_000 } });
    expect(created.checkIn('wasser', 'abend', withoutWater)).toMatchObject({ behind: true, reason: { countedMl: 1_000 } });
  });

  it('Sport: abends am Sporttag ohne Einheit hinterher, mit weichem Textschlüssel', async () => {
    const created = await world();
    expect(created.checkIn('sport', 'mittag')).toMatchObject({ behind: false });
    expect(created.checkIn('sport', 'abend')).toEqual({
      type: 'evaluated',
      tracker: 'sport',
      moment: 'abend',
      behind: true,
      reason: { type: 'sport', sportDay: true, hasCountingEntry: false, messageKey: 'checkin.sport.schon_trainiert' },
    });
    expect(created.checkIn('sport', 'abend', restDay)).toMatchObject({ behind: false, reason: { sportDay: false } });

    created.trackers.recordSport(session(morning, 5));
    expect(created.checkIn('sport', 'abend')).toMatchObject({ behind: false, reason: { hasCountingEntry: true } });
  });

  it('Gewicht: nur am Wiegetag hinterher, der Grund enthält keine Gewichtswerte', async () => {
    const created = await world();
    expect(created.checkIn('gewicht', 'mittag')).toMatchObject({ behind: true, reason: { weighDay: true, hasCountingEntry: false } });
    expect(created.checkIn('gewicht', 'mittag', restDay)).toMatchObject({ behind: false, reason: { weighDay: false } });

    created.trackers.recordWeight({ weightG: 81_400, measuredAt: morning });
    const result = created.checkIn('gewicht', 'abend');
    expect(result).toEqual({ type: 'evaluated', tracker: 'gewicht', moment: 'abend', behind: false, reason: { type: 'gewicht', weighDay: true, hasCountingEntry: true } });
    expect(JSON.stringify(result)).not.toMatch(/81[.,]?4|81400/);
  });
});
