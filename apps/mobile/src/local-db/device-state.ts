import { eq } from 'drizzle-orm';

import type { Instant } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from './context';
import { deviceState } from './schema';
import { sqliteOf } from './sqlite';

// Gerätezustand je Schlüssel (`device_state`, Spezifikation 0, Abschnitt 8): nicht synchronisiert und
// beim Abmelden mit der Kontodatenbank gelöscht. Den Wert prüft das Modul, dem der Schlüssel gehört; hier
// steht nur der Zugriff, damit Bereiche weder Drizzle noch die Tabelle sehen.

/** Der gespeicherte Wert zum Schlüssel, ungeprüft; `undefined`, wenn es keinen gibt. */
export function readDeviceState(tx: ReadContext, key: string): unknown {
  return sqliteOf(tx).select({ value: deviceState.value }).from(deviceState).where(eq(deviceState.key, key)).get()?.value;
}

/** Legt den Wert zum Schlüssel an oder ersetzt ihn, in der Transaktion des Aufrufers. */
export function writeDeviceState(tx: TransactionContext, key: string, value: unknown, at: Instant): void {
  sqliteOf(tx)
    .insert(deviceState)
    .values({ key, value, updatedAt: at })
    .onConflictDoUpdate({ target: deviceState.key, set: { value, updatedAt: at } })
    .run();
}
