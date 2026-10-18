import { sql } from 'drizzle-orm';
import { check, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core';

import { AreaKey } from '@abnehm/contracts/base';
import { PartnerDailyGoalStage } from '@abnehm/contracts/partner';

import { coupling, person } from './accounts.ts';
import { island } from './game.ts';
import { id, instant, json, localDate, mutable, oneOf, ref, serverVersion, text, whole } from './columns.ts';

// Serverseitig erzeugte, widerrufbare Lesemodelle (Spezifikation 0, Abschnitt 5). Auf dem Gerät sind
// sie nur ein lokaler Lesecache. `generation` trennt gelöschte von neu freigegebenen Fassungen:
// Natürlicher Schlüssel + Generation ist eindeutig, und je natürlichem Schlüssel gibt es höchstens
// eine nicht gelöschte Projektion.

export const partnerSummary = pgTable(
  'partner_summary',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    ownerPersonId: ref('owner_person_id')
      .notNull()
      .references(() => person.id),
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

export const partnerDailyGoalStatus = pgTable(
  'partner_daily_goal_status',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    ownerPersonId: ref('owner_person_id')
      .notNull()
      .references(() => person.id),
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

/** Inselfortschritt (`IslandProgress`) ohne Energiemengen; jederzeit aus den Buchungen neu berechenbar. */
export const islandProgress = pgTable(
  'island_progress',
  {
    id: id(),
    islandId: ref('island_id')
      .notNull()
      .unique('island_progress_island_uq')
      .references(() => island.id),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    level: whole('level').notNull(),
    levelNeed: whole('level_need').notNull(),
    /** Hälften beider Mitglieder und aktives Gemeinschaftsprojekt, validiert mit `IslandProgress`. */
    content: json<Record<string, unknown>>('content').notNull(),
    dataAsOf: instant('data_as_of').notNull(),
    ...mutable(),
  },
  (t) => [check('island_progress_level_check', sql`${t.level} > 0 and ${t.levelNeed} > 0`)],
);

/** Inhaltsfreie Löschanweisung an einen früheren Empfänger; bleibt nach Rechteentzug lesbar. */
export const revocationNotice = pgTable(
  'revocation_notice',
  {
    id: id(),
    recipientPersonId: ref('recipient_person_id')
      .notNull()
      .references(() => person.id),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    targetType: text('target_type').notNull(),
    projectionId: ref('projection_id'),
    reason: text('reason').notNull(),
    createdAt: instant('created_at').notNull(),
    serverVersion: serverVersion(),
  },
  (t) => [
    check('revocation_notice_target_type_check', oneOf(t.targetType, ['partner_summary', 'partner_daily_goal_status', 'kopplung'])),
    check('revocation_notice_reason_check', oneOf(t.reason, ['freigabe_entzogen', 'entkopplung'])),
    check(
      'revocation_notice_target_check',
      sql`(${t.targetType} = 'kopplung') = (${t.projectionId} is null) and (${t.reason} = 'entkopplung' or ${t.targetType} = 'partner_summary')`,
    ),
  ],
);

/**
 * Typisierte Projektions-Invalidierung, in derselben Transaktion wie die Fachänderung geschrieben.
 * Ohne Bereich betrifft sie alle Bereiche des Eigentümers (Ziel-, Wochenplan- und Freigabeänderungen).
 */
export const projectionInvalidation = pgTable(
  'projection_invalidation',
  {
    id: id(),
    ownerPersonId: ref('owner_person_id')
      .notNull()
      .references(() => person.id),
    area: text('area'),
    fromDate: localDate('from_date').notNull(),
    createdAt: instant('created_at').notNull(),
    processedAt: instant('processed_at'),
  },
  (t) => [check('projection_invalidation_area_check', oneOf(t.area, AreaKey.options))],
);
