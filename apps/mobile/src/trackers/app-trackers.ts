import { useEffect, useState } from 'react';

import { followSource } from '../shell/followed-source';
import { createOpenedModule, useOpenedModule, type OpenedModule } from '../shell/opened-module';
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
