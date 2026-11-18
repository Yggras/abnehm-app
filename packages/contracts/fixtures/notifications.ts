import {
  defaultNotificationSetting,
  EncouragementNotificationPayload,
  NotificationIntent,
  NotificationPermission,
  NotificationSettingRecord,
  NotificationSettingUpsert,
  RoleRequestPayload,
  WallClockTime,
} from '../src/notifications.ts';
import { fixtures, without } from './define.ts';
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

/** Philipp stellt den Abend-Check-in auf 20:30 und nimmt Gewicht heraus (#132). */
const philippsSetting = { ...defaultNotificationSetting, eveningTime: '20:30', trackerGewicht: false } as const;

export const notificationFixtures = {
  WallClockTime: fixtures(WallClockTime, {
    valid: { 'Mitternacht': '00:00', 'Mittag': '13:00', 'letzte Minute': '23:59' },
    invalid: {
      '24 Uhr gibt es nicht': '24:00',
      'Stunde ohne führende Null': '9:05',
      'Minute 60': '12:60',
      'mit Sekunden': '12:00:00',
      'Zeitpunkt statt Wanduhrzeit': '2026-10-14T13:00:00.000Z',
    },
  }),
  NotificationSettingUpsert: fixtures(NotificationSettingUpsert, {
    valid: {
      'Standard': defaultNotificationSetting,
      'Abend 20:30, ohne Gewicht': philippsSetting,
      'beide Check-ins und Partner-Pushes aus': { ...defaultNotificationSetting, middayEnabled: false, eveningEnabled: false, partnerPushEnabled: false },
    },
    invalid: {
      'Abend vor Mittag': { ...defaultNotificationSetting, middayTime: '19:00', eveningTime: '13:00' },
      'Abend gleich Mittag': { ...defaultNotificationSetting, eveningTime: '13:00' },
      'Uhrzeit ohne führende Null': { ...defaultNotificationSetting, middayTime: '9:00' },
      'ohne Tracker-Feld': without(defaultNotificationSetting, 'trackerSport'),
      'Eigentümer gehört nicht in die Nutzlast': { ...defaultNotificationSetting, personId: philipp },
      'Ruhezeiten gibt es nicht': { ...defaultNotificationSetting, quietHours: { from: '22:00', to: '07:00' } },
    },
  }),
  NotificationSettingRecord: fixtures(NotificationSettingRecord, {
    valid: { 'Philipps Einstellung': { personId: philipp, ...philippsSetting, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Eigentümer': { ...philippsSetting, createdAt: now, updatedAt: now },
      'Abend vor Mittag': { personId: philipp, ...philippsSetting, eveningTime: '12:00', createdAt: now, updatedAt: now },
    },
  }),
  NotificationPermission: fixtures(NotificationPermission, {
    valid: { 'unentschieden': 'undetermined', 'erlaubt': 'granted', 'verweigert': 'denied' },
    invalid: { 'vorläufig gibt es nicht (keine provisional-Erlaubnis)': 'provisional', 'leer': '' },
  }),
  EncouragementNotificationPayload: fixtures(EncouragementNotificationPayload, {
    valid: { 'Anna, Gemeinsam für Momo': { senderDisplayName: 'Anna', encouragementKey: 'gemeinsam_fuer_momo' } },
    invalid: {
      'Freitext': { senderDisplayName: 'Anna', encouragementKey: 'Kleiner Stups: Trink was 💧' },
      'mit Empfänger': { senderDisplayName: 'Anna', encouragementKey: 'stark_heute', recipientPersonId: philipp },
    },
  }),
  RoleRequestPayload: fixtures(RoleRequestPayload, {
    valid: {
      'Rollenwahl': { actionId: sharedAction, kind: 'rollenwahl', senderDisplayName: 'Anna' },
      'Rollentausch': { actionId: sharedAction, kind: 'rollentausch', senderDisplayName: 'Anna' },
    },
    invalid: {
      'Deko schenken ist keine Rollen-Anfrage': { actionId: sharedAction, kind: 'deko_schenken', senderDisplayName: 'Anna' },
      'ohne Absender': { actionId: sharedAction, kind: 'rollenwahl' },
    },
  }),
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
      'Rollenwahl': {
        ...intent('rollen_anfrage'),
        messageKey: 'rollen_anfrage.rollenwahl',
        payload: { actionId: sharedAction, kind: 'rollenwahl', senderDisplayName: 'Anna' },
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
