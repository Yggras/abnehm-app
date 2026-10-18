import { TimeZone } from '@abnehm/contracts/base';

import type { LocalDatabase } from './local-database';
import { person } from './schema/accounts';
import { sqliteOf } from './sqlite';

/** Eigene Person für den Kopf von „Heute“; keine Abhängigkeit von Bereichstabellen. */
export function observePersonHeader(database: LocalDatabase, listener: (value: { displayName: string; timeZone: TimeZone } | null) => void) {
  return database.observe((tx) => {
    const row = sqliteOf(tx).select({ displayName: person.displayName, timeZone: person.timeZone }).from(person).limit(1).get();
    return row ? { displayName: row.displayName, timeZone: TimeZone.parse(row.timeZone) } : null;
  }, listener);
}
