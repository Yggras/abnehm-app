import { and, asc, eq, inArray, lte } from 'drizzle-orm';

import { readingOf } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import {
  challengeUnfitContext,
  DecideChallengeProposal,
  decideChallengeProposalKey,
  ProposeChallenge,
  proposeChallengeKey,
  WithdrawChallengeProposal,
  withdrawChallengeProposalKey,
} from '@abnehm/contracts/island';
import { ChallengeRecord, challengeRequirementId, ChallengeRequirementRecord } from '@abnehm/contracts/island-records';
import { notificationIntentId } from '@abnehm/contracts/notifications';
import type { PlanReader } from '@abnehm/contracts/ports';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import { indexCatalog, type ChallengeTemplate } from '@abnehm/game-rules/catalog';
import { challengeDays, challengeEndsAt, challengeProposalExpiresAt, challengeShare, proposalOpen } from '@abnehm/game-rules/challenges';
import { gameCatalog } from '@abnehm/game-rules/content';

import { policies } from '../authorization/authorization.ts';
import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { UncouplingObserver } from '../coupling/uncoupling.ts';
import type { DbExecutor } from '../database.ts';
import { challenge, challengeRequirement, couplingMember, person } from '../db/schema/index.ts';
import type { ReaderPort } from '../partner-projections/projector.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { insertNotificationIntent } from '../sync/notification-intents.ts';
import { iso, isoOrNull, serverManaged } from '../sync/registry.ts';
import { canonicalAfterWrite, type PrePullStep } from '../sync/sync.ts';

// Gemeinsame Challenges auf dem Server: Vorschlag, Annahme und Verfall (Spezifikation 4, Abschnitt 10;
// #210). Nur der Server entscheidet über den Lebenszyklus:
//
// - `proposeChallenge` geht nur ohne offenen Vorschlag und ohne aktive Challenge der Kopplung. Den
//   Wächter erzwingt der partielle Unique-Index `challenge_open_uq` (Spezifikation 0, Abschnitt 8); ein
//   gleichzeitiger zweiter Vorschlag scheitert daran mit `conflict`. Der Partner erhält in derselben
//   Transaktion den Intent `challenge_vorschlag`.
// - Ablehnen, Zurückziehen und Verfallen bleiben neutral und ohne Push. Der Verfall nach 48 Stunden ist ein
//   idempotenter Vor-Pull-Schritt; ein verfallener Vorschlag ist ab seiner Frist nicht mehr offen, auch wenn
//   noch kein Pull ihn festgeschrieben hat.
// - Die Annahme startet die Challenge sofort mit der Annahmezeit beim Server. Die Anteile beider Personen
//   entstehen dabei als eigentümerlesbare Teilzeilen, berechnet mit den Spielregeln aus dem Wochenplan,
//   den der `PlanReader` von Spezifikation 1 liefert.
//
// Passt eine Vorlage für eine Person nicht, weil sie an keinem der sieben Tage geplant ist, lehnt der
// Server Vorschlag und Annahme mit `conflict` und dem Kontext `challengeUnfitContext` ab („Passt gerade
// nicht zu euren Wochenplänen“); die App kennt den Plan des Partners nicht und zeigt den Hinweis danach.

const catalog = indexCatalog(gameCatalog);

/** Challenge der Kopplung: beide aktiven Mitglieder lesen sie; nur die Fachbefehle hier ändern sie. */
export const challengeEntity = serverManaged({
  entityType: 'challenge',
  resource: 'challenge',
  table: challenge,
  record: (row) =>
    ChallengeRecord.parse({
      couplingId: row.couplingId,
      templateKey: row.templateKey,
      proposerPersonId: row.proposerPersonId,
      status: row.status,
      proposedAt: iso(row.proposedAt),
      proposalExpiresAt: iso(row.proposalExpiresAt),
      startedAt: isoOrNull(row.startedAt),
      endsAt: isoOrNull(row.endsAt),
      endedAt: isoOrNull(row.endedAt),
      commonStage: row.commonStage,
      challengeDecoKey: row.challengeDecoKey,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }),
});

/**
 * Festgeschriebener Anteil einer Person: lesbar nur für sie (Regel `personenstand`). Nach dem Ende wird die
 * Zeile eine Löschmarkierung ohne Nutzlast (#211); deren Inhalt liest der Sync nicht.
 */
export const challengeRequirementEntity = serverManaged({
  entityType: 'challenge_requirement',
  resource: 'challenge_requirement',
  table: challengeRequirement,
  record: (row) =>
    row.deletedAt !== null
      ? {}
      : ChallengeRequirementRecord.parse({
          challengeId: row.challengeId,
          couplingId: row.couplingId,
          personId: row.personId,
          requiredCount: row.requiredCount,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        }),
});

export const challengeSyncEntities = [challengeEntity, challengeRequirementEntity] as const;

export type ChallengeDependencies = Readonly<{
  /** Wochenplan beider Personen in der Transaktion des Befehls; in Tests der Fake aus Spezifikation 1. */
  planReader: ReaderPort<PlanReader>;
}>;

export type Challenges = Readonly<{
  /** `proposeChallenge`, `decideChallengeProposal` und `withdrawChallengeProposal` für die Befehls-Registry. */
  commands: readonly ServerCommand[];
  /** Vor-Pull-Schritt: schreibt verfallene Vorschläge der Kopplung der Person fest. */
  expireProposals: PrePullStep;
  /** Entkopplungs-Beobachter: offene Vorschläge enden neutral als `zurueckgezogen`. */
  withdrawOnUncoupling: UncouplingObserver;
}>;

function templateOf(templateKey: string): ChallengeTemplate {
  const found = catalog.find('challenge_vorlage', templateKey);
  if (found.type !== 'found') throw new CommandRejection('unknown_catalog_key');
  return found.entry;
}

/** Ein Vorschlag ist offen, solange er `vorgeschlagen` ist und seine Frist nicht erreicht hat (Spielregel). */
const expired = (row: { proposalExpiresAt: Date }, at: Date) =>
  !proposalOpen(Instant.parse(row.proposalExpiresAt.toISOString()), Instant.parse(at.toISOString()));

/** Schreibt die verfallenen Vorschläge einer Kopplung als `verfallen` fest; ihr Ende ist die Frist. */
async function expireProposalsOf(tx: DbExecutor, couplingId: EntityId, at: Date): Promise<void> {
  // Die Sperre ordnet gleichzeitige Pulls beider Personen; der zweite findet den Vorschlag nicht mehr offen.
  const due = await tx
    .select({ id: challenge.id, proposalExpiresAt: challenge.proposalExpiresAt })
    .from(challenge)
    .where(and(eq(challenge.couplingId, couplingId), eq(challenge.status, 'vorgeschlagen'), lte(challenge.proposalExpiresAt, at)))
    .orderBy(asc(challenge.id))
    .for('update');
  const write = changeWriter(tx, at);
  for (const { id, proposalExpiresAt } of due) {
    await write({ entityType: 'challenge', couplingId }, async (stamp) => {
      await tx.update(challenge).set({ status: 'verfallen', endedAt: proposalExpiresAt, ...updated(stamp) }).where(eq(challenge.id, id));
      return id;
    });
  }
}

export function createChallenges({ planReader }: ChallengeDependencies): Challenges {
  /** Ob die Vorlage für die Person in den sieben lokalen Tagen ab `at` geplant ist, und ihr Anteil. */
  async function shareOf(tx: DbExecutor, template: ChallengeTemplate, personId: EntityId, at: Date) {
    const [own] = await tx.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, personId));
    if (own === undefined) throw new Error('Person der Kopplung fehlt');
    const startDate = LocalDate.parse(readingOf(Instant.parse(at.toISOString()), TimeZone.parse(own.timeZone)).localDate);
    const reader = planReader(tx);
    const week = [];
    for (const day of challengeDays(startDate)) week.push(await reader.effectivePlan(personId, day));
    return challengeShare(template, week);
  }

  /** Anteile beider Personen; passt die Vorlage für eine nicht, lehnt der Server mit `conflict` ab. */
  async function sharesOf(tx: DbExecutor, template: ChallengeTemplate, persons: readonly EntityId[], at: Date) {
    const shares = [];
    for (const personId of persons) {
      const share = await shareOf(tx, template, personId, at);
      if (share.type === 'passt_nicht') throw new CommandRejection('conflict', null, challengeUnfitContext);
      shares.push({ personId, required: share.required });
    }
    return shares;
  }

  /** Der Vorschlag gesperrt; nur ein offener, nicht verfallener lässt sich entscheiden. */
  async function openProposal(tx: DbExecutor, challengeId: EntityId, at: Date) {
    const [current] = await tx.select().from(challenge).where(eq(challenge.id, challengeId)).for('update');
    if (current === undefined) throw new Error('Challenge fehlt trotz Autorisierung');
    if (current.status !== 'vorgeschlagen' || expired(current, at)) throw new CommandRejection('conflict');
    return current;
  }

  async function close(tx: DbExecutor, couplingId: EntityId, challengeId: EntityId, status: 'abgelehnt' | 'zurueckgezogen', at: Date): Promise<CanonicalChange> {
    await changeWriter(tx, at)({ entityType: 'challenge', couplingId }, async (stamp) => {
      await tx.update(challenge).set({ status, endedAt: at, ...updated(stamp) }).where(eq(challenge.id, challengeId));
      return challengeId;
    });
    return canonicalAfterWrite(tx, challengeEntity, challengeId);
  }

  const proposeCommand: ServerCommand<ProposeChallenge> = {
    type: 'proposeChallenge',
    identity: 'none',
    policy: policies.resource('challenge_proposal', 'befehl'),
    payload: ProposeChallenge,
    target: (operation) => ({ id: ProposeChallenge.parse(operation.payload).challengeId }),
    canonicalRequest: (operation) => ProposeChallenge.parse(operation.payload),
    // Die ID vergibt das Gerät; ein Duplikat ist nur der Retry desselben Vorschlags.
    duplicate: () => [],
    async execute(tx, { actor, resource, payload, businessKey, at }) {
      if (businessKey !== proposeChallengeKey(payload.challengeId)) throw new CommandRejection('invalid_payload');
      const template = templateOf(payload.templateKey);
      const couplingId = EntityId.parse(resource.couplingId);
      const partnerPersonId = EntityId.parse(resource.partnerPersonId);
      await sharesOf(tx, template, [actor.personId, partnerPersonId], at);
      // Ein verfallener Vorschlag hält den Wächter nicht auf; danach entscheidet der Unique-Index.
      await expireProposalsOf(tx, couplingId, at);
      const [open] = await tx
        .select({ id: challenge.id })
        .from(challenge)
        .where(and(eq(challenge.couplingId, couplingId), inArray(challenge.status, ['vorgeschlagen', 'aktiv'])));
      if (open !== undefined) throw new CommandRejection('conflict');

      const proposedAt = Instant.parse(at.toISOString());
      const expiresAt = challengeProposalExpiresAt(proposedAt);
      await changeWriter(tx, at)({ entityType: 'challenge', couplingId }, async (stamp) => {
        await tx.insert(challenge).values({
          id: payload.challengeId,
          couplingId,
          templateKey: template.key,
          proposerPersonId: actor.personId,
          status: 'vorgeschlagen',
          proposedAt: at,
          proposalExpiresAt: new Date(expiresAt),
          ...stamp,
        });
        return payload.challengeId;
      });
      const [sender] = await tx
        .select({ displayName: couplingMember.displayName })
        .from(couplingMember)
        .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, actor.personId)));
      if (sender === undefined) throw new Error('Vorschlagende Person ist kein Mitglied der Kopplung');
      await insertNotificationIntent(tx, {
        intentId: notificationIntentId({ sourceEventId: payload.challengeId, recipientPersonId: partnerPersonId, type: 'challenge_vorschlag' }),
        sourceEventId: payload.challengeId,
        recipientPersonId: partnerPersonId,
        type: 'challenge_vorschlag',
        messageKey: 'challenge_vorschlag',
        createdAt: proposedAt,
        payload: { challengeId: payload.challengeId, templateKey: template.key, expiresAt, senderDisplayName: sender.displayName },
      });
      return { changes: [await canonicalAfterWrite(tx, challengeEntity, payload.challengeId)], idMappings: [] };
    },
  };

  const decideCommand: ServerCommand<DecideChallengeProposal> = {
    type: 'decideChallengeProposal',
    identity: 'none',
    policy: policies.resource('challenge_decision', 'befehl'),
    payload: DecideChallengeProposal,
    target: (operation) => ({ id: DecideChallengeProposal.parse(operation.payload).challengeId, claimedParticipation: 'partner' }),
    canonicalRequest: (operation) => DecideChallengeProposal.parse(operation.payload),
    // Je Person gibt es nur eine Entscheidung; ein Duplikat ist nur deren Retry.
    duplicate: () => [],
    async execute(tx, { actor, resource, payload, businessKey, at }) {
      if (businessKey !== decideChallengeProposalKey(payload.challengeId)) throw new CommandRejection('invalid_payload');
      const couplingId = EntityId.parse(resource.couplingId);
      const current = await openProposal(tx, payload.challengeId, at);
      if (payload.decision === 'ablehnen') return { changes: [await close(tx, couplingId, payload.challengeId, 'abgelehnt', at)], idMappings: [] };

      // Annehmen: Die Anteile beider Personen gelten ab der Annahme, also aus den Wochenplänen ab heute.
      const proposer = EntityId.parse(current.proposerPersonId);
      const shares = await sharesOf(tx, templateOf(current.templateKey), [proposer, actor.personId], at);
      const startedAt = Instant.parse(at.toISOString());
      const write = changeWriter(tx, at);
      await write({ entityType: 'challenge', couplingId }, async (stamp) => {
        await tx
          .update(challenge)
          .set({ status: 'aktiv', startedAt: at, endsAt: new Date(challengeEndsAt(startedAt)), commonStage: 'gestartet', ...updated(stamp) })
          .where(eq(challenge.id, payload.challengeId));
        return payload.challengeId;
      });
      for (const { personId, required } of shares) {
        const id = challengeRequirementId(payload.challengeId, personId);
        await write({ entityType: 'challenge_requirement', ownerPersonId: personId }, async (stamp) => {
          await tx.insert(challengeRequirement).values({ id, challengeId: payload.challengeId, couplingId, personId, requiredCount: required, ...stamp });
          return id;
        });
      }
      // Die annehmende Person liest nur ihren eigenen Anteil; den der vorschlagenden bringt deren Pull.
      const own = await canonicalAfterWrite(tx, challengeRequirementEntity, challengeRequirementId(payload.challengeId, actor.personId));
      return { changes: [await canonicalAfterWrite(tx, challengeEntity, payload.challengeId), own], idMappings: [] };
    },
  };

  const withdrawCommand: ServerCommand<WithdrawChallengeProposal> = {
    type: 'withdrawChallengeProposal',
    identity: 'none',
    policy: policies.resource('challenge_decision', 'befehl'),
    payload: WithdrawChallengeProposal,
    target: (operation) => ({ id: WithdrawChallengeProposal.parse(operation.payload).challengeId, claimedParticipation: 'antragsteller' }),
    canonicalRequest: (operation) => WithdrawChallengeProposal.parse(operation.payload),
    duplicate: () => [],
    async execute(tx, { resource, payload, businessKey, at }) {
      if (businessKey !== withdrawChallengeProposalKey(payload.challengeId)) throw new CommandRejection('invalid_payload');
      await openProposal(tx, payload.challengeId, at);
      return { changes: [await close(tx, EntityId.parse(resource.couplingId), payload.challengeId, 'zurueckgezogen', at)], idMappings: [] };
    },
  };

  const expireProposals: PrePullStep = async (tx, { personId, now }) => {
    const [membership] = await tx
      .select({ couplingId: couplingMember.couplingId })
      .from(couplingMember)
      .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')));
    if (membership !== undefined) await expireProposalsOf(tx, EntityId.parse(membership.couplingId), new Date(now));
  };

  const withdrawOnUncoupling: UncouplingObserver = async (tx, { couplingId, at }) => {
    await expireProposalsOf(tx, couplingId, at);
    const open = await tx
      .select({ id: challenge.id })
      .from(challenge)
      .where(and(eq(challenge.couplingId, couplingId), eq(challenge.status, 'vorgeschlagen')))
      .orderBy(asc(challenge.id))
      .for('update');
    for (const { id } of open) await close(tx, couplingId, EntityId.parse(id), 'zurueckgezogen', at);
  };

  return { commands: [proposeCommand, decideCommand, withdrawCommand], expireProposals, withdrawOnUncoupling };
}
