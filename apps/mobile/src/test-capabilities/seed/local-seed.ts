import { eq, getTableColumns, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { SyncCursor } from '@abnehm/contracts/base';
import { canonicalRows, type SeedDeviceState, type SeedManifest, type SeedRow, type SeedValue } from '@abnehm/contracts/seeds';

import type { LocalDatabase, ReadContext } from '../../local-db';
import * as schema from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { syncCursorScope } from '../../sync/engine';
import { appendOperation, pendingOperations } from '../../sync/outbox';

// Seeder für die lokale Kontodatenbank (Spezifikation 0, Abschnitt 12; #112). Er setzt die
// Datenbank einer Installation in einer Transaktion auf den Ausgangszustand des Manifests zurück:
// alle Tabellen leeren, Fachzeilen einfügen, Pull-Cursor und offene Operationen herstellen. So
// ergibt wiederholtes Seeden exakt denselben kanonischen Stand. Nur im Development Build und in Tests.

const tables = (Object.values(schema) as unknown[]).filter((value): value is SQLiteTable => is(value, SQLiteTable));
const byName = new Map(tables.map((table) => [getTableConfig(table).name, table]));
/** Cursor und Outbox stehen im Manifest in eigener, typisierter Form. */
const syncTables = ['sync_cursor', 'outbox'];

/** Tabellen so geordnet, dass jede nach den Tabellen kommt, auf die ihre Fremdschlüssel zeigen. */
const insertOrder: readonly string[] = (() => {
  const ordered: string[] = [];
  const visit = (name: string, path: readonly string[]) => {
    if (ordered.includes(name) || path.includes(name)) return;
    for (const foreignKey of getTableConfig(byName.get(name)!).foreignKeys) {
      const target = getTableConfig(foreignKey.reference().foreignTable).name;
      if (target !== name) visit(target, [...path, name]);
    }
    ordered.push(name);
  };
  for (const name of [...byName.keys()].sort()) visit(name, []);
  return ordered;
})();

/** Setzt die geöffnete Kontodatenbank auf den Ausgangszustand der Installation im Manifest. */
export function seedLocalDatabase(database: LocalDatabase, manifest: SeedManifest, installation: string): void {
  const state = manifest.initial.devices[installation];
  if (state === undefined) throw new Error(`Seed: Szenario ${manifest.scenario} kennt keine Installation ${installation}`);
  for (const table of Object.keys(state.rows)) {
    if (!byName.has(table) || syncTables.includes(table)) throw new Error(`Seed: unbekannte Tabelle ${table}`);
  }
  database.transaction((tx) => {
    const db = sqliteOf(tx);
    for (const name of [...insertOrder].reverse()) db.delete(byName.get(name)!).run();
    for (const name of insertOrder) {
      const table = byName.get(name)!;
      for (const row of state.rows[name] ?? []) db.insert(table).values(toDatabase(table, row)).run();
    }
    if (state.cursor !== null) {
      db.insert(schema.syncCursor).values({ scope: syncCursorScope, cursor: state.cursor, pageToken: null, updatedAt: manifest.clock.instant }).run();
    }
    for (const operation of state.outbox) appendOperation(tx, operation);
  });
}

/** Kanonischer Stand der Kontodatenbank, vergleichbar mit einem Gerätezustand des Manifests. */
export function dumpLocalDatabase(database: LocalDatabase): SeedDeviceState {
  return database.read((tx) => {
    const db = sqliteOf(tx);
    const rows: Record<string, SeedRow[]> = {};
    for (const [name, table] of byName) {
      if (syncTables.includes(name)) continue;
      rows[name] = (db.select().from(table).all() as Record<string, unknown>[]).map((row) => toCanonical(table, row));
    }
    return { rows: canonicalRows(rows), cursor: readCursor(tx), outbox: pendingOperations(tx, Number.MAX_SAFE_INTEGER) };
  });
}

/** Ein Gerätezustand des Manifests in derselben kanonischen Form wie `dumpLocalDatabase`. */
export function canonicalDevice(state: SeedDeviceState): SeedDeviceState {
  return { ...state, rows: canonicalRows(state.rows) };
}

function readCursor(tx: ReadContext): SyncCursor | null {
  const row = sqliteOf(tx).select().from(schema.syncCursor).where(eq(schema.syncCursor.scope, syncCursorScope)).get();
  return row?.cursor == null ? null : SyncCursor.parse(row.cursor);
}

function columnsOf(table: SQLiteTable): Map<string, string> {
  return new Map(Object.entries(getTableColumns(table)).map(([key, column]) => [(column as AnySQLiteColumn).name, key]));
}

function toDatabase(table: SQLiteTable, row: SeedRow): Record<string, unknown> {
  const columns = columnsOf(table);
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    const key = columns.get(name);
    if (key === undefined) throw new Error(`Seed: unbekannte Spalte ${getTableConfig(table).name}.${name}`);
    values[key] = value;
  }
  return values;
}

function toCanonical(table: SQLiteTable, row: Record<string, unknown>): SeedRow {
  const canonical: SeedRow = {};
  for (const [name, key] of columnsOf(table)) canonical[name] = row[key] as SeedValue;
  return canonical;
}
