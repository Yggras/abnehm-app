import { createOpenedModule, useOpenedModule, type OpenedModule } from '../shell/opened-module';
import type { Trackers } from './trackers';

// Das Tracker-Modul des geöffneten Kontos für die Bildschirme des Bereichs. Die App-Sitzung meldet es
// je geöffneter Kontodatenbank mit `opened` an und löst es beim Sperren wieder
// (`src/session/device-session.ts`), wie die Handler der Quick-Command-Registry.

export type OpenedTrackers = OpenedModule<Trackers>;

export const appTrackers: OpenedTrackers = createOpenedModule<Trackers>();

/** Das Tracker-Modul des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useAppTrackers(): Trackers | null {
  return useOpenedModule(appTrackers);
}
