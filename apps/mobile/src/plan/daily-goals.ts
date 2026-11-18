import { readingOf, startOfLocalDate, type Clock, type ClockReading } from '@abnehm/clock';
import { type EntityId, Instant, type LocalDate, localDateAfter } from '@abnehm/contracts/base';
import { dailyGoalId, dailyGoalsKey } from '@abnehm/contracts/daily-goals';
import { dailyGoalSnapshotsOf, MaterializeDailyGoals } from '@abnehm/contracts/plan';

import type { DailyGoalPersistence, MissingDaysHook } from '../daily-goals';
import type { TransactionContext } from '../local-db';
import type { SyncWriter } from '../sync';
import { hasDailyGoals, insertDailyGoals, materializedDays } from './daily-goal-repository';
import { readEffectivePlan, readWeeklyPlan } from './plan-repository';

// Materialisierung der Tagesziele und Anstoß des Tagesabschlusses (Spezifikation 1, Abschnitt 5). Ein
// Tag bekommt genau einmal drei Tagesziele aus den an ihm gültigen Fassungen, mit der aktuellen Zone des
// Geräts und dem Beginn des Folgetags in dieser Zone als Tagesende. Später ändert nichts mehr an ihnen:
// weder neue Ziele noch ein neuer Wochenplan noch eine Reise.

/**
 * Nachholfenster: heute und die sechs Tage davor, also die letzten 7 lokalen Tage (Designwert,
 * Spezifikation 1, Abschnitt 5). Ältere Tage bleiben ohne Tagesziele.
 */
export const catchUpDayCount = 7;

/** Die Tage des Nachholfensters bis `today`, aufsteigend. */
export function catchUpWindow(today: LocalDate): LocalDate[] {
  return Array.from({ length: catchUpDayCount }, (_, index) => localDateAfter(today, index - (catchUpDayCount - 1)));
}

export type DailyGoalMaterialization = Readonly<{
  /** Legt den Tag an, wenn er fehlt und an ihm beide Fassungen gelten; `true`, wenn er neu entstand. */
  materializeDay(tx: TransactionContext, personId: EntityId, localDate: LocalDate, reading: ClockReading): boolean;
  /**
   * Ein Auslöser: stellt heute und die fehlenden Tage des Nachholfensters sicher, wertet neu angelegte
   * offene Tage mit `app_oeffnung` aus und meldet jeden materialisierten Tag des Fensters, dessen
   * Tagesende erreicht ist, mit `tagesabschluss`. Wiederholt bleibt das folgenlos.
   */
  ensure(tx: TransactionContext, personId: EntityId): void;
  /** Haken für fehlende Tage am Persistenzdienst: Tage im Nachholfenster entstehen vor der Auswertung. */
  missingDaysHook: MissingDaysHook;
}>;

export function createDailyGoalMaterialization({
  clock,
  writer,
  persistence,
}: Readonly<{
  clock: Clock;
  writer: SyncWriter;
  persistence: Pick<DailyGoalPersistence, 'reevaluateDailyGoals'>;
}>): DailyGoalMaterialization {
  function materializeDay(tx: TransactionContext, personId: EntityId, localDate: LocalDate, reading: ClockReading): boolean {
    if (hasDailyGoals(tx, personId, localDate)) return false;
    // Fehlt eine der beiden Fassungen, liegt der Tag vor dem ersten `valid_from` und bleibt ohne Tagesziele.
    const plan = readEffectivePlan(tx, personId, localDate);
    if (!plan.success || plan.data.type === 'leer') return false;
    const weeklyPlan = readWeeklyPlan(tx, plan.data.weeklyPlanDay.weeklyPlanVersionId);
    if (weeklyPlan === undefined) return false;
    const dayStartsAt = startOfLocalDate(localDate, reading.timeZone);
    const snapshots = dailyGoalSnapshotsOf({
      personId,
      localDate,
      timeZone: reading.timeZone,
      dayEndsAt: startOfLocalDate(localDateAfter(localDate, 1), reading.timeZone),
      goal: plan.data.goal,
      days: weeklyPlan.days,
    });
    const payload = MaterializeDailyGoals.parse({
      localDate,
      goals: snapshots.map((snapshot) => ({ id: dailyGoalId(personId, localDate, snapshot.slot), snapshot })),
    });
    insertDailyGoals(tx, payload, { utcOffsetMinutes: readingOf(dayStartsAt, reading.timeZone).utcOffsetMinutes, createdAt: reading.instant });
    writer.command(tx, {
      type: 'materializeDailyGoals',
      businessKey: dailyGoalsKey(personId, localDate),
      payload,
      knownServerVersion: null,
      affectedRefs: payload.goals.map(({ id }) => ({ entityType: 'daily_goal', entityId: id })),
      referencePaths: [],
    });
    return true;
  }

  return {
    materializeDay,

    ensure(tx, personId) {
      const reading = clock.read();
      const at = Instant.parse(reading.instant);
      const window = catchUpWindow(reading.localDate);
      const created = window.filter((localDate) => materializeDay(tx, personId, localDate, reading));
      const days = materializedDays(tx, personId, window[0]!, reading.localDate);
      const closed = days.filter((day) => Date.parse(day.dayEndsAt) <= Date.parse(at)).map((day) => day.localDate);
      const opened = created.filter((localDate) => !closed.includes(localDate));
      if (opened.length > 0) persistence.reevaluateDailyGoals(tx, personId, opened, 'app_oeffnung');
      if (closed.length > 0) persistence.reevaluateDailyGoals(tx, personId, closed, 'tagesabschluss');
    },

    missingDaysHook(tx, { personId, localDates, today }) {
      const reading = clock.read();
      const window = new Set(catchUpWindow(today));
      for (const localDate of localDates) {
        if (window.has(localDate)) materializeDay(tx, personId, localDate, reading);
      }
    },
  };
}
