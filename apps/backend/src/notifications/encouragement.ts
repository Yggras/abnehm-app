import { and, count, eq } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { notificationIntentId } from '@abnehm/contracts/notifications';
import {
  EncouragementKey,
  EncouragementRecord,
  encouragementPushStatus,
  SendEncouragement,
  sendEncouragementKey,
} from '@abnehm/contracts/partner';

import { policies } from '../authorization/authorization.ts';
import { changeWriter } from '../coupling/change-writer.ts';
import { couplingMember, encouragement } from '../db/schema/index.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { insertNotificationIntent } from '../sync/notification-intents.ts';
import { iso, isoOrNull, serverManaged } from '../sync/registry.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';

// Anfeuern auf dem Server (Spezifikation 5, Abschnitte 4, 10 und 11; #123). Die Anfeuerung entsteht nur
// über `sendEncouragement`, gedankt wird nur über `thankEncouragements`; ein generisches Update gibt es
// nicht. Die Autorisierung (`encouragement_send`) lässt nur aktive Mitglieder senden und liefert die
// Kopplung samt Partner als Fakten: Der Empfänger kommt allein daraus, nie aus der Nutzlast. Den Push
// stellt der Zusteller aus #142 zu; keine Energiebuchung und keine Verbindung zu Tageszielen.

/** Die Anfeuerung im Sync: lesbar für beide aktiven Mitglieder der Kopplung. */
export const encouragementEntity = serverManaged({
  entityType: 'encouragement',
  resource: 'encouragement',
  table: encouragement,
  record: (row) =>
    EncouragementRecord.parse({
      couplingId: row.couplingId,
      senderPersonId: row.senderPersonId,
      recipientPersonId: row.recipientPersonId,
      messageKey: row.messageKey,
      sentAt: iso(row.sentAt),
      localDate: row.localDate,
      timeZone: row.timeZone,
      utcOffsetMinutes: row.utcOffsetMinutes,
      pushStatus: row.pushStatus,
      thankedAt: isoOrNull(row.thankedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }),
});

export const sendEncouragementCommand: ServerCommand<SendEncouragement> = {
  type: 'sendEncouragement',
  identity: 'none',
  policy: policies.resource('encouragement_send', 'befehl'),
  payload: SendEncouragement,
  target: (operation) => ({ id: SendEncouragement.parse(operation.payload).encouragementId }),
  canonicalRequest: (operation) => SendEncouragement.parse(operation.payload),
  // Die ID vergibt das Gerät; ein Duplikat ist nur der Retry derselben Anfeuerung.
  duplicate: () => [],
  async execute(tx, { actor, resource, payload, businessKey, at }) {
    if (businessKey !== sendEncouragementKey(payload.encouragementId)) throw new CommandRejection('invalid_payload');
    const messageKey = EncouragementKey.safeParse(payload.messageKey);
    if (!messageKey.success) throw new CommandRejection('unknown_catalog_key');
    // Dieselbe ID ohne verarbeitete Operation desselben Schlüssels gibt es nur bei manipulierter Nutzlast.
    if (resource.exists) throw new CommandRejection('conflict');
    const couplingId = EntityId.parse(resource.couplingId);
    const recipientPersonId = EntityId.parse(resource.partnerPersonId);

    // Die Sperre auf das eigene Mitglied ordnet gleichzeitige Anfeuerungen desselben Absenders, damit
    // nie mehr als drei je Absendertag einen Push bekommen.
    const [sender] = await tx
      .select({ displayName: couplingMember.displayName })
      .from(couplingMember)
      .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, actor.personId)))
      .for('update');
    if (sender === undefined) throw new Error('Absender ist kein Mitglied der Kopplung');
    const [earlier] = await tx
      .select({ total: count() })
      .from(encouragement)
      .where(and(eq(encouragement.senderPersonId, actor.personId), eq(encouragement.localDate, payload.localDate)));
    const receivedAt = Instant.parse(at.toISOString());
    const pushStatus = encouragementPushStatus({ earlierToday: earlier?.total ?? 0, createdAt: payload.createdAt, receivedAt });

    await changeWriter(tx, at)({ entityType: 'encouragement', couplingId }, async (stamp) => {
      await tx.insert(encouragement).values({
        id: payload.encouragementId,
        couplingId,
        senderPersonId: actor.personId,
        recipientPersonId,
        messageKey: messageKey.data,
        sentAt: new Date(payload.createdAt),
        localDate: payload.localDate,
        timeZone: payload.timeZone,
        utcOffsetMinutes: payload.utcOffsetMinutes,
        pushStatus,
        ...stamp,
      });
      return payload.encouragementId;
    });
    if (pushStatus === 'ausstehend') {
      await insertNotificationIntent(tx, {
        intentId: notificationIntentId({ sourceEventId: payload.encouragementId, recipientPersonId, type: 'anfeuern' }),
        sourceEventId: payload.encouragementId,
        recipientPersonId,
        type: 'anfeuern',
        messageKey: 'anfeuern',
        createdAt: receivedAt,
        payload: { senderDisplayName: sender.displayName, encouragementKey: messageKey.data },
      });
    }
    return { changes: [await canonicalAfterWrite(tx, encouragementEntity, payload.encouragementId)], idMappings: [] };
  },
};
