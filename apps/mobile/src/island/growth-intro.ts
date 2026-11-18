import type { Instant } from '@abnehm/contracts/base';

import type { TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';

// „So wächst Momo“ (Spezifikation 4, Abschnitt 7; #184): Beim ersten Öffnen des Tabs „Momo“ nach dem
// Schlüpfen erscheint die Erklärung einmalig. Gemerkt wird das als lokales Einmal-Flag je Installation im
// Gerätezustand (`device_state`), ohne Sync. Dort führt die App ihre Einmal-Flags (`local-db/schema/device.ts`)
// und auch die Installationskennung des Syncs (`sync/device-metadata.ts`): Eine Installation lebt mit der
// Kontodatenbank und endet beim Abmelden. Nach einer neuen Anmeldung erscheint die Erklärung deshalb wieder.

const key = 'momo_so_waechst_momo';

/**
 * Ob die Erklärung jetzt erscheinen soll: genau beim ersten Aufruf je Installation `true`. Prüfen und
 * Merken laufen in einer Transaktion, damit sie nie zweimal erscheint.
 */
export function takeGrowthIntro(tx: TransactionContext, at: Instant): boolean {
  if (readDeviceState(tx, key) !== undefined) return false;
  writeDeviceState(tx, key, { shownAt: at }, at);
  return true;
}
