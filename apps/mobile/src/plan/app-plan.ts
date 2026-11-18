import { useEffect, useState } from 'react';

import { followSource } from '../shell/followed-source';
import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { GoalSettingsState } from './goal-settings';
import type { Plan } from './plan';

// Das Plan-Modul des geöffneten Kontos für die Einstellungsseiten von Ziele & Onboarding (Spezifikation 1,
// Abschnitt 10). Die App-Sitzung meldet es je geöffneter Kontodatenbank an und löst es beim Sperren wieder
// (`src/session/device-session.ts`).

export const appPlan = createOpenedModule<Plan>();

/** Das Plan-Modul des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useAppPlan(): Plan | null {
  return useOpenedModule(appPlan);
}

/**
 * Lesemodell der Seite „Ziele“ für das geöffnete Konto; ohne geöffnetes Konto lädt es. Der Composition
 * Root meldet es mit dem `WeightTrendReader` des Tracker-Moduls an
 * (`appGoalSettings.opened(plan.goalSettings(trackers.weightTrendReader, appTodayRefresh))`).
 */
export const appGoalSettings = followSource<GoalSettingsState>({ type: 'loading' });

/** Der jüngste Zustand der Seite „Ziele“. */
export function useGoalSettings(): GoalSettingsState {
  const [state, setState] = useState<GoalSettingsState>({ type: 'loading' });
  useEffect(() => appGoalSettings.source.subscribe(setState), []);
  return state;
}
