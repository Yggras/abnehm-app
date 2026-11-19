import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { EntityId, type Instant, type LocalDate } from '@abnehm/contracts/base';
import {
  DecideChallengeProposal,
  decideChallengeProposalKey,
  ProposeChallenge,
  proposeChallengeKey,
  WithdrawChallengeProposal,
  withdrawChallengeProposalKey,
  type ChallengeProposalDecision,
} from '@abnehm/contracts/island';
import { ChallengeRecord, ChallengeRequirementRecord } from '@abnehm/contracts/island-records';
import type { PlanReader } from '@abnehm/contracts/ports';
import { indexCatalog, type ChallengeTemplate } from '@abnehm/game-rules/catalog';
import { challengeDays, challengeShare, plannedCount } from '@abnehm/game-rules/challenges';
import { gameCatalog } from '@abnehm/game-rules/content';

import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { challenge, challengeRequirement, couplingMember } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { serverManagedEntity, type LocalCommand, type SyncEntityAdapter, type SyncWriter } from '../sync';
import { pendingCommandPayloads } from '../sync/outbox';

// Gemeinsame Challenges in der App: Vorschlag, Annahme und Verfall (Spezifikation 4, Abschnitte 10 und 11;
// #210). Über den Lebenszyklus entscheidet nur der Server. Die Befehle sind offline nur vorgemerkt: Sie
// ändern lokal keine Fachzeile und stehen nur in der Outbox. Das Lesemodell liest sie dort mit, wie die
// Rollenwahl (#180). Lehnt der Server einen Befehl dauerhaft ab, etwa einen Vorschlag, der nicht zum
// Wochenplan des Partners passt, verschwindet er mit seiner Outbox-Operation.
//
// Ob eine Vorlage zum eigenen Wochenplan passt und welchen Anteil sie verlangt, rechnet die App mit den
// Spielregeln über den `PlanReader` als Vorschau. Den Plan des Partners kennt sie nicht; ob die Vorlage zu
// beiden Plänen passt, entscheidet der Server.

const catalog = indexCatalog(gameCatalog);

/** Challenge-Vorlage des Katalogs; ein unbekannter Schlüssel ist ein Integrationsfehler. */
export function challengeTemplate(templateKey: string): ChallengeTemplate {
  const found = catalog.find('challenge_vorlage', templateKey);
  if (found.type !== 'found') throw new Error(`Challenge-Vorlage ${templateKey} fehlt im Katalog`);
  return found.entry;
}

/** Ein offener Vorschlag aus Sicht der eigenen Person. */
export type ChallengeProposal = Readonly<{
  challengeId: EntityId;
  templateKey: string;
  by: 'self' | 'partner';
  /** Vom Server bestätigt vorgeschlagen; `null`, solange der eigene Vorschlag nur vorgemerkt ist. */
  proposedAt: Instant | null;
  /** Verfall nach 48 Stunden; `null` wie `proposedAt`. */
  expiresAt: Instant | null;
  /** Die eigene Annahme ist vorgemerkt; die Challenge startet mit dem nächsten Sync. */
  accepted: boolean;
}>;

/** Wo das Paar mit Challenges steht. */
export type ChallengeStage =
  | Readonly<{ type: 'ohne_person' }>
  /** Ohne aktive Kopplung gibt es keine gemeinsame Challenge. */
  | Readonly<{ type: 'ohne_kopplung' }>
  /** Kein offener Vorschlag, keine aktive Challenge: Jede Person kann vorschlagen. */
  | Readonly<{ type: 'frei'; personId: EntityId; partnerDisplayName: string }>
  | Readonly<{ type: 'vorschlag'; personId: EntityId; partnerDisplayName: string; proposal: ChallengeProposal }>
  | Readonly<{
      type: 'aktiv';
      personId: EntityId;
      partnerDisplayName: string;
      challengeId: EntityId;
      templateKey: string;
      startedAt: Instant;
      endsAt: Instant;
      /** Der eigene festgeschriebene Anteil; `null`, bis er per Pull angekommen ist. */
      ownRequired: number | null;
    }>;

const pendingProposals = (tx: ReadContext) => pendingCommandPayloads(tx, 'proposeChallenge').map((payload) => ProposeChallenge.parse(payload));
const pendingDecisions = (tx: ReadContext) => pendingCommandPayloads(tx, 'decideChallengeProposal').map((payload) => DecideChallengeProposal.parse(payload));
const pendingWithdrawals = (tx: ReadContext) =>
  pendingCommandPayloads(tx, 'withdrawChallengeProposal').map((payload) => WithdrawChallengeProposal.parse(payload));

/**
 * Liest die Challenge der aktiven Kopplung samt vorgemerkter Befehle in einer Lesetransaktion. Ein
 * Vorschlag ist offen, solange er `vorgeschlagen` ist und seine Frist `now` nicht erreicht hat; den Verfall
 * schreibt der Server mit dem nächsten Pull fest. Abgelehnt oder zurückgezogen ist ein Vorschlag sofort weg,
 * angenommen bleibt er bis zum Sync sichtbar.
 */
export function readChallengeStage(tx: ReadContext, now: Instant): ChallengeStage {
  const own = readOwnPerson(tx);
  if (own === undefined) return { type: 'ohne_person' };
  const personId = EntityId.parse(own.id);
  const db = sqliteOf(tx);
  const membership = db
    .select({ couplingId: couplingMember.couplingId })
    .from(couplingMember)
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')))
    .get();
  if (membership === undefined) return { type: 'ohne_kopplung' };
  const partner = db
    .select({ displayName: couplingMember.displayName })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, membership.couplingId), ne(couplingMember.personId, personId)))
    .get();
  if (partner === undefined) return { type: 'ohne_kopplung' };
  const base = { personId, partnerDisplayName: partner.displayName };

  const open = db
    .select()
    .from(challenge)
    .where(and(eq(challenge.couplingId, membership.couplingId), inArray(challenge.status, ['vorgeschlagen', 'aktiv'])))
    .orderBy(asc(challenge.proposedAt))
    .all()
    .map(challengeOf)
    .filter(({ record }) => record.status === 'aktiv' || record.proposalExpiresAt > now);
  const active = open.find(({ record }) => record.status === 'aktiv');
  if (active !== undefined) {
    const { record } = active;
    const requirement = db
      .select()
      .from(challengeRequirement)
      .where(and(eq(challengeRequirement.challengeId, active.id), eq(challengeRequirement.personId, personId)))
      .get();
    return {
      type: 'aktiv',
      ...base,
      challengeId: active.id,
      templateKey: record.templateKey,
      startedAt: record.startedAt!,
      endsAt: record.endsAt!,
      ownRequired: requirement?.deletedAt === null ? requirement.requiredCount : null,
    };
  }

  const decisions = pendingDecisions(tx);
  const gone = new Set([
    ...decisions.filter((decision) => decision.decision === 'ablehnen').map((decision) => decision.challengeId),
    ...pendingWithdrawals(tx).map((withdrawal) => withdrawal.challengeId),
  ]);
  const accepted = new Set(decisions.filter((decision) => decision.decision === 'annehmen').map((decision) => decision.challengeId));
  const canonical = open.filter(({ id }) => !gone.has(id)).at(-1);
  if (canonical !== undefined) {
    const { id, record } = canonical;
    return {
      type: 'vorschlag',
      ...base,
      proposal: {
        challengeId: id,
        templateKey: record.templateKey,
        by: record.proposerPersonId === personId ? 'self' : 'partner',
        proposedAt: record.proposedAt,
        expiresAt: record.proposalExpiresAt,
        accepted: accepted.has(id),
      },
    };
  }
  // Ein bestätigter offener Vorschlag geht einem vorgemerkten vor: Gleichzeitig vorgemerkte Vorschläge lehnt
  // der Server ab, sobald einer offen ist.
  const pending = pendingProposals(tx).filter((proposal) => !gone.has(proposal.challengeId)).at(-1);
  if (pending === undefined) return { type: 'frei', ...base };
  return {
    type: 'vorschlag',
    ...base,
    proposal: { challengeId: pending.challengeId, templateKey: pending.templateKey, by: 'self', proposedAt: null, expiresAt: null, accepted: false },
  };
}

function challengeOf(row: typeof challenge.$inferSelect) {
  const { id, serverVersion: _version, deletedAt: _deleted, ...data } = row;
  return { id: EntityId.parse(id), record: ChallengeRecord.parse(data) };
}

/** Was eine Vorlage von der eigenen Person verlangt; `passt_nicht`, wenn sie an keinem Tag geplant ist. */
export type OwnChallengeShare = Readonly<{ type: 'passt'; required: number; planned: number }> | Readonly<{ type: 'passt_nicht' }>;

/**
 * Vorschau des eigenen Anteils: dieselbe Regel wie beim Start auf dem Server, mit den sieben lokalen Tagen
 * ab `today` aus dem eigenen Wochenplan. Festgeschrieben wird der Anteil erst mit der Annahme.
 */
export async function ownChallengeShare(planReader: PlanReader, personId: EntityId, templateKey: string, today: LocalDate): Promise<OwnChallengeShare> {
  const template = challengeTemplate(templateKey);
  const week = await Promise.all(challengeDays(today).map((day) => planReader.effectivePlan(personId, day)));
  const share = challengeShare(template, week);
  return share.type === 'passt_nicht' ? share : { ...share, planned: plannedCount(template, week) };
}

/** Ergebnis eines Challenge-Befehls; `nicht_moeglich`, wenn der lokale Stand ihn nicht zulässt. */
export type ChallengeOutcome = 'vorgemerkt' | 'nicht_moeglich';

/**
 * Die Befehle, je in der Transaktion des Aufrufers. Vorschlagen geht nur ohne offenen Vorschlag und ohne
 * aktive Challenge, annehmen und ablehnen nur einen Vorschlag des Partners, zurückziehen nur einen eigenen,
 * vom Server bestätigten. Ob die Vorlage passt, prüft der Aufrufer vorab mit `ownChallengeShare`.
 */
export function challengeCommands({ writer, newId }: Readonly<{ writer: SyncWriter; newId: () => EntityId }>) {
  const command = (tx: TransactionContext, type: LocalCommand['type'], businessKey: string, payload: Record<string, unknown>) =>
    writer.command(tx, { type, businessKey, payload, knownServerVersion: null, affectedRefs: [], referencePaths: [] });
  const decide = (tx: TransactionContext, now: Instant, challengeId: EntityId, decision: ChallengeProposalDecision): ChallengeOutcome => {
    const stage = readChallengeStage(tx, now);
    if (stage.type !== 'vorschlag' || stage.proposal.by !== 'partner' || stage.proposal.challengeId !== challengeId || stage.proposal.accepted) {
      return 'nicht_moeglich';
    }
    command(tx, 'decideChallengeProposal', decideChallengeProposalKey(challengeId), DecideChallengeProposal.parse({ challengeId, decision }));
    return 'vorgemerkt';
  };
  return {
    propose(tx: TransactionContext, now: Instant, templateKey: string): ChallengeOutcome {
      if (readChallengeStage(tx, now).type !== 'frei' || catalog.find('challenge_vorlage', templateKey).type !== 'found') return 'nicht_moeglich';
      const challengeId = newId();
      command(tx, 'proposeChallenge', proposeChallengeKey(challengeId), ProposeChallenge.parse({ challengeId, templateKey }));
      return 'vorgemerkt';
    },
    accept: (tx: TransactionContext, now: Instant, challengeId: EntityId) => decide(tx, now, challengeId, 'annehmen'),
    decline: (tx: TransactionContext, now: Instant, challengeId: EntityId) => decide(tx, now, challengeId, 'ablehnen'),
    withdraw(tx: TransactionContext, now: Instant, challengeId: EntityId): ChallengeOutcome {
      const stage = readChallengeStage(tx, now);
      const proposal = stage.type === 'vorschlag' ? stage.proposal : null;
      if (proposal?.by !== 'self' || proposal.challengeId !== challengeId || proposal.proposedAt === null) return 'nicht_moeglich';
      command(tx, 'withdrawChallengeProposal', withdrawChallengeProposalKey(challengeId), WithdrawChallengeProposal.parse({ challengeId }));
      return 'vorgemerkt';
    },
  };
}

const onlyQueued = { referencePaths: [], apply: () => [], reconcileRejected: () => {} } as const;

/** Lokale Fachbefehle für die Sync-Engine: nur vorgemerkt, ohne lokale Fachzeile und ohne Bereinigung. */
export const challengeLocalCommands: readonly LocalCommand[] = [
  { type: 'proposeChallenge', payload: ProposeChallenge, ...onlyQueued },
  { type: 'decideChallengeProposal', payload: DecideChallengeProposal, ...onlyQueued },
  { type: 'withdrawChallengeProposal', payload: WithdrawChallengeProposal, ...onlyQueued },
];

/**
 * Challenge und eigener Anteil im Sync: Beide entstehen nur auf dem Server. Die Challenge kommt zu beiden
 * aktiven Mitgliedern, der Anteil nur zu seiner Person; nach dem Ende wird er eine Löschmarkierung (#211).
 */
export const challengeSyncEntities: readonly SyncEntityAdapter[] = [
  serverManagedEntity({ entityType: 'challenge', ownerField: 'couplingId', record: ChallengeRecord, table: challenge }),
  serverManagedEntity({ entityType: 'challenge_requirement', ownerField: 'personId', record: ChallengeRequirementRecord, table: challengeRequirement }),
];
