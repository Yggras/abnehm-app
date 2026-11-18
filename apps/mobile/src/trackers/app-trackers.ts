import { useEffect, useState } from 'react';

import type { LocalDate } from '@abnehm/contracts/base';

import { followSource, type Source } from '../shell/followed-source';
import { createOpenedModule, useOpenedModule, type OpenedModule } from '../shell/opened-module';
import type { SportWeekState } from './sport-week';
import type { Trackers } from './trackers';
import type { WeightDetailState } from './weight-detail';

// Das Tracker-Modul des geöffneten Kontos für die Bildschirme des Bereichs. Die App-Sitzung meldet es
// je geöffneter Kontodatenbank mit `opened` an und löst es beim Sperren wieder
// (`src/session/device-session.ts`), wie die Handler der Quick-Command-Registry.

export type OpenedTrackers = OpenedModule<Trackers>;

export const appTrackers: OpenedTrackers = createOpenedModule<Trackers>();

/** Das Tracker-Modul des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useAppTrackers(): Trackers | null {
  return useOpenedModule(appTrackers);
}

/**
 * Lesemodell des Gewicht-Detailbildschirms für das geöffnete Konto; ohne geöffnetes Konto lädt es. Der
 * Composition Root meldet es mit dem `PlanReader` dieses Kontos an
 * (`appWeightDetail.opened(trackers.weightDetail(planReaderOf(database), appTodayRefresh))`).
 */
export const appWeightDetail = followSource<WeightDetailState>({ type: 'loading' });

/** Der jüngste Zustand des Gewicht-Detailbildschirms. */
export function useWeightDetail(): WeightDetailState {
  const [state, setState] = useState<WeightDetailState>({ type: 'loading' });
  useEffect(() => appWeightDetail.source.subscribe(setState), []);
  return state;
}

/** Die Wochen des Sport-Detailbildschirms: zu einem Tag (`null`: heute) die beobachtbare Woche. */
export type SportWeeks = (week: LocalDate | null) => Source<SportWeekState>;

/**
 * Lesemodell des Sport-Detailbildschirms für das geöffnete Konto. Der Composition Root meldet es mit dem
 * `PlanReader` dieses Kontos an
 * (`appSportWeeks.opened((week) => trackers.sportWeek(planReaderOf(database), appTodayRefresh, week))`).
 */
export const appSportWeeks = createOpenedModule<SportWeeks>();

/** Der jüngste Stand der Woche von `week` (`null`: die laufende); ohne geöffnetes Konto lädt sie. */
export function useSportWeek(week: LocalDate | null): SportWeekState {
  const weeks = useOpenedModule(appSportWeeks);
  // Der Stand gehört zum Lesemodell eines Kontos. Beim Blättern bleibt die bisherige Woche stehen, bis die
  // neue gelesen ist; ein anderes oder kein Konto zeigt nie den Stand des vorigen.
  const [latest, setLatest] = useState<Readonly<{ weeks: SportWeeks; state: SportWeekState }> | null>(null);
  useEffect(() => weeks?.(week).subscribe((state) => setLatest({ weeks, state })), [weeks, week]);
  return latest !== null && latest.weeks === weeks ? latest.state : { type: 'loading' };
}
