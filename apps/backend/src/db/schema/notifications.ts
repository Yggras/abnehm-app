import { sql } from 'drizzle-orm';
import { check, pgTable, unique } from 'drizzle-orm/pg-core';

import { EncouragementKey, EncouragementPushStatus } from '@abnehm/contracts/partner';

import { coupling, person } from './accounts.ts';
import { day, flag, id, instant, json, mutable, oneOf, ref, text, whole } from './columns.ts';

// Benachrichtigungen, Anfeuern und Geräte (Spezifikation 0, Abschnitte 2, 8 und 9; Spezifikation 5,
// Abschnitte 4, 9 und 10). Push-Installation, Intents und Zustellversuche gibt es nur in Postgres.

export const intentTypes = [
  'anfeuern',
  'levelaufstieg',
  'gebiet',
  'projektabschluss',
  'challenge_vorschlag',
  'challenge_erfolg',
  'rollen_anfrage',
  'deko_geschenk',
  'entkopplung',
] as const;

/** Zustellstatus eines Intents (Spezifikation 5, Abschnitt 9). */
export const intentStatuses = ['offen', 'unterdrueckt', 'keine_installation', 'zugestellt', 'fehlgeschlagen'] as const;
export type IntentStatus = (typeof intentStatuses)[number];

/** Status eines Zustellversuchs (Spezifikation 5, Abschnitt 9). */
export const deliveryAttemptStatuses = ['geplant', 'gesendet', 'ticket_fehler', 'quittiert', 'quittung_fehler', 'aufgegeben'] as const;
export type DeliveryAttemptStatus = (typeof deliveryAttemptStatuses)[number];

/** Lokale Wanduhrzeit `HH:MM`. */
const wallClock = (column: unknown) => sql`${column} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`;

/** Eine je Person, deterministische ID aus der Person-ID. */
export const notificationSetting = pgTable(
  'notification_setting',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .unique('notification_setting_person_uq')
      .references(() => person.id),
    middayEnabled: flag('midday_enabled').notNull(),
    middayTime: text('midday_time').notNull(),
    eveningEnabled: flag('evening_enabled').notNull(),
    eveningTime: text('evening_time').notNull(),
    trackerErnaehrung: flag('tracker_ernaehrung').notNull(),
    trackerWasser: flag('tracker_wasser').notNull(),
    trackerSport: flag('tracker_sport').notNull(),
    trackerGewicht: flag('tracker_gewicht').notNull(),
    partnerPushEnabled: flag('partner_push_enabled').notNull(),
    ...mutable(),
  },
  (t) => [
    check('notification_setting_time_format_check', sql`${wallClock(t.middayTime)} and ${wallClock(t.eveningTime)}`),
    check('notification_setting_time_order_check', sql`${t.eveningTime} > ${t.middayTime}`),
  ],
);

/** Anfeuerung; kein generisches Update, nur `sendEncouragement` und `thankEncouragements`. */
export const encouragement = pgTable(
  'encouragement',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    senderPersonId: ref('sender_person_id')
      .notNull()
      .references(() => person.id),
    recipientPersonId: ref('recipient_person_id')
      .notNull()
      .references(() => person.id),
    messageKey: text('message_key').notNull(),
    /** `createdAt` des Absenders; lokaler Tag, Zone und Offset ebenfalls des Absenders. */
    sentAt: instant('sent_at').notNull(),
    ...day(),
    pushStatus: text('push_status').notNull(),
    thankedAt: instant('thanked_at'),
    ...mutable(),
  },
  (t) => [
    check('encouragement_message_key_check', oneOf(t.messageKey, EncouragementKey.options)),
    check('encouragement_push_status_check', oneOf(t.pushStatus, EncouragementPushStatus.options)),
    check('encouragement_recipient_check', sql`${t.senderPersonId} <> ${t.recipientPersonId}`),
  ],
);

/** Push-Installation eines Geräts; Token nie im Fach-Sync. */
export const pushInstallation = pgTable(
  'push_installation',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    /**
     * Better-Auth-Sitzung der letzten Registrierung. Ohne Fremdschlüssel: Better Auth löscht widerrufene
     * und abgelaufene Sitzungen, die Installation bleibt dann bis zur nächsten Registrierung ohne
     * gültige Sitzung und erhält keine Pushes (Spezifikation 0, Abschnitt 9).
     */
    sessionId: ref('session_id').notNull(),
    installationKey: text('installation_key').notNull().unique('push_installation_key_uq'),
    expoPushToken: text('expo_push_token').notNull(),
    platform: text('platform').notNull(),
    permissionStatus: text('permission_status').notNull(),
    active: flag('active').notNull(),
    lastUsedAt: instant('last_used_at').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [
    check('push_installation_platform_check', oneOf(t.platform, ['ios', 'android'])),
    check('push_installation_permission_check', oneOf(t.permissionStatus, ['erlaubt', 'verweigert', 'unentschieden'])),
  ],
);

/** Benachrichtigungsabsicht mit unveränderlichem Inhalt; nur der Zustellstatus ändert sich. */
export const notificationIntent = pgTable(
  'notification_intent',
  {
    intentId: text('intent_id').primaryKey(),
    sourceEventId: ref('source_event_id').notNull(),
    recipientPersonId: ref('recipient_person_id')
      .notNull()
      .references(() => person.id),
    type: text('type').$type<(typeof intentTypes)[number]>().notNull(),
    messageKey: text('message_key').notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    status: text('status').$type<IntentStatus>().notNull(),
    createdAt: instant('created_at').notNull(),
    statusChangedAt: instant('status_changed_at').notNull(),
  },
  (t) => [
    check('notification_intent_type_check', oneOf(t.type, intentTypes)),
    check(
      'notification_intent_status_check',
      oneOf(t.status, intentStatuses),
    ),
    check(
      'notification_intent_id_check',
      sql`${t.intentId} = ${t.sourceEventId}::text || ':' || ${t.recipientPersonId}::text || ':' || ${t.type}`,
    ),
  ],
);

/** Technischer Zustellversuch je Intent und Installation; 30 Tage Aufbewahrung. */
export const deliveryAttempt = pgTable(
  'delivery_attempt',
  {
    id: id(),
    intentId: text('intent_id')
      .notNull()
      .references(() => notificationIntent.intentId),
    installationId: ref('installation_id')
      .notNull()
      .references(() => pushInstallation.id),
    recipientPersonId: ref('recipient_person_id')
      .notNull()
      .references(() => person.id),
    status: text('status').$type<DeliveryAttemptStatus>().notNull(),
    expoTicketId: text('expo_ticket_id'),
    errorCode: text('error_code'),
    attemptCount: whole('attempt_count').notNull(),
    nextAttemptAt: instant('next_attempt_at'),
    sentAt: instant('sent_at'),
    receiptCheckedAt: instant('receipt_checked_at'),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [
    unique('delivery_attempt_installation_uq').on(t.intentId, t.installationId),
    check(
      'delivery_attempt_status_check',
      oneOf(t.status, deliveryAttemptStatuses),
    ),
    check('delivery_attempt_count_check', sql`${t.attemptCount} >= 0`),
  ],
);
