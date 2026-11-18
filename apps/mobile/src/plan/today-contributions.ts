import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, type BausteinKey } from '@abnehm/contracts/base';
import { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import type { ContractErrorCode } from '@abnehm/contracts/errors';
import type { RouteTarget, UiActionIntent } from '@abnehm/contracts/routes';
import type { MomoDailyGoalsReady, NutritionBudgetReady } from '@abnehm/contracts/today';

import type { DailyGoalRegistry } from '../daily-goals';
import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Refresh } from '../shell/followed-source';
import type { TodaySlot, TodaySource, TodayState } from '../shell/today-registry';
import { dailyGoalSnapshotsOn } from './daily-goal-repository';
import { readEffectivePlan } from './plan-repository';

// „Heute“-Beiträge des Plan-Moduls (Spezifikation 1, Abschnitt 6): `momo.daily_goals` mit den drei
// ausgewerteten Tageszielen des Tags und `nutrition.budget` mit Kalorienbudget, Haltemodus und höchstens
// einem Hinweis. Beide lesen nur lokales SQLite und sind daher nie `stale`: bei jedem Commit der
// Kontodatenbank und auf Anstoß von `refresh` neu, damit „heute“ ohne neue Eingabe zum nächsten Tag
// wechselt und „Im Kalorienbudget“ sich ab dem Tagesende entscheidet.

type BudgetNotice = NonNullable<NutritionBudgetReady['notice']>;

/** Liest einen Hinweis der Ernährungskarte für Person und Tag; `null` ohne Hinweis. */
export type BudgetNoticeReader<T extends BudgetNotice['type']> = (
  tx: ReadContext,
  personId: EntityId,
  localDate: LocalDate,
) => Extract<BudgetNotice, { type: T }> | null;

/**
 * Die beiden Hinweise der Ernährungskarte. Höchstens einer erscheint, „Zielgewicht erreicht“ geht vor.
 * Ihre Leser liefern die Tickets „Zielgewicht erreicht“ (#152) und „Budgetvorschlag: Prüfung und
 * Hinweis“ (#150); bis dahin gibt es keinen Hinweis.
 */
export type BudgetNoticeReaders = Readonly<{
  goalWeightReached: BudgetNoticeReader<'goal_weight_reached'>;
  budgetSuggestion: BudgetNoticeReader<'budget_suggestion'>;
}>;

const noBudgetNotices: BudgetNoticeReaders = { goalWeightReached: () => null, budgetSuggestion: () => null };

export type PlanTodayDependencies = Readonly<{
  database: Pick<LocalDatabase, 'observe' | 'read'>;
  /** Lokaler Tag und Auswertungszeitpunkt. */
  clock: Clock;
  /** Baustein-Auswertung des Fundaments; dieselbe Registry wie im Persistenzdienst der Tagesziele. */
  dailyGoals: Pick<DailyGoalRegistry, 'evaluateDailyGoal'>;
}>;

export type PlanToday = Readonly<{
  /** Beitrag `momo.daily_goals`. */
  dailyGoals(refresh: Refresh): TodaySource<'momo.daily_goals'>;
  /** Beitrag `nutrition.budget`. */
  budget(refresh: Refresh): TodaySource<'nutrition.budget'>;
}>;

/** Aktion „Erneut versuchen“: Die Shell liest den Beitrag auf „Heute“ neu. */
const retryAction: UiActionIntent = { actionId: 'today.retry', target: { type: 'today' } };

/** Bereich eines Bausteins: Ernährung und Kalorienbudget im Protokoll, sonst die Erfassung des Trackers. */
const areaOf: Readonly<Record<BausteinKey, RouteTarget>> = {
  ernaehrung_erfasst: { type: 'log' },
  im_kalorienbudget: { type: 'log' },
  wasserziel: { type: 'capture.water' },
  sporteinheit: { type: 'capture.sport' },
  gewogen: { type: 'capture.weight' },
};

/** Leer-Grund ohne gültige Ziel- und Wochenplanversion, wie bei den Mini-Trackern (Spezifikation 3, Abschnitt 7). */
const withoutPlan = { type: 'empty', reasonKey: 'ohne_zielversion' } as const;

/** Die „Heute“-Beiträge über der Datenbank eines Kontos; `notices` ergänzen #150 und #152. */
export function createPlanToday({ database, clock, dailyGoals }: PlanTodayDependencies, notices: BudgetNoticeReaders = noBudgetNotices): PlanToday {
  return {
    dailyGoals: (refresh) => observedToday(database, refresh, (tx) => {
      const day = ownDay(tx, clock);
      if (day === null) return { type: 'loading' };
      const stored = dailyGoalSnapshotsOn(tx, day.personId, day.localDate);
      // Ohne gültigen Plan entsteht der Tag nie; mit Plan legt ihn der nächste Auslöser an.
      if (stored.length === 0) {
        const plan = readEffectivePlan(tx, day.personId, day.localDate);
        if (!plan.success) return failed('invalid_payload');
        return plan.data.type === 'leer' ? withoutPlan : { type: 'loading' };
      }
      const snapshots = stored.map((snapshot) => DailyGoalSnapshot.safeParse(snapshot));
      if (snapshots.length !== 3) return failed('invalid_payload');
      const goals = [];
      for (const snapshot of snapshots) {
        if (!snapshot.success) return failed('invalid_snapshot');
        const evaluation = dailyGoals.evaluateDailyGoal(tx, snapshot.data, day.at);
        if (evaluation.type === 'contract_error') return failed(evaluation.error.code);
        goals.push({ slot: snapshot.data.slot, evaluation, action: { actionId: 'tagesziel.open_area', target: areaOf[snapshot.data.type] } });
      }
      return { type: 'ready', data: goals as MomoDailyGoalsReady };
    }),

    budget: (refresh) => observedToday(database, refresh, (tx) => {
      const day = ownDay(tx, clock);
      if (day === null) return { type: 'loading' };
      const plan = readEffectivePlan(tx, day.personId, day.localDate);
      if (!plan.success) return failed('invalid_payload');
      const snapshot = dailyGoalSnapshotsOn(tx, day.personId, day.localDate)
        .map((stored) => DailyGoalSnapshot.safeParse(stored))
        .find((parsed) => parsed.success && parsed.data.type === 'im_kalorienbudget');
      if (snapshot?.success === false) return failed('invalid_snapshot');
      const fromSnapshot = snapshot?.data.type === 'im_kalorienbudget' ? snapshot.data.budgetKcal : null;
      if (plan.data.type === 'leer' && fromSnapshot === null) return withoutPlan;
      // Wie der Snapshot (`dailyGoalSnapshotsOf`): ganze kcal, abgerundet.
      const budgetKcal = fromSnapshot ?? (plan.data.type === 'gueltig' ? Math.floor(plan.data.goal.calorieBudgetMilliKcal / 1_000) : 0);
      const notice = notices.goalWeightReached(tx, day.personId, day.localDate) ?? notices.budgetSuggestion(tx, day.personId, day.localDate);
      return {
        type: 'ready',
        data: {
          budgetKcal,
          maintenanceReason: plan.data.type === 'gueltig' ? plan.data.goal.maintenanceReason : null,
          ...(notice === null ? {} : { notice }),
        },
      };
    }),
  };
}

/** Eigene Person, lokaler Tag und Zeitpunkt aus einer Ablesung der Uhr; `null` ohne eigene Person. */
function ownDay(tx: ReadContext, clock: Clock): { personId: EntityId; localDate: LocalDate; at: Instant } | null {
  const own = readOwnPerson(tx);
  if (own === undefined) return null;
  const reading = clock.read();
  return { personId: EntityId.parse(own.id), localDate: LocalDate.parse(reading.localDate), at: Instant.parse(reading.instant) };
}

function failed(code: ContractErrorCode) {
  return { type: 'error', code, retryAction } as const;
}

/** Liest in einer Lesetransaktion sofort, nach jedem Commit und auf Anstoß von `refresh` neu. */
function observedToday<K extends TodaySlot>(
  database: Pick<LocalDatabase, 'observe' | 'read'>,
  refresh: Refresh,
  read: (tx: ReadContext) => TodayState<K>,
): TodaySource<K> {
  return {
    subscribe(listener) {
      const stopObserving = database.observe(read, listener);
      const stopRefresh = refresh(() => {
        let state: TodayState<K>;
        try {
          state = database.read(read);
        } catch (error) {
          // Das Konto wurde gesperrt; die App-Sitzung löst den Beitrag gleich.
          if (error instanceof LocalDatabaseClosedError) return;
          throw error;
        }
        listener(state);
      });
      return () => {
        stopObserving();
        stopRefresh();
      };
    },
  };
}
