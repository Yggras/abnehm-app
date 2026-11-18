import { createOpenedModule, useOpenedModule, type OpenedModule } from '../shell/opened-module';
import type { HealthImport } from './health-import';

// Der Health-Import-Dienst des geöffneten Kontos, etwa für Onboarding-Schritt `health` (#189) und die
// Einstellungsseite Health (#190). Die App-Sitzung meldet ihn je geöffneter Kontodatenbank mit `opened` an
// und löst ihn beim Sperren wieder (`src/session/device-session.ts`), wie das Tracker-Modul.

export const appHealthImport: OpenedModule<HealthImport> = createOpenedModule<HealthImport>();

/** Der Health-Import des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useAppHealthImport(): HealthImport | null {
  return useOpenedModule(appHealthImport);
}
