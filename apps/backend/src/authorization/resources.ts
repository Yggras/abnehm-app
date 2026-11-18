import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { Clock } from '@abnehm/clock';
import { EntityId, TimeZone } from '@abnehm/contracts/base';

import type { DbExecutor } from '../database.ts';
import {
  account,
  areaUnlock,
  blueprintUnlock,
  budgetSuggestion,
  challenge,
  challengeRequirement,
  changeLog,
  communityProject,
  coupling,
  couplingMember,
  dailyGoal,
  dailyGoalCompletion,
  deliveryAttempt,
  encouragement,
  energyBooking,
  foodFavorite,
  goalVersion,
  invitation,
  island,
  islandEvent,
  islandEventState,
  islandField,
  islandObject,
  islandProgress,
  mealFavorite,
  mealPhoto,
  momoAccessory,
  momoOutfit,
  notificationIntent,
  notificationSetting,
  nutritionEntry,
  onlineRequest,
  ownFood,
  partnerDailyGoalStatus,
  partnerSharing,
  partnerSummary,
  person,
  photoDraft,
  photoSharing,
  processedOperation,
  projectContribution,
  projectionInvalidation,
  pushInstallation,
  revocationNotice,
  securityLog,
  session,
  sharedAction,
  sportEntry,
  syncClock,
  user,
  verification,
  waterEntry,
  weeklyPlanVersion,
  weightEntry,
} from '../db/schema/index.ts';
import type { Operation } from './policy.ts';

// Ressourcenregeln der Operationsmatrix (Spezifikation 0, Abschnitt 11). Jede Tabelle des Schemas
// gehört genau einer Ressourcenklasse an. Eine Regel liest Eigentum, Mitgliedschaft und Freigaben
// ausschließlich aus Postgres; eine ID aus dem Client dient nur dazu, die Ressource zu finden.

export type ResourceClass =
  | 'eigene_eintraege'
  | 'zielversionen'
  | 'fachbuchungen'
  | 'kopplungsinhalte'
  | 'inselfortschritt'
  | 'personenstand'
  | 'anfeuern'
  | 'partnerfreigabe'
  | 'partner_zusammenfassung'
  | 'partner_tageszielstatus'
  | 'widerrufshinweis'
  | 'fotofreigabe'
  | 'partnerfoto'
  | 'push_installation'
  | 'serverdaten';

/** Wer handelt: Konto und Sitzung aus der Sitzung, die Person aus dem Konto (vor dem Bootstrap keine). */
export type Actor = Readonly<{ accountId: EntityId; sessionId: EntityId; personId: EntityId | null }>;

/** Eine handelnde Person; nur sie führt Ressourcenoperationen aus. */
export type PersonActor = Actor & Readonly<{ personId: EntityId }>;

/** Was der Client über die Ressource sagt; nichts davon begründet Zugriff. */
export type ResourceTarget = Readonly<{
  /** ID der Ressource; bei einer neuen Ressource die vom Client vergebene. */
  id?: unknown;
  /** Eigentums- bzw. Absenderfeld der Nutzlast; weicht es von der Person der Sitzung ab, ist das verboten. */
  claimedOwnerPersonId?: unknown;
  /** Beteiligung, die eine Entscheidung über eine gemeinsame Aktion voraussetzt; die Regel prüft sie. */
  claimedParticipation?: SharedActionParticipation;
}>;

/** Wer an einer gemeinsamen Aktion beteiligt ist: wer sie beantragt hat, oder der Partner, der antwortet. */
export type SharedActionParticipation = 'antragsteller' | 'partner';

/** Die maßgeblichen Fakten zur Ressource, aus Postgres gelesen; Fachlogik verwendet nur diese. */
export type ResourceFacts = Readonly<{
  /** `false`, wenn die Operation eine neue Ressource der handelnden Person anlegt. */
  exists: boolean;
  ownerPersonId: EntityId | null;
  couplingId: EntityId | null;
  /** Der Partner der handelnden Person in der maßgeblichen aktiven Kopplung. */
  partnerPersonId: EntityId | null;
}>;

export type Decision = Readonly<{ type: 'erlaubt'; facts: ResourceFacts }> | Readonly<{ type: 'verweigert' }>;

export const denied: Decision = { type: 'verweigert' };

export type RuleContext = Readonly<{
  db: DbExecutor;
  actor: PersonActor;
  operation: Operation;
  target: ResourceTarget;
  clock: Clock;
}>;

/** Spalte mit einer UUID, etwa Primärschlüssel, Eigentümer oder Kopplung. */
type IdColumn = AnyPgColumn<{ data: string }>;

type EntityRule<C extends ResourceClass = ResourceClass, L extends 'id' | 'akteur' = 'id' | 'akteur'> = Readonly<{
  resourceClass: C;
  /** Tabelle der Ressource; fehlt nur bei Ressourcen ohne eigene Zeile. */
  table: PgTable | null;
  /** `id`: per ID aus dem Client gefunden; `akteur`: allein aus der Sitzung bestimmt. */
  locatedBy: L;
  /** Engere Auswahl als die Klasse, etwa nur Lesen für die Fotoliste. */
  onlyOperations?: readonly Operation[];
  /** Verweigertes Lesen ist ein Fotozugriff und landet im Sicherheitslog (#22). */
  photoAccess?: 'fotoliste' | 'bildabruf';
  check(context: RuleContext): Promise<Decision>;
}>;

const idOrNull = (value: string | null | undefined) => (value === null || value === undefined ? null : EntityId.parse(value));
const allowed = (facts: {
  exists?: boolean;
  ownerPersonId?: string | null;
  couplingId?: string | null;
  partnerPersonId?: string | null;
}): Decision => ({
  type: 'erlaubt',
  facts: {
    exists: facts.exists ?? true,
    ownerPersonId: idOrNull(facts.ownerPersonId),
    couplingId: idOrNull(facts.couplingId),
    partnerPersonId: idOrNull(facts.partnerPersonId),
  },
});

async function first<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

/** Regel einer per ID gefundenen Ressource; eine ID, die keine UUID ist, findet nichts. */
function byId<C extends ResourceClass>(
  resourceClass: C,
  table: PgTable,
  check: (context: RuleContext, id: EntityId) => Promise<Decision>,
  options: Pick<EntityRule, 'onlyOperations' | 'photoAccess'> = {},
): EntityRule<C, 'id'> {
  return {
    resourceClass,
    table,
    locatedBy: 'id',
    ...options,
    async check(context) {
      const id = EntityId.safeParse(context.target.id);
      return id.success ? check(context, id.data) : denied;
    },
  };
}

/** Partner der Person, wenn sie aktives Mitglied der Kopplung ist; sonst `null`. */
async function activeMembership(db: DbExecutor, couplingId: string, personId: string): Promise<{ partnerPersonId: string } | null> {
  const members = await db
    .select({ personId: couplingMember.personId })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.couplingStatus, 'aktiv')));
  const partner = members.find((member) => member.personId !== personId);
  if (partner === undefined || !members.some((member) => member.personId === personId)) return null;
  return { partnerPersonId: partner.personId };
}

/** Die aktive Kopplung der Person samt Partner. */
async function activeCouplingOf(db: DbExecutor, personId: string): Promise<{ couplingId: string; partnerPersonId: string } | null> {
  const own = await first(
    db
      .select({ couplingId: couplingMember.couplingId })
      .from(couplingMember)
      .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv'))),
  );
  if (own === null) return null;
  const membership = await activeMembership(db, own.couplingId, personId);
  return membership === null ? null : { couplingId: own.couplingId, ...membership };
}

/** Ob die Operation eine Ressource anlegen kann, wenn es die ID noch nicht gibt. */
const creates = (operation: Operation) => operation === 'upsert' || operation === 'befehl';

/**
 * Ressource mit einem Eigentümer. Lesen, Ändern und Fachbefehle nur durch ihn; eine unbekannte ID
 * legt die handelnde Person nur an, wo die Ressource vom Client stammt (`creatable`).
 */
function owned<C extends ResourceClass>(
  resourceClass: C,
  table: PgTable,
  columns: { id: IdColumn; owner: IdColumn },
  { creatable }: { creatable: boolean },
): EntityRule<C, 'id'> {
  return byId(resourceClass, table, async (context, id) => {
    const { personId } = context.actor;
    const found = await first(context.db.select({ owner: columns.owner }).from(table).where(eq(columns.id, id)));
    if (found !== null) return found.owner === personId ? allowed({ ownerPersonId: personId }) : denied;
    return creatable && creates(context.operation) ? allowed({ exists: false, ownerPersonId: personId }) : denied;
  });
}

/** Inhalt einer Kopplung: nur aktive Mitglieder, und nur über Fachbefehle bzw. den Server. */
function coupled<C extends ResourceClass>(resourceClass: C, table: PgTable, columns: { id: IdColumn; coupling: IdColumn }): EntityRule<C, 'id'> {
  return byId(resourceClass, table, async (context, id) => {
    const found = await first(context.db.select({ couplingId: columns.coupling }).from(table).where(eq(columns.id, id)));
    if (found === null || found.couplingId === null) return denied;
    const membership = await activeMembership(context.db, found.couplingId, context.actor.personId);
    return membership === null ? denied : allowed({ couplingId: found.couplingId, ...membership });
  });
}

type ProjectionColumns = {
  id: IdColumn;
  coupling: IdColumn;
  owner: IdColumn;
  recipient: IdColumn;
  deletedAt: AnyPgColumn<{ data: Date }>;
  /** Bereich einer Zusammenfassung; dann gilt zusätzlich dessen Partnerfreigabe. */
  area?: AnyPgColumn<{ data: string }>;
};

/**
 * Projektion für genau einen Empfänger: nur die bezeichnete empfangende Person, solange die Kopplung
 * aktiv und die Projektion nicht gelöscht ist; mit Bereich nur bei dessen Freigabe `zusammengefasst`.
 */
function addressedProjection<C extends ResourceClass>(resourceClass: C, table: PgTable, columns: ProjectionColumns): EntityRule<C, 'id'> {
  return byId(resourceClass, table, async (context, id) => {
    const { personId } = context.actor;
    const found = await first(
      context.db
        .select({
          couplingId: columns.coupling,
          owner: columns.owner,
          recipient: columns.recipient,
          deletedAt: columns.deletedAt,
          area: columns.area ?? sql<string | null>`null`,
        })
        .from(table)
        .where(eq(columns.id, id)),
    );
    if (found === null || found.recipient !== personId || found.deletedAt !== null) return denied;
    if (found.couplingId === null || found.owner === null) return denied;
    const membership = await activeMembership(context.db, found.couplingId, personId);
    if (membership === null) return denied;
    if (found.area !== null && (await sharingLevel(context.db, found.owner, found.couplingId, found.area)) !== 'zusammengefasst') {
      return denied;
    }
    return allowed({ ownerPersonId: found.owner, couplingId: found.couplingId, ...membership });
  });
}

/** Nur der Server; kein allgemeiner Clientzugriff. */
function serverOnly(table: PgTable): EntityRule<'serverdaten', 'id'> {
  return { resourceClass: 'serverdaten', table, locatedBy: 'id', check: async () => denied };
}

async function sharingLevel(db: DbExecutor, ownerPersonId: string, couplingId: string, area: string) {
  const found = await first(
    db
      .select({ level: partnerSharing.level })
      .from(partnerSharing)
      .where(and(eq(partnerSharing.ownerPersonId, ownerPersonId), eq(partnerSharing.couplingId, couplingId), eq(partnerSharing.area, area))),
  );
  return found?.level ?? 'privat';
}

async function photoSharingLevel(db: DbExecutor, ownerPersonId: string, couplingId: string) {
  const found = await first(
    db
      .select({ level: photoSharing.level })
      .from(photoSharing)
      .where(and(eq(photoSharing.ownerPersonId, ownerPersonId), eq(photoSharing.couplingId, couplingId))),
  );
  return found?.level ?? 'privat';
}

/** Aktueller lokaler Tag des Eigentümers in der `time_zone` seiner Person. */
async function ownerToday(context: RuleContext, ownerPersonId: string): Promise<string | null> {
  const owner = await first(context.db.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, ownerPersonId)));
  return owner === null ? null : context.clock.read(TimeZone.parse(owner.timeZone)).localDate;
}

/**
 * Mahlzeitenfoto: der Eigentümer immer, der Partner nur nach den Sichtbarkeitsregeln aus Abschnitt 5
 * (aktive Kopplung, Fotofreigabe `geteilt`, Schalter des Fotos an, nicht gelöscht und mindestens ein
 * nicht gelöschter Ernährungseintrag des Fotos am aktuellen lokalen Tag des Eigentümers).
 */
const mealPhotoRule = byId(
  'partnerfoto',
  mealPhoto,
  async (context, id) => {
    const { personId } = context.actor;
    const photo = await first(
      context.db
        .select({ owner: mealPhoto.personId, shared: mealPhoto.sharedWithPartner, deletedAt: mealPhoto.deletedAt })
        .from(mealPhoto)
        .where(eq(mealPhoto.id, id)),
    );
    if (photo === null) return creates(context.operation) ? allowed({ exists: false, ownerPersonId: personId }) : denied;
    if (photo.owner === personId) return allowed({ ownerPersonId: personId });
    if (context.operation !== 'lesen' || !photo.shared || photo.deletedAt !== null) return denied;
    const membership = await activeCouplingOf(context.db, personId);
    if (membership?.partnerPersonId !== photo.owner) return denied;
    if ((await photoSharingLevel(context.db, photo.owner, membership.couplingId)) !== 'geteilt') return denied;
    const today = await ownerToday(context, photo.owner);
    if (today === null) return denied;
    const entry = await first(
      context.db
        .select({ id: nutritionEntry.id })
        .from(nutritionEntry)
        .where(
          and(
            eq(nutritionEntry.mealPhotoId, id),
            eq(nutritionEntry.personId, photo.owner),
            eq(nutritionEntry.localDate, today),
            isNull(nutritionEntry.deletedAt),
          ),
        )
        .limit(1),
    );
    return entry !== null ? allowed({ ownerPersonId: photo.owner, ...membership }) : denied;
  },
  { photoAccess: 'bildabruf' },
);

/** Fotoliste des Partners: ohne Parameter, der Eigentümer ist der Partner aus der aktiven Kopplung. */
const partnerPhotoListRule = {
  resourceClass: 'partnerfoto',
  table: null,
  locatedBy: 'akteur',
  onlyOperations: ['lesen'],
  photoAccess: 'fotoliste',
  async check(context: RuleContext) {
    const membership = await activeCouplingOf(context.db, context.actor.personId);
    if (membership === null) return denied;
    if ((await photoSharingLevel(context.db, membership.partnerPersonId, membership.couplingId)) !== 'geteilt') return denied;
    return allowed({ ownerPersonId: membership.partnerPersonId, ...membership });
  },
} as const satisfies EntityRule<'partnerfoto', 'akteur'>;

async function encouragementOf(db: DbExecutor, id: string) {
  return first(
    db
      .select({ couplingId: encouragement.couplingId, sender: encouragement.senderPersonId, recipient: encouragement.recipientPersonId })
      .from(encouragement)
      .where(eq(encouragement.id, id)),
  );
}

/** Anfeuerung lesen (beide aktiven Mitglieder) und danken (nur der Empfänger). */
const encouragementRule = byId('anfeuern', encouragement, async (context, id) => {
  const { personId } = context.actor;
  const found = await encouragementOf(context.db, id);
  if (found === null) return denied;
  const involved = context.operation === 'lesen' ? [found.sender, found.recipient] : [found.recipient];
  if (!involved.includes(personId)) return denied;
  const membership = await activeMembership(context.db, found.couplingId, personId);
  return membership === null ? denied : allowed({ ownerPersonId: found.sender, couplingId: found.couplingId, ...membership });
});

/**
 * Anfeuerung senden: nur als aktives Mitglied, Empfänger ist immer der Partner aus der Kopplung. Ein
 * Retry derselben ID durch den Absender ist erlaubt, damit der Fachbefehl idempotent bleibt.
 */
const encouragementSendRule = byId(
  'anfeuern',
  encouragement,
  async (context, id) => {
    const { personId } = context.actor;
    const found = await encouragementOf(context.db, id);
    if (found !== null && found.sender !== personId) return denied;
    const membership = await activeCouplingOf(context.db, personId);
    if (membership === null || (found !== null && found.couplingId !== membership.couplingId)) return denied;
    return allowed({ exists: found !== null, ownerPersonId: personId, ...membership });
  },
  { onlyOperations: ['befehl'] },
);

async function sharedActionOf(db: DbExecutor, id: string) {
  return first(
    db
      .select({ couplingId: sharedAction.couplingId, requester: sharedAction.requesterPersonId, kind: sharedAction.kind })
      .from(sharedAction)
      .where(eq(sharedAction.id, id)),
  );
}

/**
 * Gemeinsame Aktion: aktive Mitglieder ihrer Kopplung. Eine Entkopplung liest nur, wer sie beantragt
 * hat, und zwar auch danach: Sie ist inhaltsfrei, und nur so erfährt sein Gerät das Ergebnis. Der
 * Partner liest sie nie (Spezifikation 5, Abschnitt 11); er erhält den Intent `entkopplung`.
 */
const sharedActionRule = byId('kopplungsinhalte', sharedAction, async (context, id) => {
  const { personId } = context.actor;
  const found = await sharedActionOf(context.db, id);
  if (found === null) return denied;
  if (found.kind === 'entkoppeln') {
    const ownUncoupling = context.operation === 'lesen' && found.requester === personId;
    return ownUncoupling ? allowed({ ownerPersonId: personId, couplingId: found.couplingId }) : denied;
  }
  const membership = await activeMembership(context.db, found.couplingId, personId);
  return membership === null ? denied : allowed({ ownerPersonId: found.requester, couplingId: found.couplingId, ...membership });
});

/**
 * Gemeinsame Aktion beantragen: nur als aktives Mitglied, in der eigenen Kopplung. Ein Retry derselben
 * ID durch den Antragsteller ist erlaubt, damit der Fachbefehl idempotent bleibt.
 */
const sharedActionRequestRule = byId(
  'kopplungsinhalte',
  sharedAction,
  async (context, id) => {
    const { personId } = context.actor;
    const found = await sharedActionOf(context.db, id);
    if (found !== null && found.requester !== personId) return denied;
    const membership = await activeCouplingOf(context.db, personId);
    if (membership === null || (found !== null && found.couplingId !== membership.couplingId)) return denied;
    return allowed({ exists: found !== null, ownerPersonId: personId, ...membership });
  },
  { onlyOperations: ['befehl'] },
);

/**
 * Über eine gemeinsame Aktion entscheiden: nur aktive Mitglieder ihrer Kopplung und nur in der
 * beanspruchten Beteiligung. `partner` (annehmen, ablehnen) ist die Person, die nicht beantragt hat,
 * `antragsteller` (zurückziehen) die, die beantragt hat.
 */
const sharedActionDecisionRule = byId(
  'kopplungsinhalte',
  sharedAction,
  async (context, id) => {
    const { personId } = context.actor;
    const found = await sharedActionOf(context.db, id);
    if (found === null) return denied;
    const membership = await activeMembership(context.db, found.couplingId, personId);
    if (membership === null) return denied;
    const participation: SharedActionParticipation = found.requester === personId ? 'antragsteller' : 'partner';
    if (context.target.claimedParticipation !== participation) return denied;
    return allowed({ ownerPersonId: found.requester, couplingId: found.couplingId, ...membership });
  },
  { onlyOperations: ['befehl'] },
);

/**
 * Auf ein Inselfeld bauen (`buildObject`): nur auf ein eigenes Feld und nur als aktives Mitglied der
 * Kopplung, der die Insel gehört. Felder des Partners und gemeinsame Bereiche ohne Besitzer sind damit
 * verboten, ebenso eine archivierte Kopplung (Spezifikation 4, Abschnitt 3; Spezifikation 0, Abschnitt 11).
 */
const ownFieldRule = byId(
  'kopplungsinhalte',
  islandField,
  async (context, id) => {
    const { personId } = context.actor;
    const found = await first(
      context.db.select({ couplingId: islandField.couplingId, owner: islandField.ownerPersonId }).from(islandField).where(eq(islandField.id, id)),
    );
    if (found?.owner !== personId) return denied;
    const membership = await activeMembership(context.db, found.couplingId, personId);
    return membership === null ? denied : allowed({ ownerPersonId: personId, couplingId: found.couplingId, ...membership });
  },
  { onlyOperations: ['befehl'] },
);

/** Revocation-Notice: nur der ehemals bezeichnete Empfänger, auch nach Rechteentzug. */
const revocationNoticeRule = byId('widerrufshinweis', revocationNotice, async (context, id) => {
  const found = await first(
    context.db
      .select({ recipient: revocationNotice.recipientPersonId, couplingId: revocationNotice.couplingId })
      .from(revocationNotice)
      .where(eq(revocationNotice.id, id)),
  );
  return found?.recipient === context.actor.personId ? allowed({ couplingId: found.couplingId }) : denied;
});

/** Archivstatus der gemeinsamen Kopplung: lesbar für beide, auch ehemalige Mitglieder. */
const couplingArchiveStatusRule = byId('widerrufshinweis', coupling, async (context, id) => {
  const member = await first(
    context.db
      .select({ couplingId: couplingMember.couplingId })
      .from(couplingMember)
      .where(and(eq(couplingMember.couplingId, id), eq(couplingMember.personId, context.actor.personId))),
  );
  return member === null ? denied : allowed({ couplingId: member.couplingId });
});

const ownedBy = (table: PgTable & { id: IdColumn; personId: IdColumn }) => ({ id: table.id, owner: table.personId });
const inCoupling = (table: PgTable & { id: IdColumn; couplingId: IdColumn }) => ({ id: table.id, coupling: table.couplingId });

/** Alle Ressourcen der Matrix; jede Tabelle des Schemas kommt hier oder in `resourceParts` vor. */
export const resourceEntities = {
  // Eigene veränderliche Einträge und Einstellungen. Die Person legt nur der Bootstrap an, den
  // Fotoentwurf nur die Fotoanalyse.
  person: owned('eigene_eintraege', person, { id: person.id, owner: person.id }, { creatable: false }),
  water_entry: owned('eigene_eintraege', waterEntry, ownedBy(waterEntry), { creatable: true }),
  sport_entry: owned('eigene_eintraege', sportEntry, ownedBy(sportEntry), { creatable: true }),
  weight_entry: owned('eigene_eintraege', weightEntry, ownedBy(weightEntry), { creatable: true }),
  own_food: owned('eigene_eintraege', ownFood, ownedBy(ownFood), { creatable: true }),
  food_favorite: owned('eigene_eintraege', foodFavorite, ownedBy(foodFavorite), { creatable: true }),
  meal_favorite: owned('eigene_eintraege', mealFavorite, ownedBy(mealFavorite), { creatable: true }),
  nutrition_entry: owned('eigene_eintraege', nutritionEntry, ownedBy(nutritionEntry), { creatable: true }),
  photo_draft: owned('eigene_eintraege', photoDraft, ownedBy(photoDraft), { creatable: false }),
  notification_setting: owned('eigene_eintraege', notificationSetting, ownedBy(notificationSetting), { creatable: true }),
  // Ziel-/Wochenplanversion, Tagesziel und der Budgetvorschlag, den nur `acceptBudgetSuggestion` ändert.
  goal_version: owned('zielversionen', goalVersion, ownedBy(goalVersion), { creatable: true }),
  weekly_plan_version: owned('zielversionen', weeklyPlanVersion, ownedBy(weeklyPlanVersion), { creatable: true }),
  daily_goal: owned('zielversionen', dailyGoal, ownedBy(dailyGoal), { creatable: true }),
  budget_suggestion: owned('zielversionen', budgetSuggestion, ownedBy(budgetSuggestion), { creatable: true }),
  // Tageszielerfüllung, Energiebuchung, Projekteinzahlung.
  daily_goal_completion: owned('fachbuchungen', dailyGoalCompletion, ownedBy(dailyGoalCompletion), { creatable: true }),
  energy_booking: owned('fachbuchungen', energyBooking, ownedBy(energyBooking), { creatable: true }),
  project_contribution: owned('fachbuchungen', projectContribution, ownedBy(projectContribution), { creatable: true }),
  // Kopplung und ihre Inhalte.
  coupling: coupled('kopplungsinhalte', coupling, { id: coupling.id, coupling: coupling.id }),
  coupling_member: coupled('kopplungsinhalte', couplingMember, inCoupling(couplingMember)),
  island: coupled('kopplungsinhalte', island, inCoupling(island)),
  shared_action: sharedActionRule,
  shared_action_request: sharedActionRequestRule,
  shared_action_decision: sharedActionDecisionRule,
  challenge: coupled('kopplungsinhalte', challenge, inCoupling(challenge)),
  blueprint_unlock: coupled('kopplungsinhalte', blueprintUnlock, inCoupling(blueprintUnlock)),
  area_unlock: coupled('kopplungsinhalte', areaUnlock, inCoupling(areaUnlock)),
  island_field: coupled('kopplungsinhalte', islandField, inCoupling(islandField)),
  island_field_build: ownFieldRule,
  island_object: coupled('kopplungsinhalte', islandObject, inCoupling(islandObject)),
  community_project: coupled('kopplungsinhalte', communityProject, inCoupling(communityProject)),
  island_event: coupled('kopplungsinhalte', islandEvent, inCoupling(islandEvent)),
  momo_accessory: coupled('kopplungsinhalte', momoAccessory, inCoupling(momoAccessory)),
  momo_outfit: coupled('kopplungsinhalte', momoOutfit, inCoupling(momoOutfit)),
  island_progress: coupled('inselfortschritt', islandProgress, inCoupling(islandProgress)),
  // Ereignisstand und Challenge-Anforderung je Person; beide legt der Server an.
  island_event_state: owned('personenstand', islandEventState, ownedBy(islandEventState), { creatable: false }),
  challenge_requirement: owned('personenstand', challengeRequirement, ownedBy(challengeRequirement), { creatable: false }),
  encouragement: encouragementRule,
  encouragement_send: encouragementSendRule,
  // Freigaben legt die Kopplungsannahme an; ändern darf sie nur der Eigentümer.
  partner_sharing: owned('partnerfreigabe', partnerSharing, { id: partnerSharing.id, owner: partnerSharing.ownerPersonId }, { creatable: false }),
  photo_sharing: owned('fotofreigabe', photoSharing, { id: photoSharing.id, owner: photoSharing.ownerPersonId }, { creatable: false }),
  partner_summary: addressedProjection('partner_zusammenfassung', partnerSummary, {
    id: partnerSummary.id,
    coupling: partnerSummary.couplingId,
    owner: partnerSummary.ownerPersonId,
    recipient: partnerSummary.recipientPersonId,
    deletedAt: partnerSummary.deletedAt,
    area: partnerSummary.area,
  }),
  partner_daily_goal_status: addressedProjection('partner_tageszielstatus', partnerDailyGoalStatus, {
    id: partnerDailyGoalStatus.id,
    coupling: partnerDailyGoalStatus.couplingId,
    owner: partnerDailyGoalStatus.ownerPersonId,
    recipient: partnerDailyGoalStatus.recipientPersonId,
    deletedAt: partnerDailyGoalStatus.deletedAt,
  }),
  revocation_notice: revocationNoticeRule,
  coupling_archive_status: couplingArchiveStatusRule,
  meal_photo: mealPhotoRule,
  partner_photo_list: partnerPhotoListRule,
  push_installation: owned('push_installation', pushInstallation, ownedBy(pushInstallation), { creatable: true }),
  // Kataloge, Sync-Log, verarbeitete Operationen, Sicherheitslog und alle übrigen Servertabellen.
  user: serverOnly(user),
  session: serverOnly(session),
  account: serverOnly(account),
  verification: serverOnly(verification),
  invitation: serverOnly(invitation),
  notification_intent: serverOnly(notificationIntent),
  delivery_attempt: serverOnly(deliveryAttempt),
  projection_invalidation: serverOnly(projectionInvalidation),
  sync_clock: serverOnly(syncClock),
  change_log: serverOnly(changeLog),
  processed_operation: serverOnly(processedOperation),
  online_request: serverOnly(onlineRequest),
  security_log: serverOnly(securityLog),
} as const satisfies Record<string, EntityRule>;

export type ResourceEntity = keyof typeof resourceEntities;

/** Tabellen ohne eigene Ressource: Sie gehören zu der genannten und werden nur mit ihr geändert. */
export const resourceParts: Readonly<Record<string, ResourceEntity>> = {
  meal_favorite_item: 'meal_favorite',
  weekly_plan_day: 'weekly_plan_version',
};
