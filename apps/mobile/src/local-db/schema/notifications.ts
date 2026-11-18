import { sql } from 'drizzle-orm';
import { check, sqliteTable, unique } from 'drizzle-orm/sqlite-core';

import { EncouragementKey, EncouragementPushStatus } from '@abnehm/contracts/partner';

import { coupling, person } from './accounts';
import { day, flag, id, instant, mutable, oneOf, ref, text } from './columns';

// Benachrichtigungseinstellung und Anfeuern (Spezifikation 0, Abschnitt 8; Spezifikation 5,
// Abschnitte 4 und 10). Push-Installation, Intents und Zustellversuche gibt es nur auf dem Server;
// geplante Tages-Check-ins und das Einmal-Flag sind Gerätezustand (`device_state`).

/** Lokale Wanduhrzeit `HH:MM`. */
const wallClock = (column: unknown) => sql`(${column} glob '[0-2][0-9]:[0-5][0-9]' and ${column} <= '23:59')`;

export const notificationSetting = sqliteTable(
  'notification_setting',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
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
    unique('notification_setting_person_uq').on(t.personId),
    check('notification_setting_time_format_check', sql`${wallClock(t.middayTime)} and ${wallClock(t.eveningTime)}`),
    check('notification_setting_time_order_check', sql`${t.eveningTime} > ${t.middayTime}`),
  ],
);

export const encouragement = sqliteTable(
  'encouragement',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    senderPersonId: ref('sender_person_id').notNull(),
    recipientPersonId: ref('recipient_person_id').notNull(),
    messageKey: text('message_key').notNull(),
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
