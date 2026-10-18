import { is, type SQL } from 'drizzle-orm';
import { getTableConfig as pgConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig as sqliteConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core';

// Dialektneutrale Form eines Drizzle-Schemas, damit Postgres (Backend) und SQLite (App) vergleichbar
// sind: Spalten mit Nullbarkeit, Primärschlüssel, Unique-Keys (auch partielle), CHECKs als SQL und
// Fremdschlüssel. Beide Dialekte quoten Bezeichner mit `"`; dasselbe SQL ergibt denselben Text.

export type ForeignKeyShape = {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string;
  onUpdate: string;
};

export type TableShape = {
  name: string;
  columns: Record<string, { notNull: boolean; foreignTargets: string[] }>;
  primaryKey: string[];
  /** Name → Spalten und optionale Bedingung eines partiellen Unique-Index. */
  uniques: Record<string, string>;
  /** Name → SQL des CHECK. */
  checks: Record<string, string>;
  foreignKeys: ForeignKeyShape[];
};

export function postgresShape(module: Record<string, unknown>): TableShape[] {
  const dialect = new PgDialect();
  return Object.values(module)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => shape(pgConfig(table), (sql) => dialect.sqlToQuery(sql).sql));
}

/**
 * Das SQLite-Schema der App. Geladen über einen Pfad, damit die Typprüfung des Repos (Node, ESM)
 * nicht die App-Quellen mitprüft; die prüft `apps/mobile/tsconfig.json`.
 */
export async function loadSqliteSchema(): Promise<Record<string, unknown> & { partnerPersonColumns: readonly string[] }> {
  const path = new URL('../../apps/mobile/src/local-db/schema/index.ts', import.meta.url).href;
  return (await import(path)) as Record<string, unknown> & { partnerPersonColumns: readonly string[] };
}

export function sqliteShape(module: Record<string, unknown>): TableShape[] {
  const dialect = new SQLiteSyncDialect();
  return Object.values(module)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => shape(sqliteConfig(table), (sql) => dialect.sqlToQuery(sql).sql));
}

type AnyConfig = ReturnType<typeof pgConfig> | ReturnType<typeof sqliteConfig>;

function shape(config: AnyConfig, render: (sql: SQL) => string): TableShape {
  const foreignKeys: ForeignKeyShape[] = config.foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      foreignTable: tableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete ?? 'no action',
      onUpdate: foreignKey.onUpdate ?? 'no action',
    };
  });

  const columns: TableShape['columns'] = {};
  const uniques: TableShape['uniques'] = {};
  let primaryKey: string[] = [];
  for (const column of config.columns) {
    columns[column.name] = {
      notNull: column.notNull,
      foreignTargets: foreignKeys
        .filter((foreignKey) => foreignKey.columns.length === 1 && foreignKey.columns[0] === column.name)
        .map((foreignKey) => `${foreignKey.foreignTable}.${foreignKey.foreignColumns[0]}`),
    };
    if (column.primary) primaryKey = [column.name];
    if (column.isUnique && column.uniqueName) uniques[column.uniqueName] = column.name;
  }
  for (const key of config.primaryKeys) primaryKey = key.columns.map((column) => column.name);
  for (const unique of config.uniqueConstraints) uniques[unique.getName()!] = unique.columns.map((column) => column.name).join(', ');
  for (const index of config.indexes) {
    if (!index.config.unique) continue;
    const indexColumns = index.config.columns.map((column) => ('name' in column ? String(column.name) : render(column as SQL)));
    const where = index.config.where ? ` where ${render(index.config.where)}` : '';
    uniques[index.config.name!] = indexColumns.join(', ') + where;
  }
  const checks: TableShape['checks'] = {};
  for (const check of config.checks) checks[check.name] = render(check.value);

  return { name: config.name, columns, primaryKey, uniques, checks, foreignKeys };
}

function tableName(table: PgTable | SQLiteTable): string {
  return is(table, PgTable) ? pgConfig(table).name : sqliteConfig(table as SQLiteTable).name;
}
