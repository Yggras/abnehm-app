import { z } from 'zod';

import { BausteinKey, EntityId, Instant, LocalDate } from './base.ts';
import { addDays } from './calendar.ts';
import { ContractError } from './errors.ts';
import { IslandEventKind } from './island.ts';
import { bodyWeightG, mealCategoryCount } from './units.ts';

// Ports zwischen Bereichen (Spezifikation 0, Abschnitt 3). Kein Bereich liest oder schreibt dafür
// die Tabellen eines anderen. Lese-Ports laufen in einer Lesetransaktion; alle Rückgaben sind
// Zod-validiert und verwenden die Einheiten aus Abschnitt 8: g, `milli_kcal`, ml, min.

const milliKcal = z.int().positive();
const weightG = bodyWeightG;

/** Haltemodus: `null` oder sein Grund. */
export const MaintenanceReason = z.enum(['sicherheits_check', 'gewaehlt']);
export type MaintenanceReason = z.infer<typeof MaintenanceReason>;

/** Tempo: die gewählte Abnehmgeschwindigkeit, ausgedrückt als tägliches Defizit. */
export const Pace = z.enum(['entspannt', 'zuegiger']);
export type Pace = z.infer<typeof Pace>;

/** Gültige Zielversion eines Tags. Im Haltemodus gibt es kein Tempo, sonst immer eines. */
const GoalVersion = z
  .strictObject({
    id: EntityId,
    validFrom: LocalDate,
    calorieBudgetMilliKcal: milliKcal,
    lowerBoundMilliKcal: milliKcal,
    maintenanceReason: MaintenanceReason.nullable(),
    pace: Pace.nullable(),
    goalWeightG: weightG,
    waterTargetMl: z.int().positive(),
    weeklySportTargetMinutes: z.int().positive(),
  })
  .refine((goal) => goal.lowerBoundMilliKcal <= goal.calorieBudgetMilliKcal, {
    message: 'Kalorienbudget unter der Untergrenze',
    path: ['calorieBudgetMilliKcal'],
  })
  .refine((goal) => (goal.maintenanceReason === null) === (goal.pace !== null), {
    message: 'Tempo gibt es genau ohne Haltemodus',
    path: ['pace'],
  });

/** Wochenplantag: drei verschiedene Bausteine auf den Plätzen 1–3. */
const WeeklyPlanDay = z
  .strictObject({
    weeklyPlanVersionId: EntityId,
    validFrom: LocalDate,
    bausteine: z.tuple([BausteinKey, BausteinKey, BausteinKey]),
  })
  .refine((day) => new Set(day.bausteine).size === 3, {
    message: 'Drei verschiedene Bausteine',
    path: ['bausteine'],
  });

/** `PlanReader.effectivePlan(personId, localDate)`: geltende Fassungen des Tags oder ausdrücklich leer. */
export const EffectivePlan = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('leer'), localDate: LocalDate }),
  z
    .strictObject({ type: z.literal('gueltig'), localDate: LocalDate, goal: GoalVersion, weeklyPlanDay: WeeklyPlanDay })
    .refine((plan) => plan.goal.validFrom <= plan.localDate && plan.weeklyPlanDay.validFrom <= plan.localDate, {
      message: 'Fassung gilt erst später',
    }),
]);
export type EffectivePlan = z.infer<typeof EffectivePlan>;

/** Lieferant: Spezifikation 1, in SQLite und Postgres. */
export interface PlanReader {
  effectivePlan(personId: EntityId, localDate: LocalDate): Promise<EffectivePlan>;
}

/** Aufsteigend, je Tag höchstens einmal. */
function ascendingDays(days: readonly { localDate: string }[]) {
  return days.every((day, index) => index === 0 || (days[index - 1] as { localDate: string }).localDate < day.localDate);
}

/** `WeightTrendReader.series`: je Tag mit Tagesgewicht dessen Wert und der Trend danach. */
export const WeightTrendSeries = z
  .array(z.strictObject({ localDate: LocalDate, dayWeightG: weightG, trendG: weightG }))
  .refine(ascendingDays, { message: 'Tage aufsteigend und eindeutig' });
export type WeightTrendSeries = z.infer<typeof WeightTrendSeries>;

/** `WeightTrendReader.latest`: Trend erst ab drei Tagesgewichten. */
export const LatestWeight = z
  .strictObject({
    lastDayWeight: z.strictObject({ localDate: LocalDate, dayWeightG: weightG }).nullable(),
    dayWeightCount: z.int().nonnegative(),
    trend: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('verfuegbar'), trendG: weightG }),
      z.strictObject({ type: z.literal('noch_nicht_verfuegbar') }),
    ]),
  })
  .refine((latest) => (latest.dayWeightCount === 0) === (latest.lastDayWeight === null), {
    message: 'Letztes Tagesgewicht genau dann, wenn es Tagesgewichte gibt',
    path: ['lastDayWeight'],
  })
  .refine((latest) => (latest.dayWeightCount >= 3) === (latest.trend.type === 'verfuegbar'), {
    message: 'Trend genau ab drei Tagesgewichten',
    path: ['trend'],
  });
export type LatestWeight = z.infer<typeof LatestWeight>;

/** Lieferant: Spezifikation 3, in SQLite. */
export interface WeightTrendReader {
  series(personId: EntityId, from: LocalDate, to: LocalDate): Promise<WeightTrendSeries>;
  latest(personId: EntityId): Promise<LatestWeight>;
}

/** `IntakeReader.dailyIntake`: lückenlos jeder Tag des Bereichs, Tage ohne Einträge mit 0. */
export const DailyIntakeSeries = z
  .array(
    z.strictObject({
      localDate: LocalDate,
      intakeMilliKcal: z.int().nonnegative(),
      recordedMealCategories: mealCategoryCount,
    }),
  )
  .refine(
    (days) => days.every((day, index) => index === 0 || addDays((days[index - 1] as typeof day).localDate, 1) === day.localDate),
    { message: 'Jeder Tag genau einmal, aufsteigend und ohne Lücke' },
  );
export type DailyIntakeSeries = z.infer<typeof DailyIntakeSeries>;

/** Lieferant: Spezifikation 2, in SQLite. */
export interface IntakeReader {
  dailyIntake(personId: EntityId, from: LocalDate, to: LocalDate): Promise<DailyIntakeSeries>;
}

/** Manueller Gewichtseintrag: 20,0–350,0 kg in 100-g-Schritten (Spezifikation 3, Abschnitt 3). */
export const RecordManualWeight = z.strictObject({
  entryId: EntityId,
  personId: EntityId,
  weightG: weightG.multipleOf(100),
  measuredAt: Instant,
});
export type RecordManualWeight = z.infer<typeof RecordManualWeight>;

export const RecordManualWeightResult = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('recorded'), entryId: EntityId, localDate: LocalDate }),
  z.strictObject({ type: z.literal('contract_error'), error: ContractError }),
]);
export type RecordManualWeightResult = z.infer<typeof RecordManualWeightResult>;

/**
 * Lieferant: Spezifikation 3. Legt in eigener lokaler Transaktion einen gewöhnlichen manuellen
 * Gewichtseintrag samt Outbox und Tagesmeldung an; ein erneuter Aufruf mit derselben `entryId`
 * aktualisiert, statt zu verdoppeln.
 */
export interface WeightRecorder {
  recordManualWeight(input: RecordManualWeight): Promise<RecordManualWeightResult>;
}

/** Insel-Hinweis für Tages-Check-ins: `null`, solange der Punkt am Tab „Momo“ aus ist. */
export const IslandCheckInHint = z
  .strictObject({
    type: z.literal('neues_insel_ereignis'),
    eventKind: IslandEventKind,
  })
  .nullable();
export type IslandCheckInHint = z.infer<typeof IslandCheckInHint>;

/** Lieferant: Spezifikation 4, optional; ohne registrierten Reader entfällt der Zusatz. */
export interface IslandCheckInHintReader {
  hint(personId: EntityId, at: Instant): Promise<IslandCheckInHint>;
}
