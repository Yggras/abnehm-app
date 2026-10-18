import { sql } from 'drizzle-orm';
import { check, foreignKey, sqliteTable, unique, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { ChallengeStatus, CommonStage, IslandEventKind, IslandRole } from '@abnehm/contracts/island';
import { SharedEventType } from '@abnehm/contracts/wir';

import { coupling, person } from './accounts';
import { id, immutable, instant, json, localDate, mutable, oneOf, ref, small, text, whole } from './columns';
import { dailyGoalCompletion } from './plan';

// Energie, Insel und Spiel (Spezifikation 0, Abschnitte 4 und 8; Spezifikation 4, Abschnitte 2–10).
// Inseldaten gehören der Kopplung (`coupling_id`), Energiebuchungen und Einzahlungen der Person.
// Fremdschlüssel unveränderlicher Ereignisse und Buchungen verwenden `ON DELETE RESTRICT`.

export const islandStates = ['wartet_auf_rollen', 'aktiv', 'archiviert'] as const;
export const objectOrigins = ['gebaut', 'besucher', 'entdeckung', 'jahreszeit', 'challenge'] as const;
export const eventStatuses = ['offen', 'erfuellbar', 'abgeschlossen'] as const;
export const bookingTypes = [
  'daily_goal_credit',
  'daily_bonus_credit',
  'build_debit',
  'upgrade_debit',
  'project_contribution_debit',
  'counter_booking',
] as const;

export const island = sqliteTable(
  'island',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    state: text('state').notNull(),
    hatchedAt: instant('hatched_at'),
    timeZone: text('time_zone'),
    ...mutable(),
  },
  (t) => [
    unique('island_coupling_uq').on(t.couplingId),
    unique('island_owner_uq').on(t.id, t.couplingId),
    check('island_state_check', oneOf(t.state, islandStates)),
    check(
      'island_hatched_check',
      sql`(${t.state} <> 'aktiv' or ${t.hatchedAt} is not null) and (${t.state} <> 'wartet_auf_rollen' or ${t.hatchedAt} is null) and (${t.hatchedAt} is null) = (${t.timeZone} is null)`,
    ),
  ],
);

/** Fremdschlüssel auf die Insel samt Kopplung, damit die Eigentumsgrenze zur Insel passt. */
function onIsland(name: string, columns: { islandId: AnySQLiteColumn; couplingId: AnySQLiteColumn }) {
  return foreignKey({ name, columns: [columns.islandId, columns.couplingId], foreignColumns: [island.id, island.couplingId] });
}

export const blueprintUnlock = sqliteTable(
  'blueprint_unlock',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    catalogKey: text('catalog_key').notNull(),
    reason: text('reason').notNull(),
    unlockedAt: instant('unlocked_at').notNull(),
    ...immutable(),
  },
  (t) => [
    onIsland('blueprint_unlock_island_fk', t).onDelete('restrict'),
    unique('blueprint_unlock_key_uq').on(t.islandId, t.catalogKey),
    check('blueprint_unlock_reason_check', oneOf(t.reason, ['start', 'level', 'entdeckung', 'besucher'])),
  ],
);

export const areaUnlock = sqliteTable(
  'area_unlock',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    areaKey: text('area_key').notNull(),
    level: small('level').notNull(),
    unlockedAt: instant('unlocked_at').notNull(),
    ...immutable(),
  },
  (t) => [
    onIsland('area_unlock_island_fk', t).onDelete('restrict'),
    unique('area_unlock_key_uq').on(t.islandId, t.areaKey),
    check('area_unlock_level_check', sql`${t.level} >= 4`),
  ],
);

export const islandField = sqliteTable(
  'island_field',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    fieldKey: text('field_key').notNull(),
    ownerPersonId: ref('owner_person_id'),
    ...immutable(),
  },
  (t) => [
    onIsland('island_field_island_fk', t).onDelete('restrict'),
    unique('island_field_key_uq').on(t.islandId, t.fieldKey),
    unique('island_field_island_uq').on(t.id, t.islandId),
  ],
);

export const islandObject = sqliteTable(
  'island_object',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    ownerPersonId: ref('owner_person_id').notNull(),
    catalogKey: text('catalog_key').notNull(),
    origin: text('origin').notNull(),
    level: small('level').notNull(),
    fieldId: ref('field_id'),
    ...mutable(),
  },
  (t) => [
    onIsland('island_object_island_fk', t),
    foreignKey({ name: 'island_object_field_fk', columns: [t.fieldId, t.islandId], foreignColumns: [islandField.id, islandField.islandId] }),
    uniqueIndex('island_object_field_uq').on(t.fieldId).where(sql`${t.fieldId} is not null and ${t.deletedAt} is null`),
    check('island_object_origin_check', oneOf(t.origin, objectOrigins)),
    check('island_object_level_check', sql`${t.level} between 1 and 3`),
  ],
);

export const communityProject = sqliteTable(
  'community_project',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    sequenceNumber: whole('sequence_number').notNull(),
    templateKey: text('template_key').notNull(),
    buildNeed: whole('build_need').notNull(),
    natureNeed: whole('nature_need').notNull(),
    status: text('status').notNull(),
    completedAt: instant('completed_at'),
    ...mutable(),
  },
  (t) => [
    onIsland('community_project_island_fk', t),
    unique('community_project_sequence_uq').on(t.islandId, t.sequenceNumber),
    uniqueIndex('community_project_active_uq').on(t.islandId).where(sql`${t.status} = 'aktiv'`),
    check('community_project_status_check', oneOf(t.status, ['aktiv', 'fertig'])),
    check('community_project_completed_check', sql`(${t.status} = 'fertig') = (${t.completedAt} is not null)`),
    check('community_project_need_check', sql`${t.sequenceNumber} > 0 and ${t.buildNeed} > 0 and ${t.natureNeed} > 0`),
  ],
);

export const energyBooking = sqliteTable(
  'energy_booking',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    amount: whole('amount').notNull(),
    localDate: localDate('local_date').notNull(),
    bookingKey: text('booking_key').notNull(),
    trigger: json<Record<string, unknown>>('trigger').notNull(),
    dailyGoalCompletionId: ref('daily_goal_completion_id').references(() => dailyGoalCompletion.id, { onDelete: 'restrict' }),
    islandObjectId: ref('island_object_id').references(() => islandObject.id, { onDelete: 'restrict' }),
    communityProjectId: ref('community_project_id').references(() => communityProject.id, { onDelete: 'restrict' }),
    originalBookingId: ref('original_booking_id').references((): AnySQLiteColumn => energyBooking.id, { onDelete: 'restrict' }),
    ...immutable(),
  },
  (t) => [
    unique('energy_booking_key_uq').on(t.bookingKey),
    check('energy_booking_type_check', oneOf(t.type, bookingTypes)),
    check(
      'energy_booking_amount_check',
      sql`case when ${t.type} in ('daily_goal_credit', 'daily_bonus_credit') then ${t.amount} = 1 when ${t.type} = 'counter_booking' then ${t.amount} <> 0 else ${t.amount} < 0 end`,
    ),
    check(
      'energy_booking_reference_check',
      sql`(${t.dailyGoalCompletionId} is not null) = (${t.type} = 'daily_goal_credit') and (${t.islandObjectId} is not null) = (${t.type} in ('build_debit', 'upgrade_debit')) and (${t.communityProjectId} is not null) = (${t.type} = 'project_contribution_debit') and (${t.originalBookingId} is not null) = (${t.type} = 'counter_booking')`,
    ),
  ],
);

export const projectContribution = sqliteTable(
  'project_contribution',
  {
    id: id(),
    communityProjectId: ref('community_project_id')
      .notNull()
      .references(() => communityProject.id, { onDelete: 'restrict' }),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    amount: whole('amount').notNull(),
    energyBookingId: ref('energy_booking_id')
      .notNull()
      .references(() => energyBooking.id, { onDelete: 'restrict' }),
    commandId: ref('command_id').notNull(),
    ...immutable(),
  },
  (t) => [
    unique('project_contribution_booking_uq').on(t.energyBookingId),
    unique('project_contribution_command_uq').on(t.commandId),
    check('project_contribution_role_check', oneOf(t.role, IslandRole.options)),
    check('project_contribution_amount_check', sql`${t.amount} > 0`),
  ],
);

export const islandEvent = sqliteTable(
  'island_event',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    type: text('type').notNull(),
    templateKey: text('template_key'),
    responsiblePersonId: ref('responsible_person_id'),
    occasionKey: text('occasion_key').notNull(),
    status: text('status').notNull(),
    reward: json<Record<string, unknown>>('reward'),
    occurredAt: instant('occurred_at').notNull(),
    ...mutable(),
  },
  (t) => [
    onIsland('island_event_island_fk', t),
    unique('island_event_occasion_uq').on(t.islandId, t.occasionKey),
    check('island_event_type_check', oneOf(t.type, [...IslandEventKind.options, ...SharedEventType.options])),
    check('island_event_status_check', oneOf(t.status, eventStatuses)),
  ],
);

export const islandEventState = sqliteTable(
  'island_event_state',
  {
    id: id(),
    islandEventId: ref('island_event_id')
      .notNull()
      .references(() => islandEvent.id),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    seenAt: instant('seen_at'),
    claimedAt: instant('claimed_at'),
    ...mutable(),
  },
  (t) => [unique('island_event_state_person_uq').on(t.islandEventId, t.personId)],
);

export const momoAccessory = sqliteTable(
  'momo_accessory',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    catalogKey: text('catalog_key').notNull(),
    sourceEventId: ref('source_event_id')
      .notNull()
      .references(() => islandEvent.id, { onDelete: 'restrict' }),
    receivedAt: instant('received_at').notNull(),
    ...immutable(),
  },
  (t) => [onIsland('momo_accessory_island_fk', t).onDelete('restrict'), unique('momo_accessory_key_uq').on(t.islandId, t.catalogKey)],
);

export const momoOutfit = sqliteTable(
  'momo_outfit',
  {
    id: id(),
    islandId: ref('island_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    slot: text('slot').notNull(),
    accessoryKey: text('accessory_key'),
    ...mutable(),
  },
  (t) => [
    onIsland('momo_outfit_island_fk', t),
    foreignKey({
      name: 'momo_outfit_accessory_fk',
      columns: [t.islandId, t.accessoryKey],
      foreignColumns: [momoAccessory.islandId, momoAccessory.catalogKey],
    }),
    unique('momo_outfit_slot_uq').on(t.islandId, t.slot),
    check('momo_outfit_slot_check', oneOf(t.slot, ['kopf', 'hals'])),
  ],
);

export const challenge = sqliteTable(
  'challenge',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    templateKey: text('template_key').notNull(),
    proposerPersonId: ref('proposer_person_id').notNull(),
    status: text('status').notNull(),
    proposedAt: instant('proposed_at').notNull(),
    proposalExpiresAt: instant('proposal_expires_at').notNull(),
    startedAt: instant('started_at'),
    endsAt: instant('ends_at'),
    endedAt: instant('ended_at'),
    commonStage: text('common_stage'),
    challengeDecoKey: text('challenge_deco_key'),
    ...mutable(),
  },
  (t) => [
    unique('challenge_owner_uq').on(t.id, t.couplingId),
    uniqueIndex('challenge_open_uq').on(t.couplingId).where(sql`${t.status} in ('vorgeschlagen', 'aktiv')`),
    check('challenge_status_check', oneOf(t.status, ChallengeStatus.options)),
    check('challenge_common_stage_check', oneOf(t.commonStage, CommonStage.options)),
    check(
      'challenge_started_check',
      sql`(${t.startedAt} is not null) = (${t.status} in ('aktiv', 'geschafft', 'abgelaufen', 'beendet')) and (${t.startedAt} is null) = (${t.endsAt} is null)`,
    ),
    check('challenge_ended_check', sql`(${t.endedAt} is not null) = (${t.status} not in ('vorgeschlagen', 'aktiv'))`),
  ],
);

export const challengeRequirement = sqliteTable(
  'challenge_requirement',
  {
    id: id(),
    challengeId: ref('challenge_id').notNull(),
    couplingId: ref('coupling_id').notNull(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    requiredCount: whole('required_count'),
    ...mutable(),
  },
  (t) => [
    foreignKey({
      name: 'challenge_requirement_challenge_fk',
      columns: [t.challengeId, t.couplingId],
      foreignColumns: [challenge.id, challenge.couplingId],
    }),
    unique('challenge_requirement_person_uq').on(t.challengeId, t.personId),
    check('challenge_requirement_payload_check', sql`(${t.deletedAt} is null) = (${t.requiredCount} is not null) and ${t.requiredCount} > 0`),
  ],
);
