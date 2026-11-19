import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { readingOf, type ClockReading } from '@abnehm/clock';
import { EntityId, Instant, type LocalDate } from '@abnehm/contracts/base';
import {
  challengeUnfitContext,
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
import type { WirContribution } from '@abnehm/contracts/wir';
import { indexCatalog, type ChallengeTemplate } from '@abnehm/game-rules/catalog';
import { challengeDays, challengeShare, fullPlanRequired, proposalOpen, type ChallengeShare } from '@abnehm/game-rules/challenges';
import { gameCatalog } from '@abnehm/game-rules/content';
import { z } from 'zod';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { readOwnPerson } from '../local-db/person-header';
import { challenge, challengeRequirement, couplingMember } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { serverManagedEntity, type LocalCommand, type SyncEntityAdapter, type SyncWriter } from '../sync';
import { pendingCommandPayloads } from '../sync/outbox';

// Gemeinsame Challenges in der App: Vorschlag, Annahme und Verfall (Spezifikation 4, Abschnitte 10 und 11;
// #210). Über den Lebenszyklus entscheidet nur der Server. Die Befehle sind offline nur vorgemerkt: Sie
// ändern lokal keine Fachzeile und stehen nur in der Outbox. Das Lesemodell liest sie dort mit, wie die
// Rollenwahl (#180). Lehnt der Server einen Befehl dauerhaft ab, verschwindet er mit seiner
// Outbox-Operation.
//
// Ob eine Vorlage zum eigenen Wochenplan passt und welchen Anteil sie verlangt, rechnet die App mit den
// Spielregeln über den `PlanReader` als Vorschau. Den Plan des Partners kennt sie nicht; ob die Vorlage zu
// beiden Plänen passt, entscheidet der Server. Lehnt er einen eigenen Vorschlag mit dem Grund
// `challengeUnfitContext` ab, merkt sich das Gerät die Vorlage für den Tag (Gerätezustand, ohne Sync), und
// `challenge.propose` zeigt sie mit „Passt gerade nicht zu euren Wochenplänen“ (Nutzerentscheidung vom
// 19.11.2026 im Review von #210).

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
  /** Der Server hat die eigene Annahme abgelehnt, weil die Vorlage nicht zu beiden Wochenplänen passt. */
  unfit: boolean;
}>;

/** Wo das Paar mit Challenges steht. */
export type ChallengeStage =
  | Readonly<{ type: 'ohne_person' }>
  /** Ohne aktive Kopplung gibt es keine gemeinsame Challenge. */
  | Readonly<{ type: 'ohne_kopplung' }>
  /**
   * Kein offener Vorschlag, keine aktive Challenge: Jede Person kann vorschlagen. `unfitToday` sind die
   * Vorlagen, deren eigenen Vorschlag der Server heute abgelehnt hat, weil sie nicht zum Plan des Partners
   * passen.
   */
  | Readonly<{ type: 'frei'; personId: EntityId; partnerDisplayName: string; unfitToday: readonly string[] }>
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
export function readChallengeStage(tx: ReadContext, reading: ClockReading): ChallengeStage {
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
    .filter(({ record }) => record.status === 'aktiv' || proposalOpen(record.proposalExpiresAt, reading.instant));
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
        unfit: unfitIds(tx, acceptKey).includes(id),
      },
    };
  }
  // Ein bestätigter offener Vorschlag geht einem vorgemerkten vor: Gleichzeitig vorgemerkte Vorschläge lehnt
  // der Server ab, sobald einer offen ist.
  const pending = pendingProposals(tx).filter((proposal) => !gone.has(proposal.challengeId)).at(-1);
  if (pending === undefined) return { type: 'frei', ...base, unfitToday: unfitToday(tx, reading) };

  return {
    type: 'vorschlag',
    ...base,
    proposal: { challengeId: pending.challengeId, templateKey: pending.templateKey, by: 'self', proposedAt: null, expiresAt: null, accepted: false, unfit: false },
  };
}

function challengeOf(row: typeof challenge.$inferSelect) {
  const { id, serverVersion: _version, deletedAt: _deleted, ...data } = row;
  return { id: EntityId.parse(id), record: ChallengeRecord.parse(data) };
}

/**
 * Vorschau des eigenen Anteils: dieselbe Regel wie beim Start auf dem Server, mit den sieben lokalen Tagen
 * ab `today` aus dem eigenen Wochenplan. Festgeschrieben wird der Anteil erst mit der Annahme.
 */
export async function ownChallengeShare(planReader: PlanReader, personId: EntityId, templateKey: string, today: LocalDate): Promise<ChallengeShare> {
  const week = await Promise.all(challengeDays(today).map((day) => planReader.effectivePlan(personId, day)));
  return challengeShare(challengeTemplate(templateKey), week);
}

/** Die Challenge, zu der „Zur Challenge“ führt: ein offener Vorschlag oder die laufende; sonst `null`. */
export function openChallengeIdOf(stage: ChallengeStage | null): EntityId | null {
  if (stage?.type === 'vorschlag') return stage.proposal.challengeId;
  return stage?.type === 'aktiv' ? stage.challengeId : null;
}

/** Vom Server als unpassend abgelehnte eigene Vorschläge (je Vorlage) und Annahmen (je Challenge). */
const proposeKey = 'challenge_passt_nicht';
const acceptKey = 'challenge_annahme_passt_nicht';
/** Je Schlüssel der Zeitpunkt der abgelehnten Operation. */
const UnfitMarks = z.record(z.string(), Instant);

function unfitMarks(tx: ReadContext, key: string): Record<string, Instant> {
  const stored = UnfitMarks.safeParse(readDeviceState(tx, key));
  return stored.success ? stored.data : {};
}

function unfitToday(tx: ReadContext, reading: ClockReading): string[] {
  return Object.entries(unfitMarks(tx, proposeKey))
    .filter(([, at]) => readingOf(at, reading.timeZone).localDate === reading.localDate)
    .map(([templateKey]) => templateKey);
}

const unfitIds = (tx: ReadContext, key: string) => Object.keys(unfitMarks(tx, key));

/** Merkt sich eine vom Server als unpassend abgelehnte Vorlage bzw. Challenge. */
function rememberUnfit(tx: TransactionContext, key: string, id: string, at: Instant) {
  writeDeviceState(tx, key, { ...unfitMarks(tx, key), [id]: at }, at);
}

type ConfirmedProposal = ChallengeProposal & Readonly<{ proposedAt: Instant; expiresAt: Instant }>;

/** Ein vom Server bestätigter Vorschlag, den die Person nicht schon selbst angenommen hat; sonst `null`. */
export function confirmedOpenProposal(proposal: ChallengeProposal): ConfirmedProposal | null {
  const { proposedAt, expiresAt } = proposal;
  return proposedAt === null || expiresAt === null || proposal.accepted ? null : { ...proposal, proposedAt, expiresAt };
}

/**
 * Beitrag `challenge` an „Wir“ für einen vom Server bestätigten Vorschlag: beim Partner ein
 * antwortbedürftiger Vorgang, bei der vorschlagenden Person neutral „Vorschlag gesendet“
 * (`proposedBySelf`). Stand und Bedarf sind die eigenen; vor dem Start ist der Stand 0 und der Bedarf die
 * Vorschau aus dem eigenen Wochenplan, die gemeinsame Stufe `gestartet` und das Enddatum der Verfall des
 * Vorschlags. Passt die Vorlage gerade nicht zum eigenen Plan, steht als Bedarf der Anteil bei vollem Plan
 * als Richtwert; `challenge.detail` nennt dann den Grund und bietet nur „Ablehnen“ (Nutzerentscheidung vom
 * 19.11.2026 im Review von #210).
 */
export function challengeContributionOf(proposal: ConfirmedProposal, share: ChallengeShare): WirContribution {
  const { challengeId, templateKey, proposedAt, expiresAt, by } = proposal;
  return {
    type: 'challenge',
    id: challengeId,
    dataAsOf: proposedAt,
    action: { actionId: by === 'partner' ? 'wir.answer_challenge' : 'wir.open_challenge', target: { type: 'challenge.detail', challengeId } },
    challengeId,
    templateKey,
    status: 'vorgeschlagen',
    proposedBySelf: by === 'self',
    ownCount: 0,
    ownRequired: share.type === 'passt' ? share.required : fullPlanRequired(challengeTemplate(templateKey)),
    stage: 'gestartet',
    endsAt: expiresAt,
  };
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
  const decide = (tx: TransactionContext, reading: ClockReading, challengeId: EntityId, decision: ChallengeProposalDecision): ChallengeOutcome => {
    const stage = readChallengeStage(tx, reading);
    if (stage.type !== 'vorschlag' || stage.proposal.by !== 'partner' || stage.proposal.challengeId !== challengeId || stage.proposal.accepted) {
      return 'nicht_moeglich';
    }
    command(tx, 'decideChallengeProposal', decideChallengeProposalKey(challengeId), DecideChallengeProposal.parse({ challengeId, decision }));
    return 'vorgemerkt';
  };
  return {
    propose(tx: TransactionContext, reading: ClockReading, templateKey: string): ChallengeOutcome {
      if (readChallengeStage(tx, reading).type !== 'frei' || catalog.find('challenge_vorlage', templateKey).type !== 'found') return 'nicht_moeglich';
      const challengeId = newId();
      command(tx, 'proposeChallenge', proposeChallengeKey(challengeId), ProposeChallenge.parse({ challengeId, templateKey }));
      return 'vorgemerkt';
    },
    accept: (tx: TransactionContext, reading: ClockReading, challengeId: EntityId) => decide(tx, reading, challengeId, 'annehmen'),
    decline: (tx: TransactionContext, reading: ClockReading, challengeId: EntityId) => decide(tx, reading, challengeId, 'ablehnen'),
    withdraw(tx: TransactionContext, reading: ClockReading, challengeId: EntityId): ChallengeOutcome {
      const stage = readChallengeStage(tx, reading);
      const proposal = stage.type === 'vorschlag' ? stage.proposal : null;
      if (proposal?.by !== 'self' || proposal.challengeId !== challengeId || proposal.proposedAt === null) return 'nicht_moeglich';
      command(tx, 'withdrawChallengeProposal', withdrawChallengeProposalKey(challengeId), WithdrawChallengeProposal.parse({ challengeId }));
      return 'vorgemerkt';
    },
  };
}

const onlyQueued = { referencePaths: [], apply: () => [], reconcileRejected: () => {} } as const;

/**
 * Lokale Fachbefehle für die Sync-Engine: nur vorgemerkt, ohne lokale Fachzeile und ohne Bereinigung. Lehnt
 * der Server einen eigenen Vorschlag oder eine Annahme ab, weil die Vorlage nicht zu beiden Wochenplänen
 * passt, merkt sich das Gerät die Vorlage für den Tag bzw. die Challenge.
 */
export const challengeLocalCommands: readonly LocalCommand[] = [
  {
    type: 'proposeChallenge',
    payload: ProposeChallenge,
    ...onlyQueued,
    reconcileRejected(tx, operation, { error }) {
      if (error.context?.grund !== challengeUnfitContext.grund) return;
      rememberUnfit(tx, proposeKey, ProposeChallenge.parse(operation.payload).templateKey, operation.createdAt);
    },
  },
  {
    type: 'decideChallengeProposal',
    payload: DecideChallengeProposal,
    ...onlyQueued,
    reconcileRejected(tx, operation, { error }) {
      if (error.context?.grund !== challengeUnfitContext.grund) return;
      rememberUnfit(tx, acceptKey, DecideChallengeProposal.parse(operation.payload).challengeId, operation.createdAt);
    },
  },
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
