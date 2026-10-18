import { describe, expect, it } from 'vitest';

import * as postgres from '../apps/backend/src/db/schema/index.ts';
import { loadSqliteSchema, postgresShape, sqliteShape } from './support/schema-shape.ts';

const sqlite = await loadSqliteSchema();

// Personenbezug in eigenen Spalten, nie nur in JSON, und E-Mail nur am Konto (Spezifikation 0,
// Abschnitt 9). Eine spätere Kontolöschung findet so alle Daten einer Person; eine spätere
// E-Mail-Änderung betrifft nur die Better-Auth-Tabellen.

/** Konto-, Personen- oder Kopplungsreferenz als eigene Spalte. */
const referenceColumn = /^(?:account_id|coupling_id|person_id|[a-z_]+_person_id|person_(?:low|high)_id)$/;

/** Tabellen ohne Personenbezug, jeweils mit Grund. */
const withoutPersonReference: Record<string, string> = {
  sync_clock: 'eine technische Zählerzeile ohne Personendaten',
  off_cache: 'Produktdaten von Open Food Facts',
  outbox: 'Gerätedaten in der Datenbankdatei genau eines Kontos',
  sync_cursor: 'Gerätedaten in der Datenbankdatei genau eines Kontos',
  device_state: 'Gerätedaten in der Datenbankdatei genau eines Kontos',
};

/** Better-Auth-Tabellen (Auth-Modul); nur sie dürfen eine E-Mail führen. */
const betterAuthTables = ['user', 'account', 'session', 'verification'];

describe.each([
  ['Postgres', postgresShape(postgres)],
  ['SQLite', sqliteShape(sqlite)],
])('%s-Schema', (_dialect, tables) => {
  it.each(tables.map((table) => [table.name, table] as const))('%s führt den Personenbezug in einer eigenen Spalte', (name, table) => {
    const references = Object.keys(table.columns).filter((column) => referenceColumn.test(column));
    if (name in withoutPersonReference) {
      expect(references, `${name}: ${withoutPersonReference[name]}`).toEqual([]);
    } else {
      expect(references.length, `${name} braucht eine Konto-, Personen- oder Kopplungsspalte`).toBeGreaterThan(0);
    }
  });

  it('hat außerhalb der Better-Auth-Tabellen keine E-Mail-Spalte', () => {
    const emailColumns = tables
      .filter((table) => !betterAuthTables.includes(table.name))
      .flatMap((table) => Object.keys(table.columns).map((column) => `${table.name}.${column}`))
      .filter((column) => /e_?mail/i.test(column));
    expect(emailColumns).toEqual([]);
  });
});
