import { EntityId, LocalDate } from '@abnehm/contracts/base';
import type { EffectivePlan, PlanReader } from '@abnehm/contracts/ports';
import { countedWaterMl, trackerStatus } from '@abnehm/contracts/tracker-rules';

import { LocalDatabaseClosedError, type ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { TodaySource, TodayState } from '../shell/today-registry';
import type { TrackerDependencies } from './trackers';
import { waterEntriesOfDay } from './water-repository';

// Beitrag `trackers.water` für „Heute“ (Spezifikation 3, Abschnitt 7): heute gezählte ml nach der
// Wasser-Zählregel und das Wasserziel der gültigen Zielversion aus dem `PlanReader`. Er liest bei
// jedem Commit der Kontodatenbank neu (`observe`) und auf Anstoß von `refresh`, damit „heute“ auch
// ohne neue Eingabe zum nächsten Tag wechselt.

/** Stößt erneutes Lesen ohne Datenbankänderung an; die Rückgabe beendet den Anstoß. */
export type Refresh = (update: () => void) => () => void;

type WaterDay = Readonly<{ personId: EntityId; localDate: LocalDate; countedMl: number }>;

const detailAction = { actionId: 'tracker.water.open', target: { type: 'capture.water' } } as const;
const quickAction = { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } } as const;

export function waterTodaySource(
  { database, clock }: Pick<TrackerDependencies, 'database' | 'clock'>,
  planReader: PlanReader,
  refresh: Refresh,
): TodaySource<'trackers.water'> {
  const readDay = (tx: ReadContext): WaterDay | null => {
    const person = readOwnPerson(tx);
    if (person === undefined) return null;
    const personId = EntityId.parse(person.id);
    const localDate = LocalDate.parse(clock.read().localDate);
    return { personId, localDate, countedMl: countedWaterMl(waterEntriesOfDay(tx, personId, localDate), localDate) };
  };

  return {
    subscribe(listener) {
      let latest = 0;
      let active = true;
      const publish = (day: WaterDay | null) => {
        const request = ++latest;
        const current = () => active && request === latest;
        // Ohne eigene Person (vor dem ersten Pull) lädt der Beitrag.
        if (day === null) return listener({ type: 'loading' });
        planReader.effectivePlan(day.personId, day.localDate).then(
          (plan) => current() && listener(stateOf(day, plan)),
          // Der Port hat seinen Vertrag verletzt (`PortContractError`) oder ist gescheitert.
          () => current() && listener({ type: 'error', code: 'invalid_payload' }),
        );
      };
      const stopObserving = database.observe(readDay, publish);
      const stopRefresh = refresh(() => {
        try {
          publish(database.read(readDay));
        } catch (error) {
          if (!(error instanceof LocalDatabaseClosedError)) throw error;
        }
      });
      return () => {
        active = false;
        stopObserving();
        stopRefresh();
      };
    },
  };
}

function stateOf(day: WaterDay, plan: EffectivePlan): TodayState<'trackers.water'> {
  if (plan.type === 'leer') return { type: 'empty', reasonKey: 'ohne_zielversion' };
  const targetMl = plan.goal.waterTargetMl;
  return {
    type: 'ready',
    data: { key: 'wasser', countedMl: day.countedMl, targetMl, status: trackerStatus(day.countedMl, targetMl), detailAction, quickAction },
  };
}
