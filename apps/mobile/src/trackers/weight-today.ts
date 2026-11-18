import { EntityId, LocalDate, localDateAfter } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import { isWeighDay, showsTrend } from '@abnehm/contracts/tracker-rules';
import type { TrackerWeightReady } from '@abnehm/contracts/today';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { TodaySource, TodayState } from '../shell/today-registry';
import { observedTodaySource, type Refresh } from './today-source';
import type { TrackerDependencies } from './trackers';
import { trendPointsOf } from './weight-trend-reader';

// Beitrag `trackers.weight` für „Heute“ (Spezifikation 3, Abschnitt 7): ab drei Tagesgewichten der
// Trendwert, vorher das letzte Tagesgewicht (#176), und der Stand des Wiegetags. Am Wiegetag ist er `wiegetag_offen` oder `gewogen`, sonst `kein_wiegetag`
// mit dem nächsten Wiegetag aus dem `PlanReader`, gesucht über die nächsten sieben Tage. Ohne Wiegetag
// in dieser Zeit bleibt nur „Eintragen“. Der Status ist immer neutral, nie `problem`.

type WeightDay = Readonly<{
  personId: EntityId;
  localDate: LocalDate;
  /** Tag des letzten Tagesgewichts; `null` ohne Gewichtseintrag. */
  lastWeighedOn: LocalDate | null;
  value: TrackerWeightReady['value'];
}>;

/** So weit sucht der Mini-Tracker nach dem nächsten Wiegetag. */
const searchDays = 7;

const detailAction = { actionId: 'tracker.weight.open', target: { type: 'capture.weight' } } as const;
const quickAction = { type: 'navigate', intent: { actionId: 'tracker.weight.add', target: { type: 'capture.weight', newEntry: true } } } as const;

export function weightTodaySource(
  { database, clock }: Pick<TrackerDependencies, 'database' | 'clock'>,
  planReader: PlanReader,
  refresh: Refresh,
): TodaySource<'trackers.weight'> {
  const readDay = (tx: ReadContext): WeightDay | null => {
    const person = readOwnPerson(tx);
    if (person === undefined) return null;
    const personId = EntityId.parse(person.id);
    const points = trendPointsOf(tx, personId);
    const last = points.at(-1);
    const value: TrackerWeightReady['value'] =
      last === undefined ? null : showsTrend(points.length) ? { type: 'trend', weightG: last.trendG } : { type: 'tagesgewicht', weightG: last.dayWeightG };
    return { personId, localDate: clock.read().localDate, lastWeighedOn: last === undefined ? null : LocalDate.parse(last.localDate), value };
  };
  return observedTodaySource(database, refresh, readDay, async (day) => {
    // Heute und die sieben Tage danach; der Plan kann sich dazwischen mit einer neuen Fassung ändern.
    const plans = await Promise.all(
      Array.from({ length: searchDays + 1 }, (_, offset) => planReader.effectivePlan(day.personId, localDateAfter(day.localDate, offset))),
    );
    return stateOf(day, plans);
  });
}

function stateOf(day: WeightDay, [today, ...ahead]: EffectivePlan[]): TodayState<'trackers.weight'> {
  const weighed = day.lastWeighedOn === day.localDate;
  const status: TrackerWeightReady['status'] = isWeighDayPlan(today)
    ? { type: weighed ? 'gewogen' : 'wiegetag_offen' }
    : { type: 'kein_wiegetag', nextWeighDay: ahead.find(isWeighDayPlan)?.localDate ?? null };
  return { type: 'ready', data: { key: 'gewicht', value: day.value, status, detailAction, quickAction } };
}

function isWeighDayPlan(plan: EffectivePlan | undefined): boolean {
  return plan?.type === 'gueltig' && isWeighDay(plan.weeklyPlanDay.bausteine);
}
