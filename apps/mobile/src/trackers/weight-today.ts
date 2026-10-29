import { EntityId, LocalDate, localDateAfter } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import { dayWeights, isWeighDay, type DayWeight } from '@abnehm/contracts/tracker-rules';
import type { TrackerWeightReady } from '@abnehm/contracts/today';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { TodaySource, TodayState } from '../shell/today-registry';
import { observedTodaySource, type Refresh } from './today-source';
import type { TrackerDependencies } from './trackers';
import { weightEntriesOf } from './weight-repository';

// Beitrag `trackers.weight` für „Heute“ (Spezifikation 3, Abschnitt 7): das letzte Tagesgewicht und
// der Stand des Wiegetags. Am Wiegetag ist er `wiegetag_offen` oder `gewogen`, sonst `kein_wiegetag`
// mit dem nächsten Wiegetag aus dem `PlanReader`, gesucht über die nächsten sieben Tage. Ohne Wiegetag
// in dieser Zeit bleibt nur „Eintragen“. Der Status ist immer neutral, nie `problem`. Den Trendwert ab
// drei Tagesgewichten ergänzt #176.

type WeightDay = Readonly<{ personId: EntityId; localDate: LocalDate; lastDayWeight: DayWeight | null }>;

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
    return { personId, localDate: LocalDate.parse(clock.read().localDate), lastDayWeight: dayWeights(weightEntriesOf(tx, personId)).at(-1) ?? null };
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
  const weighed = day.lastDayWeight?.localDate === day.localDate;
  const status: TrackerWeightReady['status'] = weighDay(today)
    ? { type: weighed ? 'gewogen' : 'wiegetag_offen' }
    : { type: 'kein_wiegetag', nextWeighDay: ahead.find(weighDay)?.localDate ?? null };
  const value = day.lastDayWeight === null ? null : { type: 'tagesgewicht' as const, weightG: day.lastDayWeight.weightG };
  return { type: 'ready', data: { key: 'gewicht', value, status, detailAction, quickAction } };
}

function weighDay(plan: EffectivePlan | undefined): boolean {
  return plan?.type === 'gueltig' && isWeighDay(plan.weeklyPlanDay.bausteine);
}
