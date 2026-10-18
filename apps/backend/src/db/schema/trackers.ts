import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, unique } from 'drizzle-orm/pg-core';

import { person } from './accounts.ts';
import { day, id, instant, mutable, oneOf, ref, text, whole } from './columns.ts';

// Wasser, Sport und Gewicht (Spezifikation 0, Abschnitt 8; Spezifikation 3, Abschnitte 3, 6 und 8).
// Tagesgewicht, Gewichtstrend, Wochenminuten und Ersetzungswirkung werden berechnet, nicht gespeichert.

export const activityTypes = [
  'gehen',
  'laufen',
  'radfahren',
  'schwimmen',
  'krafttraining',
  'yoga_dehnen',
  'mannschaftssport',
  'sonstiges',
] as const;
export const origins = ['manuell', 'apple_health', 'health_connect'] as const;

export const waterEntry = pgTable(
  'water_entry',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    amountMl: whole('amount_ml').notNull(),
    origin: text('origin').notNull(),
    loggedAt: instant('logged_at').notNull(),
    ...day(),
    ...mutable(),
  },
  (t) => [
    check('water_entry_amount_check', sql`${t.amountMl} between 1 and 3000`),
    // Wasser wird nie importiert.
    check('water_entry_origin_check', oneOf(t.origin, ['manuell'])),
  ],
);

export const sportEntry = pgTable(
  'sport_entry',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    activityType: text('activity_type').notNull(),
    overrideActivityType: text('override_activity_type'),
    startedAt: instant('started_at').notNull(),
    durationMinutes: whole('duration_minutes').notNull(),
    activeMilliKcal: whole('active_milli_kcal'),
    origin: text('origin').notNull(),
    // Nur bei Importen: externer Schlüssel, Quell-App und Ausblendestatus.
    externalKey: text('external_key'),
    sourceAppId: text('source_app_id'),
    sourceAppName: text('source_app_name'),
    hiddenAt: instant('hidden_at'),
    // Nur bei manuellen Einträgen: ersetzender Import derselben Person und Reaktivierung.
    replacedByEntryId: ref('replaced_by_entry_id'),
    reactivatedAt: instant('reactivated_at'),
    ...day(),
    ...mutable(),
  },
  (t) => [
    unique('sport_entry_owner_uq').on(t.id, t.personId),
    unique('sport_entry_external_uq').on(t.personId, t.origin, t.externalKey),
    foreignKey({
      name: 'sport_entry_replaced_by_fk',
      columns: [t.replacedByEntryId, t.personId],
      foreignColumns: [t.id, t.personId],
    }),
    check('sport_entry_activity_type_check', oneOf(t.activityType, activityTypes)),
    check('sport_entry_override_activity_type_check', oneOf(t.overrideActivityType, activityTypes)),
    check('sport_entry_duration_check', sql`${t.durationMinutes} between 1 and 1440`),
    check('sport_entry_active_energy_check', sql`${t.activeMilliKcal} >= 0`),
    check('sport_entry_origin_check', oneOf(t.origin, origins)),
    check(
      'sport_entry_origin_fields_check',
      sql`(${t.origin} = 'manuell' and ${t.externalKey} is null and ${t.sourceAppId} is null and ${t.sourceAppName} is null and ${t.hiddenAt} is null) or (${t.origin} <> 'manuell' and ${t.externalKey} is not null and ${t.replacedByEntryId} is null and ${t.reactivatedAt} is null)`,
    ),
  ],
);

export const weightEntry = pgTable(
  'weight_entry',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    weightG: whole('weight_g').notNull(),
    measuredAt: instant('measured_at').notNull(),
    origin: text('origin').notNull(),
    externalKey: text('external_key'),
    sourceAppId: text('source_app_id'),
    sourceAppName: text('source_app_name'),
    hiddenAt: instant('hidden_at'),
    ...day(),
    ...mutable(),
  },
  (t) => [
    unique('weight_entry_external_uq').on(t.personId, t.origin, t.externalKey),
    check('weight_entry_weight_check', sql`${t.weightG} between 20000 and 350000`),
    check('weight_entry_origin_check', oneOf(t.origin, origins)),
    check(
      'weight_entry_origin_fields_check',
      sql`(${t.origin} = 'manuell' and ${t.externalKey} is null and ${t.sourceAppId} is null and ${t.sourceAppName} is null and ${t.hiddenAt} is null) or (${t.origin} <> 'manuell' and ${t.externalKey} is not null)`,
    ),
  ],
);
