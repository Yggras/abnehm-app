import { useEffect, useState } from 'react';

import { createOpenedModule, useOpenedModule, type OpenedModule } from '../shell/opened-module';
import type { ObservedSource } from './today-source';
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
 * Lesemodell des Gewicht-Detailbildschirms für das geöffnete Konto. Der Composition Root meldet es mit
 * dem `PlanReader` dieses Kontos an (`trackers.weightDetail(planReaderOf(database), appTodayRefresh)`).
 */
export const appWeightDetail = createOpenedModule<ObservedSource<WeightDetailState>>();

/** Der jüngste Zustand des Gewicht-Detailbildschirms; lädt, solange kein Konto geöffnet ist. */
export function useWeightDetail(): WeightDetailState {
  const source = useOpenedModule(appWeightDetail);
  const [state, setState] = useState<{ source: ObservedSource<WeightDetailState>; value: WeightDetailState } | null>(null);
  useEffect(() => source?.subscribe((value) => setState({ source, value })), [source]);
  return state !== null && state.source === source ? state.value : { type: 'loading' };
}
