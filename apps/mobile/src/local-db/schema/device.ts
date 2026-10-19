import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { DailyGoalCause } from '@abnehm/contracts/daily-goals';

import { person } from './accounts';
import { instant, json, localDate, oneOf, ref } from './columns';

// Technische Daten nur dieses Geräts (Spezifikation 0, Abschnitte 3, 8 und 10). Sie werden nicht
// synchronisiert und liegen wie alles andere in der Datenbank genau eines Kontos.

/** Ausstehende Sync-Operation; entsteht in derselben Transaktion wie ihre Fachänderung. */
export const outbox = sqliteTable(
  'outbox',
  {
    operationId: text('operation_id').primaryKey(),
    /** Monoton steigende Reihenfolge der Entstehung; Push sendet in dieser Reihenfolge. */
    sequence: integer('sequence').notNull(),
    /** `upsert_entity`, `delete_entity` oder ein Fachbefehl; den Katalog prüft das Sync-Modul per Zod. */
    type: text('type').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    businessKey: text('business_key'),
    /** Lokal optimistisch geänderte Entitäten eines Fachbefehls; bleibt außerhalb des Transports. */
    affectedRefs: json<{ entityType: string; entityId: string }[]>('affected_refs').notNull().default(sql`'[]'`),
    /** Vollständige Nutzlast statt Patch, validiert mit dem Vertragsschema der Operation. */
    payload: json<Record<string, unknown>>('payload').notNull(),
    knownServerVersion: text('known_server_version'),
    schemaVersion: integer('schema_version').notNull(),
    createdAt: instant('created_at').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    lastAttemptAt: instant('last_attempt_at'),
    lastErrorCode: text('last_error_code'),
  },
  (t) => [
    unique('outbox_sequence_uq').on(t.sequence),
    check('outbox_sequence_check', sql`${t.sequence} > 0`),
    check('outbox_attempt_check', sql`${t.attemptCount} >= 0 and ${t.schemaVersion} > 0`),
  ],
);

/** Pull-Cursor samt laufender Seite; der endgültige Cursor wird erst mit der letzten Seite gespeichert. */
export const syncCursor = sqliteTable('sync_cursor', {
  scope: text('scope').primaryKey(),
  cursor: text('cursor'),
  pageToken: text('page_token'),
  updatedAt: instant('updated_at').notNull(),
});

/**
 * Gerätezustand je Schlüssel, etwa Health-Anker, geplante Tages-Check-ins, Einmal-Flags oder
 * `logout_pending`. Den Wert prüft das Modul, dem der Schlüssel gehört.
 */
export const deviceState = sqliteTable('device_state', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  updatedAt: instant('updated_at').notNull(),
});

/**
 * Dauerhafte Dirty-Day-Marker des Nach-Commit-Signals: in derselben Transaktion wie die Auswertung
 * geschrieben, nach erfolgreicher Zustellung an die Beobachter gelöscht.
 */
export const dirtyDay = sqliteTable(
  'dirty_day',
  {
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    localDate: localDate('local_date').notNull(),
    cause: text('cause').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'dirty_day_pk', columns: [t.personId, t.localDate, t.cause] }),
    check('dirty_day_cause_check', oneOf(t.cause, DailyGoalCause.options)),
  ],
);
