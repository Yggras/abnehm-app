import { hashPassword } from 'better-auth/crypto';
import { getTableColumns, is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { EntityId } from '@abnehm/contracts/base';
import {
  authTables,
  canonicalRows,
  dependencyOrder,
  uncouplingRequestOf,
  type SeedManifest,
  type SeedRow,
  type SeedRows,
  type SeedValue,
} from '@abnehm/contracts/seeds';

import type { Backend } from '../../src/backend.ts';
import type { Database, DbExecutor } from '../../src/database.ts';
import * as schema from '../../src/db/schema/index.ts';
import { seedPhotoFiles } from './photo-seed.ts';

// Seeder für Postgres (Spezifikation 0, Abschnitt 12; #112). Nur im Development-Backend und in Tests.
//
// Seed-Strategie: Seeden setzt die ganze Datenbank in einer Transaktion auf den Ausgangszustand des
// Manifests zurück (TRUNCATE aller Tabellen des Schemas, dann Einfügen). TRUNCATE löst die
// Zeilen-Trigger der unveränderlichen Entitäten nicht aus. So ergibt jedes Seeden für Fach- und
// Sync-Daten exakt denselben kanonischen Stand. Konten entstehen aus `accounts`: Konto mit fester ID
// und gesalzenem Passwort-Hash, keine Sitzung. Sitzung und Sicherheitslog-Eintrag entstehen erst bei
// der Anmeldung danach. Der kanonische Vergleich umfasst deshalb Fach- und Sync-Daten, also alle
// Tabellen außer den Better-Auth-Tabellen (Konten prüft der Test semantisch: ID, E-Mail, Hash passt
// zum Testpasswort), dem Sicherheitslog (betriebliches Protokoll, das jede Anmeldung schreibt) und den
// Projektions-Invalidierungen (Arbeitswarteschlange des Projektionsmechanismus mit zufälligen IDs, die
// jede Push-Annahme eines Tracker-Eintrags schreibt, #181). Seeden leert alle drei.

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
const byName = new Map(tables.map((table) => [getTableConfig(table).name, table]));
/** Nicht Teil des kanonischen Vergleichs; siehe Seed-Strategie oben. */
const notCanonical: readonly string[] = [...authTables, 'security_log', 'projection_invalidation'];
const authTableNames: readonly string[] = authTables;

const insertOrder = dependencyOrder(
  [...byName].map(([name, table]) => ({
    name,
    references: getTableConfig(table).foreignKeys.map((foreignKey) => getTableConfig(foreignKey.reference().foreignTable).name),
  })),
);

/** Setzt Postgres auf den Ausgangszustand des Manifests. Scheitert eine Prüfung, bleibt nichts zurück. */
export async function seedServer(database: Database, manifest: SeedManifest): Promise<void> {
  const rows = manifest.initial.server;
  for (const table of Object.keys(rows)) {
    if (!byName.has(table)) throw new Error(`Seed: unbekannte Tabelle ${table}`);
  }
  if (rows.sync_clock?.length !== 1) throw new Error('Seed: das Manifest muss die Sync-Clock setzen');
  if (rows.security_log !== undefined) throw new Error('Seed: das Sicherheitslog entsteht nur im Betrieb');
  if (rows.projection_invalidation !== undefined) throw new Error('Seed: Projektions-Invalidierungen entstehen nur im Betrieb');
  // Hashen dauert; es läuft vor der Transaktion.
  const accounts = await Promise.all(manifest.accounts.map(async (account) => ({ ...account, hash: await hashPassword(account.password) })));
  const at = new Date(manifest.clock.instant);

  await database.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE TABLE ${[...byName.keys()].map((name) => `"${name}"`).join(', ')} RESTART IDENTITY CASCADE`));
    for (const account of accounts) {
      await tx.insert(schema.user).values({ id: account.accountId, name: '', email: account.email, emailVerified: false, createdAt: at, updatedAt: at });
      // Bei `credential` ist die Anbieterkennung die Konto-ID selbst (wie bei der Registrierung).
      await tx.insert(schema.account).values({
        id: account.accountId,
        accountId: account.accountId,
        providerId: 'credential',
        userId: account.accountId,
        password: account.hash,
        createdAt: at,
        updatedAt: at,
      });
    }
    for (const name of insertOrder) {
      const tableRows = rows[name];
      if (tableRows === undefined || tableRows.length === 0) continue;
      const table = byName.get(name)!;
      await tx.insert(table).values(tableRows.map((row) => toDatabase(table, row)));
    }
    const withEmail = await tablesWithEmail(tx);
    if (withEmail.length > 0) throw new Error(`Seed: E-Mail außerhalb der Better-Auth-Tabellen in ${withEmail.join(', ')}`);
  });
}

/**
 * Seed der Development-Abläufe (Seed-Route und Seed-Kommando, #117): Ausgangszustand herstellen, samt
 * Bilddaten in der Fotoablage (#162), dann die Serverschritte des Manifests ausführen. `entkoppeln` läuft
 * über den Entkopplungs-Kern (#107), der Widerruf ist also echt. Die Geräte starten im Ausgangszustand und
 * holen die Schritte mit ihrem Sync nach.
 */
export async function seedScenario(
  database: Database,
  { uncoupling, photoStorage }: Pick<Backend, 'uncoupling' | 'photoStorage'>,
  manifest: SeedManifest,
): Promise<void> {
  await seedServer(database, manifest);
  await seedPhotoFiles(photoStorage, manifest);
  for (const step of manifest.steps) {
    if (step.type !== 'entkoppeln') continue;
    const request = uncouplingRequestOf(step, manifest.accounts);
    const result = await database.db.transaction((tx) =>
      uncoupling.uncouple(tx, {
        actionId: EntityId.parse(request.actionId),
        couplingId: EntityId.parse(request.couplingId),
        requesterPersonId: EntityId.parse(request.requesterPersonId),
        at: new Date(request.at),
      }),
    );
    // Das Manifest erwartet eine angenommene Entkopplung; alles andere ist ein Fehler des Szenarios.
    if (result.status !== 'angenommen') throw new Error(`Seed: Entkopplung ${result.status}`);
  }
}

/** Kanonischer Stand der Fach- und Sync-Daten, vergleichbar mit `manifest.initial.server`. */
export async function dumpServer(executor: DbExecutor): Promise<SeedRows> {
  const dump: Record<string, SeedRow[]> = {};
  for (const [name, table] of byName) {
    if (notCanonical.includes(name)) continue;
    const found = await executor.select().from(table);
    dump[name] = found.map((row) => toCanonical(table, row as Record<string, unknown>));
  }
  return canonicalRows(dump);
}

/**
 * Schema-Prüfung: Tabellen außerhalb der Better-Auth-Tabellen, in denen irgendeine Spalte eine
 * E-Mail-Adresse enthält. Sie prüft den ganzen Zeileninhalt als JSON, also auch JSON-Spalten.
 */
export async function tablesWithEmail(executor: DbExecutor): Promise<string[]> {
  const found: string[] = [];
  for (const name of byName.keys()) {
    if (authTableNames.includes(name)) continue;
    const result = await executor.execute<{ hit: boolean }>(
      sql.raw(`select exists (select 1 from "${name}" t where to_jsonb(t)::text ~ '[^[:space:]@"]+@[^[:space:]@"]+\\.[^[:space:]@"]+') as hit`),
    );
    if (result.rows[0]?.hit === true) found.push(name);
  }
  return found;
}

function columnsOf(table: PgTable): Map<string, { key: string; column: AnyPgColumn }> {
  return new Map(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, { key, column: column as AnyPgColumn }]));
}

function toDatabase(table: PgTable, row: SeedRow): Record<string, unknown> {
  const columns = columnsOf(table);
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    const found = columns.get(name);
    if (found === undefined) throw new Error(`Seed: unbekannte Spalte ${getTableConfig(table).name}.${name}`);
    values[found.key] = value === null ? null : fromCanonical(found.column, value);
  }
  return values;
}

function fromCanonical(column: AnyPgColumn, value: SeedValue): unknown {
  switch (column.columnType) {
    case 'PgTimestamp':
      return new Date(value as string);
    case 'PgBigInt64':
      return BigInt(value as string);
    default:
      return value;
  }
}

function toCanonical(table: PgTable, row: Record<string, unknown>): SeedRow {
  const canonical: SeedRow = {};
  for (const [name, { key }] of columnsOf(table)) {
    const value = row[key];
    canonical[name] = value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? value.toString() : (value as SeedValue);
  }
  return canonical;
}
