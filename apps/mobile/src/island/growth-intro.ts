import type { Instant } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';

// „So wächst Momo“ (Spezifikation 4, Abschnitt 7; #184): Beim ersten Öffnen des Tabs „Momo“ nach dem
// Schlüpfen erscheint die Erklärung einmalig. Gemerkt wird das als lokales Einmal-Flag je Installation im
// Gerätezustand, ohne Sync; die Kontodatenbank samt Flag verschwindet beim Abmelden.

const key = 'momo_so_waechst_momo';

/** Ob die Erklärung auf dieser Installation schon erschienen ist. */
export function growthIntroShown(tx: ReadContext): boolean {
  return readDeviceState(tx, key) !== undefined;
}

/** Merkt, dass die Erklärung erschienen ist; ein zweites Mal ändert nichts. */
export function markGrowthIntroShown(tx: TransactionContext, at: Instant): void {
  if (!growthIntroShown(tx)) writeDeviceState(tx, key, { shownAt: at }, at);
}
