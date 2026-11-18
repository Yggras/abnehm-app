import { z } from 'zod';

import { BausteinKey, EntityId, Instant, LocalDate, TimeZone, Weekday, weekdayOf } from './base.ts';
import { dailyGoalId, DailyGoalSnapshot } from './daily-goals.ts';
import { calculateGoals, sportSessionThreshold, type GoalCalculation, type GoalCalculatorInput } from './goal-calculator.ts';
import { uuidV5 } from './ids.ts';
import { ActivityLevel, CalculationSex } from './person.ts';
import { EffectivePlan, MaintenanceReason, Pace } from './ports.ts';

// Ziel- und Wochenplanversionen (Spezifikation 1, Abschnitte 4 und 11; Spezifikation 0, Abschnitte 8
// und 10). Beide sind immer vollständig, nie ein Teil-Patch, und reisen über die Fachbefehle
// `createGoalVersion` und `createWeeklyPlanVersion`. Natürlicher Schlüssel ist Person + `valid_from`;
// die ID leiten App und Server daraus ab, sodass eine weitere Fassung mit demselben `valid_from`
// dieselbe Zeile ersetzt.

/** Woher das Kalorienbudget stammt: Zielrechner, Eingabe der Person oder angenommener Budgetvorschlag. */
export const BudgetSource = z.enum(['berechnet', 'manuell', 'budgetvorschlag']);
export type BudgetSource = z.infer<typeof BudgetSource>;

/** Ganze kcal als `milli_kcal`; so speichert eine neue Zielversion ihre Kalorienwerte (Abschnitt 3). */
const wholeKcal = z.int().positive().multipleOf(1_000);

const goalVersionFields = {
  validFrom: LocalDate,
  calorieBudgetMilliKcal: wholeKcal,
  basalMetabolicRateMilliKcal: wholeKcal,
  totalEnergyExpenditureMilliKcal: wholeKcal,
  lowerBoundMilliKcal: wholeKcal,
  /** Defizit des Tempos; im Haltemodus `null`. */
  deficitMilliKcal: wholeKcal.nullable(),
  budgetSource: BudgetSource,
  calculationSex: CalculationSex,
  /** Alter in vollen Jahren am Berechnungstag. */
  ageYears: z.int().min(18),
  heightCm: z.int().positive(),
  /** Aktuelles Gewicht der Berechnung. */
  weightG: z.int().positive(),
  activityLevel: ActivityLevel,
  maintenanceReason: MaintenanceReason.nullable(),
  pace: Pace.nullable(),
  goalWeightG: z.int().positive(),
  waterTargetMl: z.int().positive(),
  weeklySportTargetMinutes: z.int().positive(),
};

type GoalVersionValues = z.output<z.ZodObject<typeof goalVersionFields>>;

/**
 * Eingaben des Zielrechners, aus denen die Zielversion stammt. Ob ein Sicherheitsgrund vorliegt, steht
 * nicht in ihr; der erzwungene Haltemodus gilt als Angabe der Person. Untergewicht erkennt der Rechner
 * selbst, eine Zielversion ohne erzwungenen Haltemodus bei BMI < 18,5 ist daher unstimmig.
 */
function calculatorInputOf(version: GoalVersionValues): GoalCalculatorInput {
  return {
    calculationDate: version.validFrom,
    calculationSex: version.calculationSex,
    ageYears: version.ageYears,
    heightCm: version.heightCm,
    weightG: version.weightG,
    weightTrendG: null,
    activityLevel: version.activityLevel,
    pregnantOrBreastfeeding: version.maintenanceReason === 'sicherheits_check',
    knownEatingDisorder: false,
    goalWeightG: version.goalWeightG,
    pace: version.pace,
    manualBudgetKcal: version.budgetSource === 'manuell' ? version.calorieBudgetMilliKcal / 1_000 : null,
    waterTargetMl: version.waterTargetMl,
    weeklySportTargetMinutes: version.weeklySportTargetMinutes,
  };
}

/**
 * Was an einer Zielversion nicht stimmt: verletzte Eingabegrenzen als Fehlerschlüssel des Zielrechners,
 * sonst jeder Berechnungswert, der sich nicht aus den mitgelieferten Eingaben ergibt. Das Budget eines
 * Budgetvorschlags liegt zwischen Untergrenze und Gesamtumsatz, auch außerhalb des 10-kcal-Rasters.
 */
function goalVersionProblems(version: GoalVersionValues): string[] {
  const input = calculatorInputOf(version);
  const calculation = calculateGoals(input);
  if (calculation.type === 'ungueltig') return calculation.errors;
  const expected = goalVersionOf({ validFrom: version.validFrom, input, calculation });
  const problems = (Object.keys(goalVersionFields) as (keyof GoalVersionValues)[])
    .filter((key) => key !== 'calorieBudgetMilliKcal' && key !== 'budgetSource' && expected[key] !== version[key])
    .map((key) => `Berechnungswert passt nicht: ${key}`);
  const budget = version.calorieBudgetMilliKcal;
  if (version.budgetSource === 'budgetvorschlag') {
    if (budget < expected.lowerBoundMilliKcal || budget > expected.totalEnergyExpenditureMilliKcal) {
      problems.push('Budgetvorschlag außerhalb von Untergrenze und Gesamtumsatz');
    }
  } else if (budget !== expected.calorieBudgetMilliKcal) {
    problems.push('Berechnungswert passt nicht: calorieBudgetMilliKcal');
  }
  return problems;
}

/**
 * Nutzlast von `createGoalVersion`: die vollständige Zielversion ohne Person und Serverfelder. Gültig
 * ist sie nur, wenn Grundumsatz, Gesamtumsatz, Untergrenze, Defizit, Haltemodus und Budget sich über
 * den Zielrechner aus den mitgelieferten Eingaben ergeben und die Grenzen aus Abschnitt 3 halten.
 */
export const CreateGoalVersion = z.strictObject(goalVersionFields).superRefine((version, context) => {
  for (const message of goalVersionProblems(version)) context.addIssue({ code: 'custom', message, input: version });
});
export type CreateGoalVersion = z.infer<typeof CreateGoalVersion>;

/**
 * Zielversion zu einer Berechnung des Zielrechners, gültig ab `validFrom`. Das Budget stammt aus der
 * Berechnung, also berechnet oder manuell.
 */
export function goalVersionOf({
  validFrom,
  input,
  calculation,
}: Readonly<{ validFrom: LocalDate; input: GoalCalculatorInput; calculation: GoalCalculation }>): CreateGoalVersion {
  return {
    validFrom,
    calorieBudgetMilliKcal: calculation.calorieBudget.milliKcal,
    basalMetabolicRateMilliKcal: calculation.basalMetabolicRate.milliKcal,
    totalEnergyExpenditureMilliKcal: calculation.totalEnergyExpenditure.milliKcal,
    lowerBoundMilliKcal: calculation.lowerBound.milliKcal,
    deficitMilliKcal: calculation.deficit?.milliKcal ?? null,
    budgetSource: calculation.budgetSource,
    calculationSex: input.calculationSex,
    ageYears: input.ageYears,
    heightCm: input.heightCm,
    weightG: input.weightG,
    activityLevel: input.activityLevel,
    maintenanceReason: calculation.maintenanceReason,
    pace: calculation.pace,
    goalWeightG: calculation.goalWeight.goalWeightG,
    waterTargetMl: calculation.water.targetMl,
    weeklySportTargetMinutes: calculation.sport.weeklyTargetMinutes,
  };
}

const storedKcal = z.int().positive();

/**
 * Kanonische Zielversion im Sync. Der Server ist maßgeblich; geprüft werden hier nur die Regeln der
 * Datenbank (Tempo genau ohne Haltemodus, Defizit genau mit Tempo, Budget nicht unter der Untergrenze).
 */
export const GoalVersionRecord = z
  .strictObject({
    ...goalVersionFields,
    calorieBudgetMilliKcal: storedKcal,
    basalMetabolicRateMilliKcal: storedKcal,
    totalEnergyExpenditureMilliKcal: storedKcal,
    lowerBoundMilliKcal: storedKcal,
    deficitMilliKcal: storedKcal.nullable(),
    personId: EntityId,
    createdAt: Instant,
    updatedAt: Instant,
  })
  .refine((goal) => (goal.maintenanceReason === null) === (goal.pace !== null), { message: 'Tempo gibt es genau ohne Haltemodus', path: ['pace'] })
  .refine((goal) => (goal.deficitMilliKcal === null) === (goal.pace === null), { message: 'Defizit gibt es genau mit Tempo', path: ['deficitMilliKcal'] })
  .refine((goal) => goal.lowerBoundMilliKcal <= goal.calorieBudgetMilliKcal, {
    message: 'Kalorienbudget unter der Untergrenze',
    path: ['calorieBudgetMilliKcal'],
  });
export type GoalVersionRecord = z.infer<typeof GoalVersionRecord>;

/** Drei verschiedene Bausteine auf den Plätzen 1–3 eines Wochentags. */
const DayBausteine = z
  .tuple([BausteinKey, BausteinKey, BausteinKey])
  .refine((bausteine) => new Set(bausteine).size === 3, { message: 'Drei verschiedene Bausteine' });

/** Alle sieben Wochentage, jeder mit drei verschiedenen, geordneten Bausteinen. */
export const WeeklyPlanDays = z.record(Weekday, DayBausteine);
export type WeeklyPlanDays = z.infer<typeof WeeklyPlanDays>;

/** Ein Wochentag einer Wochenplanversion, wie ihn beide Datenbanken speichern. */
export type WeeklyPlanDayRow = Readonly<{ weekday: string; baustein1: string; baustein2: string; baustein3: string }>;

/** Die sieben Tageszeilen einer Wochenplanversion als geprüfte `WeeklyPlanDays`. */
export function weeklyPlanDaysOf(rows: readonly WeeklyPlanDayRow[]): WeeklyPlanDays {
  return WeeklyPlanDays.parse(Object.fromEntries(rows.map((row) => [row.weekday, [row.baustein1, row.baustein2, row.baustein3]])));
}

/** Nutzlast von `createWeeklyPlanVersion`: die vollständige Wochenplanversion ohne Person und Serverfelder. */
export const CreateWeeklyPlanVersion = z.strictObject({ validFrom: LocalDate, days: WeeklyPlanDays });
export type CreateWeeklyPlanVersion = z.infer<typeof CreateWeeklyPlanVersion>;

/** Kanonische Wochenplanversion im Sync. */
export const WeeklyPlanVersionRecord = z.strictObject({
  validFrom: LocalDate,
  days: WeeklyPlanDays,
  personId: EntityId,
  createdAt: Instant,
  updatedAt: Instant,
});
export type WeeklyPlanVersionRecord = z.infer<typeof WeeklyPlanVersionRecord>;

/**
 * Was ein `PlanReader` für einen Tag gelesen hat: die Zielversion und die Wochenplanversion mit dem
 * größten `valid_from` ≤ Tag, von dieser die Zeile zum Wochentag des Tags. SQLite und Postgres lesen
 * je in ihrem Dialekt; die Abbildung auf `EffectivePlan` ist dieselbe.
 */
export type EffectivePlanRows = Readonly<{
  goal:
    | Readonly<{
        id: string;
        validFrom: string;
        calorieBudgetMilliKcal: number;
        lowerBoundMilliKcal: number;
        maintenanceReason: string | null;
        pace: string | null;
        goalWeightG: number;
        waterTargetMl: number;
        weeklySportTargetMinutes: number;
      }>
    | undefined;
  weeklyPlan: Readonly<{ id: string; validFrom: string }> | undefined;
  day: WeeklyPlanDayRow | undefined;
}>;

/**
 * Gültiger Plan eines Tags, geprüft gegen `EffectivePlan`; fehlt eine der beiden Fassungen, ist er leer.
 * Das Ergebnis der Prüfung geht an den Aufrufer: Die App meldet einen Verstoß als `PortContractError`
 * wie jeden Port, der Server wirft ihn.
 */
export function effectivePlanOf(localDate: LocalDate, { goal, weeklyPlan, day }: EffectivePlanRows): ReturnType<typeof EffectivePlan.safeParse> {
  if (goal === undefined || weeklyPlan === undefined) return EffectivePlan.safeParse({ type: 'leer', localDate });
  return EffectivePlan.safeParse({
    type: 'gueltig',
    localDate,
    goal: {
      id: goal.id,
      validFrom: goal.validFrom,
      calorieBudgetMilliKcal: goal.calorieBudgetMilliKcal,
      lowerBoundMilliKcal: goal.lowerBoundMilliKcal,
      maintenanceReason: goal.maintenanceReason,
      pace: goal.pace,
      goalWeightG: goal.goalWeightG,
      waterTargetMl: goal.waterTargetMl,
      weeklySportTargetMinutes: goal.weeklySportTargetMinutes,
    },
    weeklyPlanDay: {
      weeklyPlanVersionId: weeklyPlan.id,
      validFrom: weeklyPlan.validFrom,
      bausteine: day === undefined ? undefined : [day.baustein1, day.baustein2, day.baustein3],
    },
  });
}

/** Schwelle von „Ernährung erfasst“: zwei Mahlzeitenkategorien (Spezifikation 1, Abschnitt 5; #13, #14). */
export const minimumMealCategoriesPerDay = 2;

/** Was die Snapshots eines Tags aus der an diesem Tag gültigen Zielversion brauchen. */
export type DailyGoalTargets = Readonly<{
  calorieBudgetMilliKcal: number;
  lowerBoundMilliKcal: number;
  waterTargetMl: number;
  weeklySportTargetMinutes: number;
}>;

/**
 * Die drei Snapshots eines Tags nach Platz (Spezifikation 1, Abschnitt 5): Bausteine aus dem Wochentag
 * der gültigen Wochenplanversion, Schwellen aus der gültigen Zielversion, die Schwelle der Sporteinheit
 * aus dem Sportwochenziel und den Sporttagen dieser Wochenplanversion. Kalorien stehen im Snapshot in
 * ganzen kcal. Eine neue Zielversion speichert ohnehin ganze kcal (`wholeKcal`); einen Rest schneidet die
 * Umrechnung ab, für Budget und Untergrenze gleich, damit die Untergrenze nie über das Budget steigt.
 * App und Server bilden die Snapshots mit dieser einen Funktion.
 */
export function dailyGoalSnapshotsOf({
  personId,
  localDate,
  timeZone,
  dayEndsAt,
  goal,
  days,
}: Readonly<{
  personId: EntityId;
  localDate: LocalDate;
  timeZone: TimeZone;
  /** Beginn des Folgetags in `timeZone`. */
  dayEndsAt: Instant;
  goal: DailyGoalTargets;
  /** Alle sieben Tage der gültigen Wochenplanversion; ihre Sporttage bestimmen die Schwelle der Sporteinheit. */
  days: WeeklyPlanDays;
}>): [DailyGoalSnapshot, DailyGoalSnapshot, DailyGoalSnapshot] {
  const sportDayCount = Weekday.options.filter((weekday) => days[weekday].includes('sporteinheit')).length;
  const snapshotOf = (baustein: BausteinKey, index: number): DailyGoalSnapshot => {
    const base = { personId, localDate, slot: index + 1, timeZone, dayEndsAt };
    switch (baustein) {
      case 'ernaehrung_erfasst':
        return DailyGoalSnapshot.parse({ type: baustein, ...base, minimumMealCategories: minimumMealCategoriesPerDay });
      case 'im_kalorienbudget':
        return DailyGoalSnapshot.parse({
          type: baustein,
          ...base,
          budgetKcal: Math.floor(goal.calorieBudgetMilliKcal / 1_000),
          lowerBoundKcal: Math.floor(goal.lowerBoundMilliKcal / 1_000),
        });
      case 'wasserziel':
        return DailyGoalSnapshot.parse({ type: baustein, ...base, targetMl: goal.waterTargetMl });
      case 'sporteinheit':
        // Der Tag ist selbst ein Sporttag, also gibt es mindestens einen und damit eine Schwelle.
        return DailyGoalSnapshot.parse({
          type: baustein,
          ...base,
          minimumSingleSessionMinutes: sportSessionThreshold(goal.weeklySportTargetMinutes, sportDayCount),
        });
      case 'gewogen':
        return DailyGoalSnapshot.parse({ type: baustein, ...base });
    }
  };
  const [first, second, third] = days[weekdayOf(localDate)];
  return [snapshotOf(first, 0), snapshotOf(second, 1), snapshotOf(third, 2)];
}

/** Ein Tagesziel in `materializeDailyGoals`: seine deterministische ID und der festgeschriebene Snapshot. */
const MaterializedDailyGoal = z.strictObject({ id: EntityId, snapshot: DailyGoalSnapshot });

/**
 * Nutzlast von `materializeDailyGoals` (Spezifikation 1, Abschnitt 5): genau die drei Tagesziele eines
 * Tags auf den Plätzen 1–3, mit drei verschiedenen Bausteinen, derselben Person, Zone und demselben
 * Tagesende und den IDs aus Person, Tag und Platz. Ob die Snapshots zum Plan passen, prüft der Server
 * gegen seine Fassungen (#133).
 */
export const MaterializeDailyGoals = z
  .strictObject({ localDate: LocalDate, goals: z.tuple([MaterializedDailyGoal, MaterializedDailyGoal, MaterializedDailyGoal]) })
  .superRefine(({ localDate, goals }, context) => {
    const [first] = goals;
    goals.forEach(({ id, snapshot }, index) => {
      const issue = (message: string, field: string) => context.addIssue({ code: 'custom', message, path: ['goals', index, field] });
      if (snapshot.slot !== index + 1) issue('Plätze 1–3 in Reihenfolge', 'snapshot');
      if (snapshot.localDate !== localDate) issue('Snapshot eines anderen Tags', 'snapshot');
      if (snapshot.personId !== first.snapshot.personId || snapshot.timeZone !== first.snapshot.timeZone || snapshot.dayEndsAt !== first.snapshot.dayEndsAt) {
        issue('Person, Zone und Tagesende gelten für alle drei', 'snapshot');
      }
      if (id !== dailyGoalId(snapshot.personId, localDate, snapshot.slot)) issue('ID folgt aus Person, Tag und Platz', 'id');
    });
    if (new Set(goals.map(({ snapshot }) => snapshot.type)).size !== 3) {
      context.addIssue({ code: 'custom', message: 'Drei verschiedene Bausteine', path: ['goals'] });
    }
  });
export type MaterializeDailyGoals = z.infer<typeof MaterializeDailyGoals>;

/** Art einer Fassung im fachlichen Schlüssel. */
export type PlanVersionKind = 'zielversion' | 'wochenplan';

const versionNamespaces: Record<PlanVersionKind, string> = {
  zielversion: 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b63',
  wochenplan: 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b64',
};

/** Deterministische ID einer Fassung aus Art, Person und `valid_from`; zwei Geräte meinen dieselbe Fassung. */
export function planVersionId(kind: PlanVersionKind, personId: EntityId, validFrom: LocalDate): EntityId {
  return EntityId.parse(uuidV5(versionNamespaces[kind], `${kind}:${personId}:${validFrom}`));
}

/** ID der Zielversion einer Person ab `validFrom`. */
export const goalVersionId = (personId: EntityId, validFrom: LocalDate) => planVersionId('zielversion', personId, validFrom);

/** ID der Wochenplanversion einer Person ab `validFrom`. */
export const weeklyPlanVersionId = (personId: EntityId, validFrom: LocalDate) => planVersionId('wochenplan', personId, validFrom);

/**
 * Fachlicher Schlüssel von `createGoalVersion` (`zielversion`) bzw. `createWeeklyPlanVersion`
 * (`wochenplan`): Person, `valid_from` und eine je Änderung neue ID. Ein fester Schlüssel je Fassung ließe
 * eine spätere Änderung mit demselben `valid_from` als `operation_conflict` enden; so ersetzt sie die
 * noch nicht wirksame Fassung.
 */
export function planVersionKey(kind: PlanVersionKind, personId: EntityId, validFrom: LocalDate, changeId: EntityId): string {
  return `${kind}:${personId}:${validFrom}:${changeId}`;
}

const keyPattern = /^(zielversion|wochenplan):([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):([0-9a-f-]{36})$/;

/** Person, `valid_from` und ID der Fassung eines Schlüssels dieser Art; `null` bei jeder anderen Form. */
export function planVersionOfKey(kind: PlanVersionKind, key: string): { id: EntityId; personId: EntityId; validFrom: LocalDate } | null {
  const match = keyPattern.exec(key);
  if (match === null || match[1] !== kind) return null;
  const personId = EntityId.safeParse(match[2]);
  const validFrom = LocalDate.safeParse(match[3]);
  if (!personId.success || !validFrom.success || !EntityId.safeParse(match[4]).success) return null;
  return { id: planVersionId(kind, personId.data, validFrom.data), personId: personId.data, validFrom: validFrom.data };
}
