import { sql } from 'drizzle-orm';
import { check, sqliteTable, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { AreaKey } from '@abnehm/contracts/base';
import { PartnerDailyGoalStage } from '@abnehm/contracts/partner';

import { coupling, person } from './accounts';
import { island } from './game';
import { id, instant, json, localDate, mutable, oneOf, ref, text, whole } from './columns';

// Lokaler, widerrufbarer Lesecache der serverseitigen Projektionen (Spezifikation 0, Abschnitt 5).
// Fremde Gesundheits-Rohdaten werden nie repliziert; Revocation-Notices löschen diese Zeilen.

export const partnerSummary = sqliteTable(
  'partner_summary',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    ownerPersonId: ref('owner_person_id').notNull(),
    recipientPersonId: ref('recipient_person_id')
      .notNull()
      .references(() => person.id),
    area: text('area').notNull(),
    periodFrom: localDate('period_from').notNull(),
    periodTo: localDate('period_to').notNull(),
    generation: whole('generation').notNull(),
    content: json<Record<string, unknown>>('content').notNull(),
    dataAsOf: instant('data_as_of').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('partner_summary_generation_uq').on(t.couplingId, t.ownerPersonId, t.recipientPersonId, t.area, t.periodFrom, t.generation),
    uniqueIndex('partner_summary_live_uq')
      .on(t.couplingId, t.ownerPersonId, t.recipientPersonId, t.area, t.periodFrom)
      .where(sql`${t.deletedAt} is null`),
    check('partner_summary_area_check', oneOf(t.area, AreaKey.options)),
    check(
      'partner_summary_shape_check',
      sql`${t.ownerPersonId} <> ${t.recipientPersonId} and ${t.generation} > 0 and ${t.periodFrom} <= ${t.periodTo}`,
    ),
  ],
);

export const partnerDailyGoalStatus = sqliteTable(
  'partner_daily_goal_status',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    ownerPersonId: ref('owner_person_id').notNull(),
    recipientPersonId: ref('recipient_person_id')
      .notNull()
      .references(() => person.id),
    localDate: localDate('local_date').notNull(),
    generation: whole('generation').notNull(),
    stage: text('stage').notNull(),
    dataAsOf: instant('data_as_of').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('partner_daily_goal_status_generation_uq').on(t.couplingId, t.ownerPersonId, t.recipientPersonId, t.localDate, t.generation),
    uniqueIndex('partner_daily_goal_status_live_uq')
      .on(t.couplingId, t.ownerPersonId, t.recipientPersonId, t.localDate)
      .where(sql`${t.deletedAt} is null`),
    check('partner_daily_goal_status_stage_check', oneOf(t.stage, PartnerDailyGoalStage.options)),
    check('partner_daily_goal_status_shape_check', sql`${t.ownerPersonId} <> ${t.recipientPersonId} and ${t.generation} > 0`),
  ],
);

export const islandProgress = sqliteTable(
  'island_progress',
  {
    id: id(),
    islandId: ref('island_id')
      .notNull()
      .references(() => island.id),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    level: whole('level').notNull(),
    levelNeed: whole('level_need').notNull(),
    content: json<Record<string, unknown>>('content').notNull(),
    dataAsOf: instant('data_as_of').notNull(),
    ...mutable(),
  },
  (t) => [unique('island_progress_island_uq').on(t.islandId), check('island_progress_level_check', sql`${t.level} > 0 and ${t.levelNeed} > 0`)],
);
