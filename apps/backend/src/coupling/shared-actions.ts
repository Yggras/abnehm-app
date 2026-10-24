import { and, eq, ne } from 'drizzle-orm';
import type { z } from 'zod';

import { EntityId } from '@abnehm/contracts/base';
import {
  DecideSharedAction,
  RequestSharedAction,
  sharedActionDecisionKey,
  sharedActionRequestKey,
  type RequestedSharedActionType,
  type SharedAction,
  type SharedActionDecision,
} from '@abnehm/contracts/island';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { policies } from '../authorization/authorization.ts';
import type { DbExecutor } from '../database.ts';
import { couplingMember, sharedAction } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { canonicalOf } from '../sync/sync.ts';
import { sharedActionEntity, sharedActionOf } from './coupling-entities.ts';

// Gemeinsame Aktionen (Spezifikation 0, Abschnitt 9): die Fachbefehle `requestSharedAction` und
// `decideSharedAction` samt Art-Registry. Spezifikation 4 meldet Rollenwahl, Rollentausch und Deko
// schenken als Arten an; jede bringt ihr Nutzlast-Schema und ihre Zustandsänderung bei Annahme mit.
// Beteiligung und aktive Kopplung prüft die zentrale Autorisierung, bevor ein Befehl läuft. Eine Aktion
// geht genau einmal von `offen` nach `angenommen`, `abgelehnt` oder `zurueckgezogen`. Entkoppeln ist
// keine Art: Niemand entscheidet darüber, der Kern in `uncoupling.ts` nimmt es sofort an.

type ActionOf<T extends RequestedSharedActionType> = Extract<SharedAction, { type: T }>;

/** Was eine Art über ihre Aktion erfährt; `partnerPersonId` ist die Person, die antwortet. */
export type SharedActionContext<T extends RequestedSharedActionType> = Readonly<{
  action: ActionOf<T>;
  partnerPersonId: EntityId;
  at: Date;
}>;

export type SharedActionKind<T extends RequestedSharedActionType = RequestedSharedActionType> = Readonly<{
  type: T;
  /** Nutzlast der Art, in der Form, die `SharedAction` für sie festlegt. */
  payload: z.ZodType<ActionOf<T>['payload']>;
  /**
   * Prüft beim Beantragen den Fachzustand und legt etwa den Intent für den Partner an. Läuft im Savepoint
   * des Antrags; wirft sie `CommandRejection`, entsteht keine Aktion.
   */
  request?(tx: DbExecutor, context: SharedActionContext<T>): Promise<void>;
  /** Fachliche Zustandsänderung bei Annahme, im Savepoint der Entscheidung; wirft sie, bleibt die Aktion offen. */
  accept(tx: DbExecutor, context: SharedActionContext<T>): Promise<void>;
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
    async execute(tx, { actor, payload, businessKey, at }) {
      if (businessKey !== sharedActionRequestKey(payload.actionId)) throw new CommandRejection('invalid_payload');
      const kind = kinds.get(payload.type);
      const kindPayload = kind?.payload.safeParse(payload.payload);
      if (kind === undefined || kindPayload?.success !== true) throw new CommandRejection('invalid_payload');
      const { couplingId, partnerPersonId } = await activeCouplingOf(tx, actor.personId);
      const row = await writeAction(tx, couplingId, at, (serverVersion) =>
        tx
          .insert(sharedAction)
          .values({
            id: payload.actionId,
            couplingId,
            kind: payload.type,
            requesterPersonId: actor.personId,
            payload: kindPayload.data,
            status: 'offen',
            createdAt: at,
            updatedAt: at,
            serverVersion,
          })
          .returning(),
      );
      await kind.request?.(tx, { action: sharedActionOf(row) as ActionOf<RequestedSharedActionType>, partnerPersonId, at });
      return { changes: [await canonical(tx, payload.actionId)], idMappings: [] };
    },
  };

  const decideCommand: ServerCommand<DecideSharedAction> = {
    type: 'decideSharedAction',
    identity: 'none',
    policy: policies.resource('shared_action_decision', 'befehl'),
    payload: DecideSharedAction,
    target: (operation) => {
      const { actionId, decision } = DecideSharedAction.parse(operation.payload);
      return { id: actionId, claimedParticipation: decision === 'zurueckziehen' ? 'antragsteller' : 'partner' };
    },
    canonicalRequest: (operation) => DecideSharedAction.parse(operation.payload),
    // Je Person gibt es nur eine Entscheidung; ein Duplikat ist nur deren Retry.
    duplicate: () => [],
    async execute(tx, { actor, payload, businessKey, at }) {
      if (businessKey !== sharedActionDecisionKey(payload.actionId)) throw new CommandRejection('invalid_payload');
      // Die Sperre ordnet gleichzeitige Entscheidungen beider Personen; nur die erste ändert etwas.
      const [current] = await tx.select().from(sharedAction).where(eq(sharedAction.id, payload.actionId)).for('update');
      if (current === undefined) throw new Error('Gemeinsame Aktion fehlt trotz Autorisierung');
      if (current.status !== 'offen') throw new CommandRejection('conflict');
      const row = await writeAction(tx, current.couplingId, at, (serverVersion) =>
        tx
          .update(sharedAction)
          .set({ status: decided[payload.decision], decidedAt: at, updatedAt: at, serverVersion })
          .where(eq(sharedAction.id, current.id))
          .returning(),
      );
      if (payload.decision === 'annehmen') {
        const action = sharedActionOf(row) as ActionOf<RequestedSharedActionType>;
        const kind = kinds.get(action.type);
        // Beantragen ließ sich die Aktion nur mit angemeldeter Art; fehlt sie jetzt, ist das ein Integrationsfehler.
        if (kind === undefined) throw new Error(`Art ${action.type} gemeinsamer Aktionen ist nicht angemeldet`);
        await kind.accept(tx, { action, partnerPersonId: actor.personId, at });
      }
      return { changes: [await canonical(tx, payload.actionId)], idMappings: [] };
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
  for (const { id } of open) {
    await writeAction(tx, couplingId, at, (serverVersion) =>
      tx
        .update(sharedAction)
        .set({ status: 'zurueckgezogen', decidedAt: at, updatedAt: at, serverVersion })
        .where(eq(sharedAction.id, id))
        .returning(),
    );
  }
}

/**
 * Hält eine Entkopplung als gemeinsame Aktion fest, schon entschieden: Niemand antwortet darauf, offen
 * ist sie auf dem Server nie. Nur für den Entkopplungs-Kern.
 */
export async function recordUncouplingAction(
  tx: DbExecutor,
  action: Readonly<{ id: EntityId; couplingId: EntityId; requesterPersonId: EntityId; status: 'angenommen' | 'abgelehnt'; at: Date }>,
): Promise<void> {
  const { id, couplingId, requesterPersonId, status, at } = action;
  await writeAction(tx, couplingId, at, (serverVersion) =>
    tx
      .insert(sharedAction)
      .values({ id, couplingId, kind: 'entkoppeln', requesterPersonId, payload: {}, status, decidedAt: at, createdAt: at, updatedAt: at, serverVersion })
      .returning(),
  );
}

type ActionRow = typeof sharedAction.$inferSelect;

/** Schreibt eine Aktion unter neuer Serverversion; aktive Mitglieder erhalten sie im Pull. */
async function writeAction(tx: DbExecutor, couplingId: string, at: Date, write: (serverVersion: bigint) => Promise<ActionRow[]>): Promise<ActionRow> {
  const serverVersion = await nextServerVersion(tx);
  const [row] = await write(serverVersion);
  if (row === undefined) throw new Error('Gemeinsame Aktion nicht geschrieben');
  await recordChange(tx, { position: serverVersion, entityType: 'shared_action', entityId: row.id, operation: 'upsert', couplingId, createdAt: at });
  return row;
}

async function canonical(tx: DbExecutor, actionId: EntityId): Promise<CanonicalChange> {
  const stored = (await sharedActionEntity.read(tx, [actionId])).get(actionId);
  if (stored === undefined) throw new Error('Gemeinsame Aktion nach dem Schreiben nicht lesbar');
  return canonicalOf(sharedActionEntity, actionId, stored);
}

/** Kopplung und Partner der Person; die aktive Mitgliedschaft hat die Autorisierung schon geprüft. */
async function activeCouplingOf(tx: DbExecutor, personId: EntityId) {
  const [own] = await tx
    .select({ couplingId: couplingMember.couplingId })
    .from(couplingMember)
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')));
  if (own === undefined) throw new Error('Aktive Kopplung fehlt trotz Autorisierung');
  const [partner] = await tx
    .select({ personId: couplingMember.personId })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, own.couplingId), ne(couplingMember.personId, personId)));
  if (partner === undefined) throw new Error('Partner der aktiven Kopplung fehlt');
  return { couplingId: own.couplingId, partnerPersonId: EntityId.parse(partner.personId) };
}
