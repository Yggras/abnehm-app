import { describe, expect, it } from 'vitest';

import * as postgres from '../apps/backend/src/db/schema/index.ts';
import { loadSqliteSchema, postgresShape, sqliteShape, type ForeignKeyShape, type TableShape } from './support/schema-shape.ts';

const sqlite = await loadSqliteSchema();

// Postgres (Backend) und SQLite (App) dürfen technisch normalisieren, bilden aber dieselben
// Schlüssel, Constraints, Eigentumsgrenzen und Operationen ab (Spezifikation 0, Abschnitt 8).
// Abweichungen stehen hier ausdrücklich und begründet.

const pg = byName(postgresShape(postgres));
const lite = byName(sqliteShape(sqlite));

/** Reine Server-Tabellen (Spezifikation 0, Abschnitte 8–11; Spezifikation 5, Abschnitt 9). */
const serverOnly = [
  'invitation',
  'push_installation',
  'notification_intent',
  'delivery_attempt',
  'photo_draft',
  'change_log',
  'processed_operation',
  'security_log',
  'sync_clock',
  'revocation_notice',
  'projection_invalidation',
];

/** Nur auf dem Gerät: Outbox, Cursor, Gerätezustand, Dirty-Day-Marker und Open-Food-Facts-Cache. */
const deviceOnly = ['outbox', 'sync_cursor', 'device_state', 'dirty_day', 'off_cache'];

/** CHECKs, deren SQL dialektabhängig ist; Name und Bedeutung sind gleich. */
const dialectSpecificChecks = ['notification_setting_time_format_check'];

function byName(tables: TableShape[]) {
  return new Map(tables.map((table) => [table.name, table]));
}

const shared = [...pg.keys()].filter((name) => lite.has(name)).sort();

function foreignKeyText(foreignKey: ForeignKeyShape) {
  return `(${foreignKey.columns.join(', ')}) → ${foreignKey.foreignTable}(${foreignKey.foreignColumns.join(', ')}) delete ${foreignKey.onDelete} update ${foreignKey.onUpdate}`;
}

describe('Schema-Parität Postgres ↔ SQLite', () => {
  it('trennt reine Server- und Gerätetabellen, alle übrigen gibt es in beiden', () => {
    expect([...pg.keys()].filter((name) => !lite.has(name)).sort()).toEqual([...serverOnly].sort());
    expect([...lite.keys()].filter((name) => !pg.has(name)).sort()).toEqual([...deviceOnly].sort());
    expect(shared.length).toBeGreaterThan(30);
  });

  it('liest Schlüssel, partielle Indizes, CHECKs und Fremdschlüssel tatsächlich aus', () => {
    for (const shape of [pg, lite]) {
      const member = shape.get('coupling_member')!;
      expect(member.uniques).toEqual({
        coupling_member_person_uq: 'coupling_id, person_id',
        coupling_member_active_person_uq: `person_id where "coupling_member"."coupling_status" = 'aktiv'`,
        coupling_member_role_uq: `coupling_id, role where "coupling_member"."role" is not null`,
      });
      expect(member.checks).toEqual({ coupling_member_role_check: `"coupling_member"."role" in ('bauen', 'natur')` });
      expect(member.foreignKeys.map(foreignKeyText)).toContain(
        '(coupling_id, coupling_status) → coupling(id, status) delete no action update cascade',
      );
      expect(shape.get('person')!.uniques).toEqual({ person_account_uq: 'account_id' });
      expect(shape.get('weekly_plan_day')!.primaryKey).toEqual(['weekly_plan_version_id', 'weekday']);
    }
  });

  it.each(shared)('%s: dieselben Spalten mit derselben Nullbarkeit', (name) => {
    const nullability = (table: TableShape) =>
      Object.fromEntries(
        Object.entries(table.columns).map(([column, { notNull }]) => [
          column,
          // Lokal ist `server_version` bei unbestätigten Creates leer, in Postgres immer gesetzt.
          column === 'server_version' ? 'server_version' : notNull,
        ]),
      );
    expect(nullability(lite.get(name)!)).toEqual(nullability(pg.get(name)!));
    if ('server_version' in pg.get(name)!.columns) {
      expect(pg.get(name)!.columns.server_version!.notNull).toBe(true);
      expect(lite.get(name)!.columns.server_version!.notNull).toBe(false);
    }
  });

  it.each(shared)('%s: derselbe Primärschlüssel und dieselben Unique-Keys', (name) => {
    expect(lite.get(name)!.primaryKey).toEqual(pg.get(name)!.primaryKey);
    expect(lite.get(name)!.uniques).toEqual(pg.get(name)!.uniques);
  });

  it.each(shared)('%s: dieselben CHECK-Constraints', (name) => {
    const comparable = (table: TableShape) =>
      Object.fromEntries(
        Object.entries(table.checks).map(([check, text]) => [check, dialectSpecificChecks.includes(check) ? 'dialektabhängig' : text]),
      );
    expect(comparable(lite.get(name)!)).toEqual(comparable(pg.get(name)!));
  });

  it.each(shared)('%s: dieselben Fremdschlüssel, außer auf Personen, die lokal fehlen können', (name) => {
    const partnerColumns = new Set<string>(sqlite.partnerPersonColumns);
    const expected = pg
      .get(name)!
      .foreignKeys.filter(
        (foreignKey) =>
          !(foreignKey.foreignTable === 'person' && foreignKey.columns.length === 1 && partnerColumns.has(`${name}.${foreignKey.columns[0]}`)),
      )
      .map(foreignKeyText)
      .sort();
    expect(lite.get(name)!.foreignKeys.map(foreignKeyText).sort()).toEqual(expected);
  });

  it('nennt nur Partnerspalten, die in Postgres wirklich auf `person` verweisen', () => {
    for (const entry of sqlite.partnerPersonColumns) {
      const [table, column] = entry.split('.');
      expect(pg.get(table!)!.columns[column!]!.foreignTargets, entry).toEqual(['person.id']);
      expect(lite.get(table!)!.columns[column!]!.foreignTargets, entry).toEqual([]);
    }
  });
});
