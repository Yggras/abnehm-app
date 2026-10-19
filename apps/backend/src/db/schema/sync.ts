import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, smallint, uniqueIndex } from 'drizzle-orm/pg-core';

import { coupling, person } from './accounts.ts';
import { user } from './auth.ts';
import { onlineFlows } from '../../online/flows.ts';
import { securityEventTypes } from '../../security-log/events.ts';
import { id, instant, json, oneOf, ref, text } from './columns.ts';

// Technische Sync- und Sicherheitsdaten des Servers (Spezifikation 0, Abschnitte 8, 10 und 11).
// Für V1 bleiben Änderungsprotokoll und verarbeitete Operationen dauerhaft erhalten.

/** Serialisierte Sync-Clock: genau eine Zeile, unter Sperre in der Schreibtransaktion hochgezählt. */
export const syncClock = pgTable(
  'sync_clock',
  {
    id: smallint('id').primaryKey(),
    position: bigint('position', { mode: 'bigint' }).notNull(),
  },
  (t) => [check('sync_clock_single_row_check', sql`${t.id} = 1`), check('sync_clock_position_check', sql`${t.position} >= 0`)],
);

/** Global geordnetes Änderungsprotokoll; jede Zeile nennt ihre Sichtbarkeitsgrenze in eigenen Spalten. */
export const changeLog = pgTable(
  'change_log',
  {
    position: bigint('position', { mode: 'bigint' }).primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: ref('entity_id').notNull(),
    operation: text('operation').notNull(),
    ownerPersonId: ref('owner_person_id').references(() => person.id),
    couplingId: ref('coupling_id').references(() => coupling.id),
    recipientPersonId: ref('recipient_person_id').references(() => person.id),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    check('change_log_operation_check', oneOf(t.operation, ['upsert', 'delete'])),
    check(
      'change_log_scope_check',
      sql`${t.ownerPersonId} is not null or ${t.couplingId} is not null or ${t.recipientPersonId} is not null`,
    ),
  ],
);

/** Terminales Ergebnis jeder Operation, auch jeder Ablehnung; Retry nur bei identischem Inhalt. */
export const processedOperation = pgTable(
  'processed_operation',
  {
    operationId: ref('operation_id').primaryKey(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    operationType: text('operation_type').notNull(),
    /** Entität der Operation; fehlt nur bei Fachbefehlen ohne einzelne Entität. */
    entityType: text('entity_type'),
    entityId: ref('entity_id'),
    /** Fachlicher Idempotenzschlüssel, etwa ein Buchungsschlüssel. */
    businessKey: text('business_key'),
    payloadHash: text('payload_hash').notNull(),
    outcome: text('outcome').notNull(),
    result: json<Record<string, unknown>>('result').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    // Nur erfolgreiche Ergebnisse belegen den fachlichen Schlüssel; eine Ablehnung sperrt ihn nicht.
    uniqueIndex('processed_operation_business_key_uq')
      .on(t.operationType, t.businessKey)
      .where(sql`${t.outcome} <> 'permanently_rejected'`),
    check('processed_operation_outcome_check', oneOf(t.outcome, ['applied', 'already_applied', 'permanently_rejected'])),
    check('processed_operation_entity_check', sql`(${t.entityType} is null) = (${t.entityId} is null)`),
  ],
);

/**
 * Ergebnis eines erfolgreichen Online-Ablaufs unter seiner clientseitigen `requestId`, gebunden an
 * Konto, Ablaufart und den Schlüssel-Hash der Anfrage. Ein identischer Retry erhält es unverändert.
 * Bleibt wie die verarbeiteten Operationen dauerhaft erhalten.
 */
export const onlineRequest = pgTable(
  'online_request',
  {
    requestId: ref('request_id').primaryKey(),
    accountId: ref('account_id')
      .notNull()
      .references(() => user.id),
    flow: text('flow').notNull(),
    /** HMAC der kanonischen Anfrage mit dem Einladungs-Secret; ein Code steckt darin nie lesbar. */
    requestHash: text('request_hash').notNull(),
    result: json<Record<string, unknown>>('result').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [check('online_request_flow_check', oneOf(t.flow, onlineFlows))],
);

/**
 * Sicherheitslog ohne Gesundheitswerte, Geheimnisse, Codes oder vollständige Requests. Konto und Person
 * stehen in eigenen Spalten, bewusst ohne Fremdschlüssel: Der Eintrag bleibt erhalten, auch wenn
 * Konto oder Person fehlen. Schreiben und Löschen nach 90 Tagen nur über `src/security-log/`.
 */
export const securityLog = pgTable(
  'security_log',
  {
    id: id(),
    occurredAt: instant('occurred_at').notNull(),
    eventType: text('event_type').notNull(),
    accountId: ref('account_id'),
    personId: ref('person_id'),
    /** Ereignisspezifische Felder, an der Anwendungsgrenze mit `SecurityEvent` validiert. */
    details: json<Record<string, unknown>>('details').notNull(),
  },
  (t) => [
    check('security_log_event_type_check', oneOf(t.eventType, securityEventTypes)),
    index('security_log_occurred_at_idx').on(t.occurredAt),
  ],
);
