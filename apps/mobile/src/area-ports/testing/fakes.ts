import { LocalDate, TimeZone, weekdayOf, type BausteinKey, type EntityId, type Weekday } from '@abnehm/contracts/base';
import type {
  DailyIntakeSeries,
  EffectivePlan,
  IntakeReader,
  IslandCheckInHint,
  IslandCheckInHintReader,
  LatestWeight,
  PlanReader,
  RecordManualWeight,
  WeightRecorder,
  WeightTrendReader,
  WeightTrendSeries,
} from '@abnehm/contracts/ports';

import { checkAreaPorts, type AreaPorts } from '..';

// Fake-Ports für Tests der Bereiche: vertragskonforme Adapter im Speicher. Ihre Rückgaben laufen
// durch dieselbe Vertragsprüfung wie die echten Ports (`checkAreaPorts`); ein Test, der unmögliche
// Werte hinterlegt, scheitert deshalb mit `PortContractError` statt still weiterzurechnen.

type GoalVersion = Extract<EffectivePlan, { type: 'gueltig' }>['goal'];
type Bausteine = [BausteinKey, BausteinKey, BausteinKey];

export type FakeGoalVersion = GoalVersion & { personId: EntityId };
export type FakeWeeklyPlanVersion = { id: EntityId; personId: EntityId; validFrom: LocalDate; days: Record<Weekday, Bausteine> };

/** `PlanReader` über hinterlegte Fassungen: je Tag die Fassung mit dem größten `validFrom` ≤ Tag. */
export function fakePlanReader(versions: { goals?: readonly FakeGoalVersion[]; weeklyPlans?: readonly FakeWeeklyPlanVersion[] } = {}): PlanReader {
  const latest = <T extends { personId: EntityId; validFrom: LocalDate }>(all: readonly T[], personId: EntityId, day: LocalDate) =>
    all
      .filter((version) => version.personId === personId && version.validFrom <= day)
      .reduce<T | undefined>((best, version) => (best === undefined || version.validFrom > best.validFrom ? version : best), undefined);

  return {
    effectivePlan: async (personId, localDate) => {
      const goal = latest(versions.goals ?? [], personId, localDate);
      const weeklyPlan = latest(versions.weeklyPlans ?? [], personId, localDate);
      if (goal === undefined || weeklyPlan === undefined) return { type: 'leer', localDate };
      const { personId: _owner, ...goalVersion } = goal;
      return {
        type: 'gueltig',
        localDate,
        goal: goalVersion,
        weeklyPlanDay: {
          weeklyPlanVersionId: weeklyPlan.id,
          validFrom: weeklyPlan.validFrom,
          bausteine: weeklyPlan.days[weekdayOf(localDate)],
        },
      };
    },
  };
}

/** `WeightTrendReader` über hinterlegte Reihen; ohne Eintrag hat die Person nie gewogen. */
export function fakeWeightTrendReader(
  data: { series?: Readonly<Record<string, WeightTrendSeries>>; latest?: Readonly<Record<string, LatestWeight>> } = {},
): WeightTrendReader {
  return {
    series: async (personId, from, to) => (data.series?.[personId] ?? []).filter((day) => day.localDate >= from && day.localDate <= to),
    latest: async (personId) =>
      data.latest?.[personId] ?? { lastDayWeight: null, dayWeightCount: 0, trend: { type: 'noch_nicht_verfuegbar' } },
  };
}

type IntakeDay = Omit<DailyIntakeSeries[number], 'localDate'>;

/** `IntakeReader`: jeder Tag des Bereichs, Tage ohne hinterlegte Aufnahme mit 0. */
export function fakeIntakeReader(days: Readonly<Record<string, Readonly<Record<string, IntakeDay>>>> = {}): IntakeReader {
  return {
    dailyIntake: async (personId, from, to) => {
      const series: DailyIntakeSeries = [];
      for (let day = from; day <= to; day = nextDay(day)) {
        series.push({ localDate: day, ...(days[personId]?.[day] ?? { intakeMilliKcal: 0, recordedMealCategories: 0 }) });
      }
      return series;
    },
  };
}

/**
 * `WeightRecorder` im Speicher: idempotent je `entryId`, ein erneuter Aufruf ersetzt den Eintrag.
 * Den lokalen Tag des Messzeitpunkts bestimmt die Zone der Person (Vorgabe Europe/Berlin).
 */
export function fakeWeightRecorder(options: { timeZone?: TimeZone } = {}): WeightRecorder & { entries(): RecordManualWeight[] } {
  const timeZone = options.timeZone ?? TimeZone.parse('Europe/Berlin');
  const entries = new Map<string, RecordManualWeight>();
  return {
    recordManualWeight: async (input) => {
      entries.set(input.entryId, input);
      return { type: 'recorded', entryId: input.entryId, localDate: localDateAt(input.measuredAt, timeZone) };
    },
    entries: () => [...entries.values()],
  };
}

export function fakeIslandCheckInHintReader(hint: IslandCheckInHint = null): IslandCheckInHintReader {
  return { hint: async () => hint };
}

/**
 * Vollständige, geprüfte Ports für Tests: ohne Vorgabe leer (kein Plan, nie gewogen, keine
 * Aufnahme, kein Insel-Hinweis). Einzelne Ports lassen sich ersetzen.
 */
export function fakeAreaPorts(overrides: Partial<AreaPorts> = {}): AreaPorts {
  return checkAreaPorts({
    planReader: fakePlanReader(),
    weightTrendReader: fakeWeightTrendReader(),
    intakeReader: fakeIntakeReader(),
    weightRecorder: fakeWeightRecorder(),
    islandCheckInHintReader: null,
    ...overrides,
  });
}

function nextDay(localDate: LocalDate): LocalDate {
  return LocalDate.parse(new Date(Date.parse(`${localDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10));
}

function localDateAt(instant: string, timeZone: TimeZone): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    Date.parse(instant),
  );
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return LocalDate.parse(`${part('year')}-${part('month')}-${part('day')}`);
}
