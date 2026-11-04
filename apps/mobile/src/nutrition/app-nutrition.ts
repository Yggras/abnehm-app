import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { Nutrition } from './nutrition';

// Das Ernährungsmodul des geöffneten Kontos für die Bildschirme des Bereichs. Die App-Sitzung meldet es
// an, sobald eine Kontodatenbank offen ist (`src/session/device-session.ts`), und löst es beim Sperren
// wieder. Ohne geöffnetes Konto liefert `useNutrition` `null`; die Bildschirme zeigen dann ihr Skelett.

export const appNutrition = createOpenedModule<Nutrition>();

/** Das Ernährungsmodul des geöffneten Kontos; `null`, solange keines offen ist. */
export function useNutrition(): Nutrition | null {
  return useOpenedModule(appNutrition);
}
