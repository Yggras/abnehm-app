import { z } from 'zod';

import { AreaKey, BausteinKey, EntityId, Instant, LocalDate, MessageKey, MessageValues, TimeZone } from './base.ts';
import { addDays } from './calendar.ts';
import { ContractError } from './errors.ts';
import { uuidV5 } from './ids.ts';
import { mealCategoryCount } from './units.ts';

// Baustein-Auswertung und Tages-Check-in (Spezifikation 0, Abschnitt 3). Mengen sind ganze Zahlen:
// Kalorien hier in ganzen kcal (Snapshot-Einheit), Wasser in ml, Sport in Minuten.

const count = z.int().nonnegative();
const positive = z.int().positive();
const minimumMealCategories = z.int().min(1).max(4);

/** Platz eines Tagesziels auf Momos drei Plätzen. */
export const DailyGoalSlot = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type DailyGoalSlot = z.infer<typeof DailyGoalSlot>;

const snapshotBase = {
  personId: EntityId,
  localDate: LocalDate,
  slot: DailyGoalSlot,
  timeZone: TimeZone,
  /** Beim Erzeugen festgeschriebener Beginn des Folgetags; Reisen verschieben ihn nicht. */
  dayEndsAt: Instant,
};

/** Bei der Materialisierung festgeschriebene Schwelle eines Tagesziels, je Baustein im Feld `type`. */
export const DailyGoalSnapshot = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ernaehrung_erfasst'), ...snapshotBase, minimumMealCategories }),
  z
    .strictObject({ type: z.literal('im_kalorienbudget'), ...snapshotBase, budgetKcal: positive, lowerBoundKcal: positive })
    .refine((snapshot) => snapshot.lowerBoundKcal <= snapshot.budgetKcal, {
      message: 'Kalorienbudget unter der Untergrenze',
      path: ['budgetKcal'],
    }),
  z.strictObject({ type: z.literal('wasserziel'), ...snapshotBase, targetMl: positive }),
  z.strictObject({ type: z.literal('sporteinheit'), ...snapshotBase, minimumSingleSessionMinutes: positive }),
  z.strictObject({ type: z.literal('gewogen'), ...snapshotBase }),
]);
export type DailyGoalSnapshot = z.infer<typeof DailyGoalSnapshot>;

export const DailyGoalState = z.enum(['offen', 'teilweise', 'erfuellt', 'tagesende']);
export type DailyGoalState = z.infer<typeof DailyGoalState>;

/** Fortschritt je Baustein (Feld `type`), zusammen mit der Schwelle aus dem Snapshot. */
export const DailyGoalProgress = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ernaehrung_erfasst'),
    recordedMealCategories: mealCategoryCount,
    minimumMealCategories,
  }),
  z
    .strictObject({ type: z.literal('im_kalorienbudget'), intakeKcal: count, budgetKcal: positive, lowerBoundKcal: positive })
    .refine((progress) => progress.lowerBoundKcal <= progress.budgetKcal, {
      message: 'Kalorienbudget unter der Untergrenze',
      path: ['budgetKcal'],
    }),
  z.strictObject({ type: z.literal('wasserziel'), countedMl: count, targetMl: positive }),
  z.strictObject({
    type: z.literal('sporteinheit'),
    longestSessionMinutes: count,
    minimumSingleSessionMinutes: positive,
  }),
  z.strictObject({ type: z.literal('gewogen'), weightEntryCount: count }),
]);
export type DailyGoalProgress = z.infer<typeof DailyGoalProgress>;

/** Der einzige Zustand, den die festen Regeln aus Abschnitt 3 zu diesem Fortschritt zulassen. */
function expectedState(progress: DailyGoalProgress, dayClosed: boolean): DailyGoalState {
  const graded = (value: number, threshold: number): DailyGoalState =>
    value === 0 ? 'offen' : value < threshold ? 'teilweise' : 'erfuellt';
  switch (progress.type) {
    case 'ernaehrung_erfasst':
      return graded(progress.recordedMealCategories, progress.minimumMealCategories);
    case 'wasserziel':
      return graded(progress.countedMl, progress.targetMl);
    case 'sporteinheit':
      return graded(progress.longestSessionMinutes, progress.minimumSingleSessionMinutes);
    case 'gewogen':
      return progress.weightEntryCount === 0 ? 'offen' : 'erfuellt';
    case 'im_kalorienbudget':
      if (!dayClosed) return 'tagesende';
      return progress.intakeKcal >= progress.lowerBoundKcal && progress.intakeKcal <= progress.budgetKcal
        ? 'erfuellt'
        : 'offen';
  }
}

const evaluationShape = {
  currentState: DailyGoalState,
  /** Wahr ab `dayEndsAt`; erst dann entscheidet sich „Im Kalorienbudget“. */
  dayClosed: z.boolean(),
  progress: DailyGoalProgress,
  messageKey: MessageKey,
  values: MessageValues,
};

function stateMatchesProgress(evaluation: {
  currentState: DailyGoalState;
  dayClosed: boolean;
  progress: DailyGoalProgress;
}): boolean {
  return evaluation.currentState === expectedState(evaluation.progress, evaluation.dayClosed);
}

const stateRule = { message: 'Zustand passt nicht zu Fortschritt und Tagesende', path: ['currentState'] };

/** Ergebnis eines Bereichsevaluators: aktueller Zustand, Fortschritt, Tagesende und Anzeigeaussage. */
export const BausteinEvaluation = z.strictObject(evaluationShape).refine(stateMatchesProgress, stateRule);
export type BausteinEvaluation = z.infer<typeof BausteinEvaluation>;

/** Fachlicher Schlüssel einer Tageszielerfüllung und ihrer Gutschrift: `tagesziel:<person>:<tag>:<platz>`. */
export function dailyGoalKey(personId: EntityId, localDate: LocalDate, slot: DailyGoalSlot): string {
  return `tagesziel:${personId}:${localDate}:${slot}`;
}

const completionNamespace = 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b60';

/** Deterministische ID der Tageszielerfüllung: Zwei Geräte erzeugen dieselbe Erfüllung mit derselben ID. */
export function dailyGoalCompletionId(completionKey: string): EntityId {
  return EntityId.parse(uuidV5(completionNamespace, completionKey));
}

/**
 * Unveränderliche Tageszielerfüllung, wie sie der Sync überträgt. Person, Tag, Platz und Baustein
 * stammen aus dem Tagesziel; Spezifikation 4 zählt darüber, ohne Tagesziele zu lesen.
 */
export const DailyGoalCompletionRecord = z
  .strictObject({
    id: EntityId,
    dailyGoalId: EntityId,
    personId: EntityId,
    localDate: LocalDate,
    slot: DailyGoalSlot,
    baustein: BausteinKey,
    firstCompletedAt: Instant,
    completionKey: z.string(),
    createdAt: Instant,
  })
  .refine((record) => record.completionKey === dailyGoalKey(record.personId, record.localDate, record.slot), {
    message: 'Schlüssel muss tagesziel:<person>:<tag>:<platz> sein',
    path: ['completionKey'],
  });
export type DailyGoalCompletionRecord = z.infer<typeof DailyGoalCompletionRecord>;

/** Ob das Tagesziel schon einmal dauerhaft erfüllt wurde; Korrekturen ändern daran nichts. */
export const DailyGoalCompletion = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('nie') }),
  z.strictObject({ type: z.literal('festgehalten'), firstCompletedAt: Instant }),
]);
export type DailyGoalCompletion = z.infer<typeof DailyGoalCompletion>;

/**
 * Vollständig ausgewertetes Tagesziel: Bereichsauswertung plus die vom Fundament gelesene Erfüllung.
 * „Im Kalorienbudget“ entscheidet sich erst am Tagesende, vorher kann es keine Erfüllung geben.
 */
export const DailyGoalEvaluated = z
  .strictObject({ type: z.literal('evaluated'), ...evaluationShape, completion: DailyGoalCompletion })
  .refine(stateMatchesProgress, stateRule)
  .refine(
    (evaluation) =>
      evaluation.completion.type === 'nie' || evaluation.progress.type !== 'im_kalorienbudget' || evaluation.dayClosed,
    { message: 'Erfüllung vor dem Tagesende', path: ['completion'] },
  );
export type DailyGoalEvaluated = z.infer<typeof DailyGoalEvaluated>;

/** Ergebnis von `evaluateDailyGoal`: Vertragsfehler oder vollständige Auswertung samt Erfüllung. */
export const DailyGoalEvaluation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('contract_error'), error: ContractError }),
  DailyGoalEvaluated,
]);
export type DailyGoalEvaluation = z.infer<typeof DailyGoalEvaluation>;

/** Auslöser einer erneuten Tagesziel-Auswertung (`reevaluateDailyGoals`). */
export const DailyGoalCause = z.enum([
  'eingabe',
  'rueckgaengig',
  'health_import',
  'pull',
  'app_oeffnung',
  'tagesabschluss',
  'planaenderung',
]);
export type DailyGoalCause = z.infer<typeof DailyGoalCause>;

/**
 * Tage, die eine neue oder ersetzte Ziel- bzw. Wochenplanversion betrifft: `max(validFrom, heute)` bis
 * heute + 13. Sie gehen mit `planaenderung` an `reevaluateDailyGoals`, lokal wie bei der Pull-Übernahme.
 */
export function planChangeDays(validFrom: LocalDate, today: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  const last = addDays(today, 13);
  for (let day: string = validFrom > today ? validFrom : today; day <= last; day = addDays(day, 1)) days.push(LocalDate.parse(day));
  return days;
}

/** Zeitpunkt eines Tages-Check-ins. */
export const CheckInMoment = z.enum(['mittag', 'abend']);
export type CheckInMoment = z.infer<typeof CheckInMoment>;

/** Was der Tracker an diesem Tag aufweist (Feld `type` = Tracker); nie Gewichts- oder Kalorienwerte. */
export const CheckInReason = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ernaehrung'), recordedMealCategories: mealCategoryCount }),
  z.strictObject({ type: z.literal('wasser'), countedMl: count, targetMl: positive }),
  z.strictObject({
    type: z.literal('sport'),
    sportDay: z.boolean(),
    hasCountingEntry: z.boolean(),
    /** Weicher Textschlüssel: Ein Training kann noch im Health-Import fehlen. */
    messageKey: MessageKey,
  }),
  z.strictObject({ type: z.literal('gewicht'), weighDay: z.boolean(), hasCountingEntry: z.boolean() }),
]);
export type CheckInReason = z.infer<typeof CheckInReason>;

/** Regeln aus „Reminder-Logik festlegen“ (#37), wiedergegeben in Spezifikation 0, Abschnitt 3. */
function isBehind(moment: CheckInMoment, reason: CheckInReason): boolean {
  switch (reason.type) {
    case 'ernaehrung':
      return reason.recordedMealCategories < (moment === 'mittag' ? 1 : 2);
    case 'wasser':
      return reason.countedMl * 3 < reason.targetMl * (moment === 'mittag' ? 1 : 2);
    case 'sport':
      return moment === 'abend' && reason.sportDay && !reason.hasCountingEntry;
    case 'gewicht':
      return reason.weighDay && !reason.hasCountingEntry;
  }
}

/** Ergebnis von `evaluateCheckIn`. Das Kalorienbudget ist kein Tracker und erinnert nie. */
export const CheckInEvaluation = z
  .strictObject({ tracker: AreaKey, moment: CheckInMoment, behind: z.boolean(), reason: CheckInReason })
  .refine((evaluation) => evaluation.reason.type === evaluation.tracker, {
    message: 'Grund gehört zu einem anderen Tracker',
    path: ['reason'],
  })
  .refine((evaluation) => evaluation.behind === isBehind(evaluation.moment, evaluation.reason), {
    message: '`behind` widerspricht den Check-in-Regeln',
    path: ['behind'],
  });
export type CheckInEvaluation = z.infer<typeof CheckInEvaluation>;
