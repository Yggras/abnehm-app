import { sql } from 'drizzle-orm';
import { check, foreignKey, sqliteTable, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { AreaKey } from '@abnehm/contracts/base';
import { IslandRole } from '@abnehm/contracts/island';

import { flag, id, instant, json, localDate, mutable, oneOf, ref, small, text, whole } from './columns';

// Konto, Person und Kopplung (Spezifikation 0, Abschnitte 8 und 9; Personenfelder aus
// Spezifikation 1, Abschnitt 2). Lokal liegt nur die eigene Person; Spalten, die auch den Partner
// nennen können, haben deshalb keinen Fremdschlüssel auf `person` (siehe `partnerPersonColumns`).

export const person = sqliteTable(
  'person',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    displayName: text('display_name').notNull(),
    calculationSex: text('calculation_sex'),
    birthDate: localDate('birth_date'),
    heightCm: small('height_cm'),
    activityLevel: text('activity_level'),
    pregnantOrBreastfeeding: flag('pregnant_or_breastfeeding'),
    knownEatingDisorder: flag('known_eating_disorder'),
    disclaimerAcceptedAt: instant('disclaimer_accepted_at'),
    onboardingStatus: text('onboarding_status').notNull(),
    onboardingCompletedAt: instant('onboarding_completed_at'),
    goalWeightReachedG: whole('goal_weight_reached_g'),
    goalWeightReachedAt: instant('goal_weight_reached_at'),
    timeZone: text('time_zone').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('person_account_uq').on(t.accountId),
    check('person_calculation_sex_check', oneOf(t.calculationSex, ['maennlich', 'weiblich'])),
    check('person_activity_level_check', oneOf(t.activityLevel, ['wenig_aktiv', 'maessig_aktiv', 'aktiv'])),
    check('person_height_check', sql`${t.heightCm} between 120 and 230`),
    check('person_onboarding_status_check', oneOf(t.onboardingStatus, ['begonnen', 'abgeschlossen'])),
    check(
      'person_onboarding_completed_check',
      sql`(${t.onboardingStatus} = 'abgeschlossen') = (${t.onboardingCompletedAt} is not null)`,
    ),
    check(
      'person_onboarding_fields_check',
      sql`${t.onboardingStatus} = 'begonnen' or (${t.calculationSex} is not null and ${t.birthDate} is not null and ${t.heightCm} is not null and ${t.activityLevel} is not null and ${t.pregnantOrBreastfeeding} is not null and ${t.knownEatingDisorder} is not null and ${t.disclaimerAcceptedAt} is not null)`,
    ),
    check('person_goal_weight_reached_check', sql`(${t.goalWeightReachedG} is null) = (${t.goalWeightReachedAt} is null)`),
  ],
);

export const coupling = sqliteTable(
  'coupling',
  {
    id: id(),
    personLowId: ref('person_low_id').notNull(),
    personHighId: ref('person_high_id').notNull(),
    status: text('status').notNull(),
    startedAt: instant('started_at').notNull(),
    endedAt: instant('ended_at'),
    reactivatedAt: instant('reactivated_at'),
    ...mutable(),
  },
  (t) => [
    unique('coupling_pair_uq').on(t.personLowId, t.personHighId),
    unique('coupling_id_status_uq').on(t.id, t.status),
    check('coupling_status_check', oneOf(t.status, ['aktiv', 'archiviert'])),
    check('coupling_pair_order_check', sql`${t.personLowId} < ${t.personHighId}`),
    check('coupling_ended_check', sql`(${t.status} = 'archiviert') = (${t.endedAt} is not null)`),
  ],
);

export const couplingMember = sqliteTable(
  'coupling_member',
  {
    id: id(),
    couplingId: ref('coupling_id').notNull(),
    /** Spiegel des Kopplungsstatus, per `ON UPDATE CASCADE` mitgeführt (wie in Postgres). */
    couplingStatus: text('coupling_status').notNull(),
    personId: ref('person_id').notNull(),
    role: text('role'),
    displayName: text('display_name').notNull(),
    ...mutable(),
  },
  (t) => [
    foreignKey({
      name: 'coupling_member_coupling_fk',
      columns: [t.couplingId, t.couplingStatus],
      foreignColumns: [coupling.id, coupling.status],
    }).onUpdate('cascade'),
    unique('coupling_member_person_uq').on(t.couplingId, t.personId),
    uniqueIndex('coupling_member_active_person_uq').on(t.personId).where(sql`${t.couplingStatus} = 'aktiv'`),
    uniqueIndex('coupling_member_role_uq').on(t.couplingId, t.role).where(sql`${t.role} is not null`),
    check('coupling_member_role_check', oneOf(t.role, IslandRole.options)),
  ],
);

export const sharedAction = sqliteTable(
  'shared_action',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    kind: text('kind').notNull(),
    requesterPersonId: ref('requester_person_id').notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    status: text('status').notNull(),
    decidedAt: instant('decided_at'),
    ...mutable(),
  },
  (t) => [
    check('shared_action_kind_check', oneOf(t.kind, ['rollenwahl', 'rollentausch', 'entkoppeln', 'deko_schenken'])),
    check('shared_action_status_check', oneOf(t.status, ['offen', 'angenommen', 'abgelehnt', 'zurueckgezogen'])),
    check('shared_action_decided_check', sql`(${t.status} = 'offen') = (${t.decidedAt} is null)`),
    uniqueIndex('shared_action_open_role_choice_uq')
      .on(t.couplingId)
      .where(sql`${t.kind} = 'rollenwahl' and ${t.status} = 'offen'`),
  ],
);

export const partnerSharing = sqliteTable(
  'partner_sharing',
  {
    id: id(),
    ownerPersonId: ref('owner_person_id')
      .notNull()
      .references(() => person.id),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    area: text('area').notNull(),
    level: text('level').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('partner_sharing_area_uq').on(t.ownerPersonId, t.couplingId, t.area),
    check('partner_sharing_area_check', oneOf(t.area, AreaKey.options)),
    check('partner_sharing_level_check', oneOf(t.level, ['privat', 'zusammengefasst'])),
  ],
);

export const photoSharing = sqliteTable(
  'photo_sharing',
  {
    id: id(),
    ownerPersonId: ref('owner_person_id')
      .notNull()
      .references(() => person.id),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    level: text('level').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('photo_sharing_owner_uq').on(t.ownerPersonId, t.couplingId),
    check('photo_sharing_level_check', oneOf(t.level, ['privat', 'geteilt'])),
  ],
);
