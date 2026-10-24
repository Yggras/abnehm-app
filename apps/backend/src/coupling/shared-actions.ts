import { and, eq } from 'drizzle-orm';

import { EntityId, type TimeZone } from '@abnehm/contracts/base';
import {
  DecideSharedAction,
  RequestSharedAction,
  SharedAction,
  sharedActionDecisionKey,
  sharedActionRequestKey,
  type RequestedSharedActionType,
  type SharedActionDecision,
} from '@abnehm/contracts/island';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { policies, type SharedActionParticipation } from '../authorization/authorization.ts';
import type { DbExecutor } from '../database.ts';
import { sharedAction } from '../db/schema/index.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { canonicalOf } from '../sync/sync.ts';
import { changeWriter, updated } from './change-writer.ts';
import { sharedActionEntity } from './coupling-entities.ts';

// Gemeinsame Aktionen (Spezifikation 0, Abschnitt 9): die Fachbefehle `requestSharedAction` und
// `decideSharedAction` samt Art-Registry. Spezifikation 4 meldet Rollenwahl, Rollentausch und Deko
// schenken als Arten an; ihre Nutzlast legt das Vertragsmodul fest, ihre Prüfung beim Beantragen und ihre
// Zustandsänderung bei Annahme bringt die Art mit. Beteiligung und aktive Kopplung prüft die zentrale
// Autorisierung, bevor ein Befehl läuft. Eine Aktion geht genau einmal von `offen` nach `angenommen`,
// `abgelehnt` oder `zurueckgezogen`. Entkoppeln ist keine Art: Niemand entscheidet darüber, der Kern in
// `uncoupling.ts` nimmt es sofort an.

type ActionOf<T extends RequestedSharedActionType> = Extract<SharedAction, { type: T }>;

/** Was eine Art über ihre Aktion erfährt; `partnerPersonId` ist die Person, die antwortet. */
export type SharedActionContext<T extends RequestedSharedActionType> = Readonly<{
  action: ActionOf<T>;
  partnerPersonId: EntityId;
  at: Date;
}>;

/** Bei Annahme zusätzlich die Zone des annehmenden Geräts, etwa als Zeitzone der Insel beim Schlüpfen. */
export type SharedActionAcceptance<T extends RequestedSharedActionType> = SharedActionContext<T> & Readonly<{ timeZone: TimeZone }>;

export type SharedActionKind<T extends RequestedSharedActionType = RequestedSharedActionType> = Readonly<{
  type: T;
  /**
   * Prüft beim Beantragen den Fachzustand und legt etwa den Intent für den Partner an. Läuft im Savepoint
   * des Antrags; wirft sie `CommandRejection`, entsteht keine Aktion.
   */
  request?(tx: DbExecutor, context: SharedActionContext<T>): Promise<void>;
  /** Fachliche Zustandsänderung bei Annahme, im Savepoint der Entscheidung; wirft sie, bleibt die Aktion offen. */
  accept(tx: DbExecutor, context: SharedActionAcceptance<T>): Promise<void>;
}>;

export type SharedActions = {
  /** Meldet eine Art an; ohne Anmeldung lehnt `requestSharedAction` sie als `invalid_payload` ab. */
  registerKind<T extends RequestedSharedActionType>(kind: SharedActionKind<T>): void;
  /** `requestSharedAction` und `decideSharedAction` für die Befehls-Registry des Syncs. */
  commands: readonly ServerCommand[];
};

const decided = {
  annehmen: 'angenommen',
  ablehnen: 'abgelehnt',
  zurueckziehen: 'zurueckgezogen',
} as const satisfies Record<SharedActionDecision, SharedAction['status']>;

export function createSharedActions(): SharedActions {
  const kinds = new Map<RequestedSharedActionType, SharedActionKind>();

  const requestCommand: ServerCommand<RequestSharedAction> = {
    type: 'requestSharedAction',
    identity: 'none',
    policy: policies.resource('shared_action_request', 'befehl'),
    payload: RequestSharedAction,
    target: (operation) => ({ id: RequestSharedAction.parse(operation.payload).actionId }),
    canonicalRequest: (operation) => RequestSharedAction.parse(operation.payload),
    // Die ID vergibt das Gerät; ein Duplikat ist nur der Retry desselben Antrags.
    duplicate: () => [],
    async execute(tx, { actor, resource, payload, businessKey, at }) {
      const kind = kinds.get(payload.type);
      if (kind === undefined || businessKey !== sharedActionRequestKey(payload.actionId)) throw new CommandRejection('invalid_payload');
      const couplingId = EntityId.parse(resource.couplingId);
      await changeWriter(tx, at)({ entityType: 'shared_action', couplingId }, async (stamp) => {
        await tx.insert(sharedAction).values({
          id: payload.actionId,
          couplingId,
          kind: payload.type,
          requesterPersonId: actor.personId,
          payload: payload.payload,
          status: 'offen',
          ...stamp,
        });
        return payload.actionId;
      });
      const { action, change } = await stored(tx, payload.actionId);
      await kind.request?.(tx, { action, partnerPersonId: EntityId.parse(resource.partnerPersonId), at });
      return { changes: [change], idMappings: [] };
    },
  };

  const decideCommand: ServerCommand<DecideSharedAction> = {
    type: 'decideSharedAction',
    identity: 'none',
    policy: policies.resource('shared_action_decision', 'befehl'),
    payload: DecideSharedAction,
    target: (operation) => {
      const { actionId, decision } = DecideSharedAction.parse(operation.payload);
      const claimedParticipation: SharedActionParticipation = decision === 'zurueckziehen' ? 'antragsteller' : 'partner';
      return { id: actionId, claimedParticipation };
    },
    canonicalRequest: (operation) => DecideSharedAction.parse(operation.payload),
    // Je Person gibt es nur eine Entscheidung; ein Duplikat ist nur deren Retry.
    duplicate: () => [],
    async execute(tx, { actor, resource, payload, businessKey, at }) {
      if (businessKey !== sharedActionDecisionKey(payload.actionId)) throw new CommandRejection('invalid_payload');
      // Die Sperre ordnet gleichzeitige Entscheidungen beider Personen; nur die erste ändert etwas.
      const [current] = await tx.select({ status: sharedAction.status }).from(sharedAction).where(eq(sharedAction.id, payload.actionId)).for('update');
      if (current === undefined) throw new Error('Gemeinsame Aktion fehlt trotz Autorisierung');
      if (current.status !== 'offen') throw new CommandRejection('conflict');
      await changeWriter(tx, at)({ entityType: 'shared_action', couplingId: EntityId.parse(resource.couplingId) }, async (stamp) => {
        await tx.update(sharedAction).set({ status: decided[payload.decision], decidedAt: at, ...updated(stamp) }).where(eq(sharedAction.id, payload.actionId));
        return payload.actionId;
      });
      const { action, change } = await stored(tx, payload.actionId);
      if (payload.decision === 'annehmen') {
        const kind = kinds.get(action.type);
        // Beantragen ließ sich die Aktion nur mit angemeldeter Art; fehlt sie jetzt, ist das ein Integrationsfehler.
        if (kind === undefined) throw new Error(`Art ${action.type} gemeinsamer Aktionen ist nicht angemeldet`);
        await kind.accept(tx, { action, partnerPersonId: actor.personId, at, timeZone: payload.timeZone });
      }
      return { changes: [change], idMappings: [] };
    },
  };

  return {
    registerKind(kind) {
      if (kinds.has(kind.type)) throw new Error(`Art ${kind.type} gemeinsamer Aktionen ist schon angemeldet`);
      kinds.set(kind.type, kind as unknown as SharedActionKind);
    },
    commands: [requestCommand, decideCommand] as unknown as readonly ServerCommand[],
  };
}

/** Beendet alle offenen Aktionen der Kopplung neutral als `zurueckgezogen`; nur für den Entkopplungs-Kern. */
export async function withdrawOpenSharedActions(tx: DbExecutor, couplingId: EntityId, at: Date): Promise<void> {
  const open = await tx
    .select({ id: sharedAction.id })
    .from(sharedAction)
    .where(and(eq(sharedAction.couplingId, couplingId), eq(sharedAction.status, 'offen')))
    .for('update');
  const write = changeWriter(tx, at);
  for (const { id } of open) {
    await write({ entityType: 'shared_action', couplingId }, async (stamp) => {
      await tx.update(sharedAction).set({ status: 'zurueckgezogen', decidedAt: at, ...updated(stamp) }).where(eq(sharedAction.id, id));
      return id;
    });
  }
}

/**
 * Hält eine Entkopplung als gemeinsame Aktion fest, schon entschieden: Niemand antwortet darauf, offen
 * ist sie auf dem Server nie. Nur für den Entkopplungs-Kern; liefert den kanonischen Datensatz.
 */
export async function recordUncouplingAction(
  tx: DbExecutor,
  { id, couplingId, requesterPersonId, status, at }: Readonly<{ id: EntityId; couplingId: EntityId; requesterPersonId: EntityId; status: 'angenommen' | 'abgelehnt'; at: Date }>,
): Promise<CanonicalChange> {
  await changeWriter(tx, at)({ entityType: 'shared_action', couplingId }, async (stamp) => {
    await tx.insert(sharedAction).values({ id, couplingId, kind: 'entkoppeln', requesterPersonId, payload: {}, status, decidedAt: at, ...stamp });
    return id;
  });
  return (await stored(tx, id)).change;
}

/** Die gespeicherte Aktion, typisiert für die Arten und als kanonischer Datensatz für das Gerät. */
async function stored(tx: DbExecutor, actionId: EntityId) {
  const found = (await sharedActionEntity.read(tx, [actionId])).get(actionId);
  if (found === undefined) throw new Error('Gemeinsame Aktion nach dem Schreiben nicht lesbar');
  const action = SharedAction.parse(found.data) as ActionOf<RequestedSharedActionType>;
  return { action, change: canonicalOf(sharedActionEntity, actionId, found) };
}
