import { EntityId, LocalDate } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import { trackerStatus, weekMinutes } from '@abnehm/contracts/tracker-rules';

import type { ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { TodaySource, TodayState } from '../shell/today-registry';
import { sportEntriesOfWeek } from './sport-repository';
import { observedTodaySource, type Refresh } from './today-source';
import type { TrackerDependencies } from './trackers';

// Beitrag `trackers.sport` für „Heute“ (Spezifikation 3, Abschnitt 7): die Wochenminuten nach der
// Sport-Zählregel (Montag bis Sonntag, maßgeblich der gespeicherte lokale Tag) und das Sportwochenziel
// der gültigen Zielversion von heute aus dem `PlanReader`. Der Status ist immer neutral, nie `problem`.

type SportWeek = Readonly<{ personId: EntityId; localDate: LocalDate; weekMinutes: number }>;

const detailAction = { actionId: 'tracker.sport.open', target: { type: 'capture.sport' } } as const;
const quickAction = { type: 'navigate', intent: { actionId: 'tracker.sport.add', target: { type: 'capture.sport', newEntry: true } } } as const;

export function sportTodaySource(
  { database, clock }: Pick<TrackerDependencies, 'database' | 'clock'>,
  planReader: PlanReader,
  refresh: Refresh,
): TodaySource<'trackers.sport'> {
  const readWeek = (tx: ReadContext): SportWeek | null => {
    const person = readOwnPerson(tx);
    if (person === undefined) return null;
    const personId = EntityId.parse(person.id);
    const localDate = LocalDate.parse(clock.read().localDate);
    return { personId, localDate, weekMinutes: weekMinutes(sportEntriesOfWeek(tx, personId, localDate), localDate) };
  };
  return observedTodaySource(database, refresh, readWeek, async (week) => stateOf(week, await planReader.effectivePlan(week.personId, week.localDate)));
}

function stateOf(week: SportWeek, plan: EffectivePlan): TodayState<'trackers.sport'> {
  if (plan.type === 'leer') return { type: 'empty', reasonKey: 'ohne_zielversion' };
  const weeklyTargetMinutes = plan.goal.weeklySportTargetMinutes;
  return {
    type: 'ready',
    data: { key: 'sport', weekMinutes: week.weekMinutes, weeklyTargetMinutes, status: trackerStatus(week.weekMinutes, weeklyTargetMinutes), detailAction, quickAction },
  };
}
