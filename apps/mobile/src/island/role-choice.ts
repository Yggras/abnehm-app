import { and, asc, eq, ne } from 'drizzle-orm';

import { EntityId, type Instant } from '@abnehm/contracts/base';
import { shownEnergy } from '@abnehm/contracts/energy';
import {
  DecideSharedAction,
  type IslandRole,
  RequestSharedAction,
  SharedAction,
  sharedActionDecisionKey,
  sharedActionRequestKey,
  type SharedActionDecision,
} from '@abnehm/contracts/island';

import { readEnergy } from '../energy';
import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { couplingMember, island, sharedAction } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { LocalCommand, SyncWriter } from '../sync';
import { pendingCommandPayloads } from '../sync/outbox';

// Laichkugel und Rollenwahl (Spezifikation 4, Abschnitte 2.4 und 7; #180). Ohne aktive Kopplung wartet
// Momo als Laichkugel; mit der Kopplung wartet die Insel auf die Rollen. Eine Person schlägt dann die
// Verteilung vor, indem sie ihre eigene Rolle wählt; der Partner lehnt ab oder nimmt an (Schlüpfen, #184),
// die vorschlagende Person kann zurückziehen.
//
// Gemeinsame Aktionen sind offline nur vorgemerkt (Spezifikation 4, Abschnitt 11): Die Befehle ändern
// lokal keine Fachzeile, sie stehen nur in der Outbox. Das Lesemodell liest sie dort als vorgemerkt
// mit. Lehnt der Server einen Befehl dauerhaft ab, etwa den später eingegangenen von zwei gleichzeitigen
// Vorschlägen, verschwindet er mit seiner Outbox-Operation; eine Ableitung bleibt nicht zurück.

/** Ein offener Vorschlag aus Sicht der eigenen Person. */
export type RoleProposal = Readonly<{
  actionId: EntityId;
  by: 'self' | 'partner';
  proposerRole: IslandRole;
  /** Vom Server bestätigt erstellt; `null`, solange der eigene Vorschlag nur vorgemerkt ist. */
  createdAt: Instant | null;
}>;

/** Wo Momo steht: noch ohne eigene Person, als Laichkugel ohne Kopplung, vor der Rollenwahl oder geschlüpft. */
export type IslandStage =
  | Readonly<{ type: 'ohne_person' }>
  | Readonly<{ type: 'laichkugel'; energy: number }>
  | Readonly<{
      type: 'rollenwahl';
      energy: number;
      couplingId: EntityId;
      partnerDisplayName: string;
      proposal: RoleProposal | null;
    }>
  | Readonly<{ type: 'geschluepft' }>;

/** Die Rolle des Partners, wenn die vorschlagende Person `role` wählt. */
export function otherRole(role: IslandRole): IslandRole {
  return role === 'bauen' ? 'natur' : 'bauen';
}

/** Liest Stufe, Partner und offenen Vorschlag samt vorgemerkter Befehle in einer Lesetransaktion. */
export function readIslandStage(tx: ReadContext): IslandStage {
  const own = readOwnPerson(tx);
  if (own === undefined) return { type: 'ohne_person' };
  const personId = EntityId.parse(own.id);
  // Ein negativer Mehrgeräte-Zwischenstand erscheint als 0 (Spezifikation 0, Abschnitt 6).
  const energy = shownEnergy(readEnergy(tx, personId).balance);
  const db = sqliteOf(tx);
  const membership = db
    .select({ couplingId: couplingMember.couplingId })
    .from(couplingMember)
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')))
    .get();
  if (membership === undefined) return { type: 'laichkugel', energy };
  const couplingId = EntityId.parse(membership.couplingId);
  const state = db.select({ state: island.state }).from(island).where(eq(island.couplingId, couplingId)).get()?.state;
  if (state === 'aktiv') return { type: 'geschluepft' };
  // Die Insel kommt im selben Pull wie die Kopplung; bis sie da ist, wartet Momo noch im Ei.
  if (state !== 'wartet_auf_rollen') return { type: 'laichkugel', energy };
  const partner = db
    .select({ displayName: couplingMember.displayName })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, couplingId), ne(couplingMember.personId, personId)))
    .get();
  if (partner === undefined) return { type: 'laichkugel', energy };

  const decided = new Set(pendingDecisions(tx).map((decision) => decision.actionId));
  const canonical = db
    .select()
    .from(sharedAction)
    .where(and(eq(sharedAction.couplingId, couplingId), eq(sharedAction.kind, 'rollenwahl'), eq(sharedAction.status, 'offen')))
    .orderBy(asc(sharedAction.createdAt))
    .all()
    .filter((row) => !decided.has(EntityId.parse(row.id)))
    .map((row) => {
      const action = SharedAction.parse({
        id: row.id, couplingId: row.couplingId, requesterPersonId: row.requesterPersonId, type: row.kind,
        payload: row.payload, status: row.status, createdAt: row.createdAt, decidedAt: row.decidedAt,
      });
      if (action.type !== 'rollenwahl') throw new Error('Rollenwahl erwartet');
      return { action, by: action.requesterPersonId === personId ? ('self' as const) : ('partner' as const) };
    })
    .at(-1);
  const pendingProposal = pendingRoleRequests(tx)
    .filter((request) => !decided.has(request.actionId))
    .at(-1);
  // Ein bestätigter offener Vorschlag geht einem vorgemerkten vor: Gleichzeitig vorgemerkte Anträge
  // lehnt der Server ab, sobald ein anderer offen ist.
  const proposal: RoleProposal | null =
    canonical !== undefined
      ? { actionId: canonical.action.id, by: canonical.by, proposerRole: canonical.action.payload.proposerRole, createdAt: canonical.action.createdAt }
      : pendingProposal !== undefined
        ? { actionId: pendingProposal.actionId, by: 'self', proposerRole: pendingProposal.payload.proposerRole, createdAt: null }
        : null;
  return { type: 'rollenwahl', energy, couplingId, partnerDisplayName: partner.displayName, proposal };
}

function pendingRoleRequests(tx: ReadContext) {
  return pendingCommandPayloads(tx, 'requestSharedAction')
    .map((payload) => RequestSharedAction.parse(payload))
    .filter((request): request is Extract<RequestSharedAction, { type: 'rollenwahl' }> => request.type === 'rollenwahl');
}

function pendingDecisions(tx: ReadContext) {
  return pendingCommandPayloads(tx, 'decideSharedAction').map((payload) => DecideSharedAction.parse(payload));
}

/** Ergebnis eines Befehls der Rollenwahl; `nicht_moeglich`, wenn der lokale Stand ihn nicht zulässt. */
export type RoleChoiceOutcome = 'vorgemerkt' | 'nicht_moeglich';

export type RoleChoiceDependencies = Readonly<{
  writer: SyncWriter;
  newId: () => EntityId;
  /** Zone des Geräts für `decideSharedAction`; bei einer Annahme wird sie die Zeitzone der Insel. */
  timeZone: () => DecideSharedAction['timeZone'];
}>;

/**
 * Die Befehle der Rollenwahl, je in der Transaktion des Aufrufers. Vorschlagen geht nur ohne offenen
 * Vorschlag, ablehnen nur einen des Partners, zurückziehen nur einen eigenen.
 */
export function roleChoiceCommands({ writer, newId, timeZone }: RoleChoiceDependencies) {
  const decide = (tx: TransactionContext, actionId: EntityId, decision: SharedActionDecision) =>
    writer.command(tx, {
      type: 'decideSharedAction',
      businessKey: sharedActionDecisionKey(actionId),
      payload: DecideSharedAction.parse({ actionId, decision, timeZone: timeZone() }),
      knownServerVersion: null,
      affectedRefs: [],
      referencePaths: [],
    });
  return {
    propose(tx: TransactionContext, proposerRole: IslandRole): RoleChoiceOutcome {
      const stage = readIslandStage(tx);
      if (stage.type !== 'rollenwahl' || stage.proposal !== null) return 'nicht_moeglich';
      const actionId = newId();
      writer.command(tx, {
        type: 'requestSharedAction',
        businessKey: sharedActionRequestKey(actionId),
        payload: RequestSharedAction.parse({ type: 'rollenwahl', actionId, payload: { proposerRole } }),
        knownServerVersion: null,
        affectedRefs: [],
        referencePaths: [],
      });
      return 'vorgemerkt';
    },
    decline(tx: TransactionContext, actionId: EntityId): RoleChoiceOutcome {
      const stage = readIslandStage(tx);
      if (stage.type !== 'rollenwahl' || stage.proposal?.by !== 'partner' || stage.proposal.actionId !== actionId) return 'nicht_moeglich';
      decide(tx, actionId, 'ablehnen');
      return 'vorgemerkt';
    },
    withdraw(tx: TransactionContext, actionId: EntityId): RoleChoiceOutcome {
      const stage = readIslandStage(tx);
      if (stage.type !== 'rollenwahl' || stage.proposal?.by !== 'self' || stage.proposal.actionId !== actionId) return 'nicht_moeglich';
      decide(tx, actionId, 'zurueckziehen');
      return 'vorgemerkt';
    },
  };
}

/** Nur vorgemerkt: keine lokale Fachzeile, deshalb auch nichts zu bereinigen, wenn der Server ablehnt. */
const onlyQueued = { referencePaths: [], apply: () => [], reconcileRejected: () => {} } as const;

/**
 * Lokale Fachbefehle der gemeinsamen Aktionen für die Sync-Engine (Spezifikation 0, Abschnitt 9). Sie
 * gelten für Rollenwahl, Rollentausch und Deko schenken; Arten mit lokaler Vormerkung, etwa ein
 * vorgemerktes Deko-Stück, ergänzen ihre Reconciliation hier.
 */
export const sharedActionCommands: readonly LocalCommand[] = [
  { type: 'requestSharedAction', payload: RequestSharedAction, ...onlyQueued },
  { type: 'decideSharedAction', payload: DecideSharedAction, ...onlyQueued },
];
