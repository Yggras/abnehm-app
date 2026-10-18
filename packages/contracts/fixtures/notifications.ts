import { NotificationIntent } from '../src/notifications.ts';
import { fixtures } from './define.ts';
import { anna, challenge, now, philipp, sharedAction, sharedEvent } from './ids.ts';

const intent = <T extends string>(type: T, recipient: string = philipp) => ({
  intentId: `${sharedEvent}:${recipient}:${type}`,
  sourceEventId: sharedEvent,
  recipientPersonId: recipient,
  type,
  messageKey: type,
  createdAt: now,
});

const encouragement = {
  ...intent('anfeuern'),
  payload: { senderDisplayName: 'Anna', encouragementKey: 'gemeinsam_fuer_momo' },
} as const;

export const notificationFixtures = {
  NotificationIntent: fixtures(NotificationIntent, {
    valid: {
      'Anfeuern': encouragement,
      'Levelaufstieg an Anna': { ...intent('levelaufstieg', anna), payload: { level: 7 } },
      'Gebiet': { ...intent('gebiet'), payload: { gebietKey: 'mangrovenbucht' } },
      'Projektabschluss': { ...intent('projektabschluss'), payload: { templateKey: 'leuchtturm' } },
      'Challenge-Vorschlag': {
        ...intent('challenge_vorschlag'),
        payload: {
          challengeId: challenge,
          templateKey: 'gut_getrunken',
          expiresAt: '2026-10-16T12:00:00.000Z',
          senderDisplayName: 'Anna',
        },
      },
      'Challenge-Erfolg': {
        ...intent('challenge_erfolg'),
        payload: { challengeId: challenge, templateKey: 'gut_getrunken' },
      },
      'Rollentausch': {
        ...intent('rollen_anfrage'),
        messageKey: 'rollen_anfrage.rollentausch',
        payload: { actionId: sharedAction, kind: 'rollentausch', senderDisplayName: 'Anna' },
      },
      'Deko-Geschenk': {
        ...intent('deko_geschenk'),
        payload: { actionId: sharedAction, decoKey: 'muschelkranz', senderDisplayName: 'Anna' },
      },
      'Entkopplung': { ...intent('entkopplung'), payload: { actionId: sharedAction, senderDisplayName: 'Anna' } },
    },
    invalid: {
      'Gesundheitswert in der Payload': {
        ...encouragement,
        payload: { ...encouragement.payload, partnerWaterPercent: 64 },
      },
      'Freitext statt Botschaftsschlüssel': {
        ...encouragement,
        payload: { senderDisplayName: 'Anna', encouragementKey: 'Trink was!' },
      },
      'intentId passt nicht zu Ereignis, Empfänger und Art': { ...encouragement, intentId: sharedEvent },
      'Payload einer anderen Art': { ...intent('levelaufstieg'), payload: encouragement.payload },
      'Insel-Ereignis': { ...intent('insel_ereignis'), payload: {} },
      'Entkoppeln als Rollen-Anfrage': {
        ...intent('rollen_anfrage'),
        payload: { actionId: sharedAction, kind: 'entkoppeln', senderDisplayName: 'Anna' },
      },
    },
  }),
};
