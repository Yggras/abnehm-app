import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core';

import { AreaKey } from '@abnehm/contracts/base';
import { IslandRole } from '@abnehm/contracts/island';

import { user } from './auth.ts';
import { flag, id, instant, json, localDate, mutable, oneOf, ref, small, text, whole } from './columns.ts';

// Konto, Person und Kopplung (Spezifikation 0, Abschnitte 8 und 9; Personenfelder aus
// Spezifikation 1, Abschnitt 2). Konto und Sitzung liegen in den Better-Auth-Tabellen des
// Auth-Moduls (`auth.ts`); außerhalb davon gibt es keine E-Mail-Spalte.

export const person = pgTable(
  'person',
  {
    id: id(),
    /** Better-Auth-Konto; servergesetzt, eindeutig und unveränderlich. */
    accountId: ref('account_id')
      .notNull()
      .unique('person_account_uq')
      .references(() => user.id),
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
    /** Aktuelle IANA-Zone; ändert ausschließlich `updatePersonTimeZone`. */
    timeZone: text('time_zone').notNull(),
    ...mutable(),
  },
  (t) => [
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

export const coupling = pgTable(
  'coupling',
  {
    id: id(),
    /** Das ungeordnete Personenpaar, sortiert gespeichert, damit es höchstens eine Kopplung gibt. */
    personLowId: ref('person_low_id')
      .notNull()
      .references(() => person.id),
    personHighId: ref('person_high_id')
      .notNull()
      .references(() => person.id),
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

export const couplingMember = pgTable(
  'coupling_member',
  {
    id: id(),
    couplingId: ref('coupling_id').notNull(),
    /**
     * Spiegel des Kopplungsstatus, per `ON UPDATE CASCADE` mitgeführt. Nur so erzwingt ein
     * partieller Unique-Index „höchstens eine aktive Kopplung je Person“.
     */
    couplingStatus: text('coupling_status').notNull(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    /** Bis zum Schlüpfen leer, danach genau einmal `bauen` und `natur`. */
    role: text('role'),
    /** Setzt nur der Server; einzige Quelle für den Partnernamen auf dem Partnergerät. */
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

/** Einladungscode: nur der HMAC, nie der Klartext; nur Postgres. */
export const invitation = pgTable(
  'invitation',
  {
    id: id(),
    inviterPersonId: ref('inviter_person_id')
      .notNull()
      .references(() => person.id),
    codeHmac: text('code_hmac').notNull(),
    expiresAt: instant('expires_at').notNull(),
    consumedAt: instant('consumed_at'),
    consumedByPersonId: ref('consumed_by_person_id').references(() => person.id),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('invitation_open_code_uq').on(t.codeHmac).where(sql`${t.consumedAt} is null`),
    check('invitation_consumed_check', sql`(${t.consumedAt} is null) = (${t.consumedByPersonId} is null)`),
  ],
);

export const sharedAction = pgTable(
  'shared_action',
  {
    id: id(),
    couplingId: ref('coupling_id')
      .notNull()
      .references(() => coupling.id),
    kind: text('kind').notNull(),
    requesterPersonId: ref('requester_person_id')
      .notNull()
      .references(() => person.id),
    /** Typisierte Nutzlast je Art, an der Anwendungsgrenze mit `SharedAction` validiert. */
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

export const partnerSharing = pgTable(
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

export const photoSharing = pgTable(
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
