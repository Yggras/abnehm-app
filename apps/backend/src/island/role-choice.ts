import { and, eq } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';

import type { SharedActionKind } from '../coupling/shared-actions.ts';
import { couplingMember, island } from '../db/schema/index.ts';
import { CommandRejection } from '../sync/commands.ts';
import { insertNotificationIntent } from '../sync/notification-intents.ts';
import { hatch } from './hatching.ts';

// Rollenwahl (Spezifikation 4, Abschnitte 2.4 und 7): Eine Person schlägt die Verteilung vor, indem sie
// ihre eigene Rolle wählt; der Partner antwortet. Den Rahmen samt Beteiligung, Zurückziehen und
// Ablehnen liefert `shared-actions.ts` (#107), höchstens eine offene Rollenwahl je Kopplung der partielle
// Unique-Index `shared_action_open_role_choice_uq`: Der zweite gleichzeitige Antrag scheitert mit
// `conflict`. Hier stehen nur die Regeln dieser Art.

/**
 * Die Art `rollenwahl`. Beantragen geht nur, solange die Insel auf die Rollen wartet, und benachrichtigt
 * den Partner in derselben Transaktion (`rollen_anfrage`). Die Annahme ist das Schlüpfen (`hatching.ts`,
 * #184) in der Zone des annehmenden Geräts.
 */
export const roleChoiceKind: SharedActionKind<'rollenwahl'> = {
  type: 'rollenwahl',
  async request(tx, { action, partnerPersonId, at }) {
    // Die Sperre ordnet den Antrag hinter ein gleichzeitiges Schlüpfen derselben Insel.
    const [current] = await tx.select({ state: island.state }).from(island).where(eq(island.couplingId, action.couplingId)).for('share');
    if (current?.state !== 'wartet_auf_rollen') throw new CommandRejection('conflict');
    const [requester] = await tx
      .select({ displayName: couplingMember.displayName })
      .from(couplingMember)
      .where(and(eq(couplingMember.couplingId, action.couplingId), eq(couplingMember.personId, action.requesterPersonId)));
    if (requester === undefined) throw new Error('Antragsteller ist kein Mitglied der Kopplung');
    await insertNotificationIntent(tx, {
      intentId: `${action.id}:${partnerPersonId}:rollen_anfrage`,
      sourceEventId: action.id,
      recipientPersonId: partnerPersonId,
      type: 'rollen_anfrage',
      messageKey: 'rollen_anfrage.rollenwahl',
      createdAt: Instant.parse(at.toISOString()),
      payload: { actionId: action.id, kind: 'rollenwahl', senderDisplayName: requester.displayName },
    });
  },
  async accept(tx, { action, partnerPersonId, at, timeZone }) {
    await hatch(tx, {
      couplingId: EntityId.parse(action.couplingId),
      proposerPersonId: EntityId.parse(action.requesterPersonId),
      proposerRole: action.payload.proposerRole,
      partnerPersonId,
      timeZone,
      at,
    });
  },
};
