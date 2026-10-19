import { TimeZone } from '@abnehm/contracts/base';

import type { ReadContext } from './context';
import type { LocalDatabase } from './local-database';
import { person } from './schema/accounts';
import { sqliteOf } from './sqlite';

/**
 * Die eigene Person der geöffneten Kontodatenbank; eine Kontodatenbank enthält nur sie. `undefined`,
 * bis sie mit dem ersten Pull nach dem Bootstrap ankommt.
 */
export function readOwnPerson(tx: ReadContext) {
  return sqliteOf(tx).select().from(person).limit(1).get();
}

/** Eigene Person für den Kopf von „Heute“; keine Abhängigkeit von Bereichstabellen. */
export function observePersonHeader(database: LocalDatabase, listener: (value: { displayName: string; timeZone: TimeZone } | null) => void) {
  return database.observe((tx) => {
    const row = readOwnPerson(tx);
    return row ? { displayName: row.displayName, timeZone: TimeZone.parse(row.timeZone) } : null;
  }, listener);
}
