import { z } from 'zod';

import { type AreaKey, CatalogKey, DisplayName, EntityId, Instant, MessageKey } from './base.ts';
import { uuidV5 } from './ids.ts';
import { EncouragementKey } from './partner.ts';
import type { RouteTarget } from './routes.ts';

// Benachrichtigungsabsichten (Spezifikation 0, Abschnitt 2). Fachmodule erzeugen sie in der
// Transaktion des auslösenden Ereignisses, Spezifikation 5 stellt sie höchstens einmal zu.
// Die Payloads sind strikt: Gesundheitswerte haben darin keinen Platz.

/** Nutzlast von `rollen_anfrage`; der Textkatalog unterscheidet Rollenwahl und Rollentausch über `kind`. */
export const RoleRequestPayload = z.strictObject({
  actionId: EntityId,
  kind: z.enum(['rollenwahl', 'rollentausch']),
  senderDisplayName: DisplayName,
});

const payloads = {
  anfeuern: z.strictObject({ senderDisplayName: DisplayName, encouragementKey: EncouragementKey }),
  levelaufstieg: z.strictObject({ level: z.int().min(2) }),
  gebiet: z.strictObject({ gebietKey: CatalogKey }),
  projektabschluss: z.strictObject({ templateKey: CatalogKey }),
  challenge_vorschlag: z.strictObject({
    challengeId: EntityId,
    templateKey: CatalogKey,
    expiresAt: Instant,
    senderDisplayName: DisplayName,
  }),
  challenge_erfolg: z.strictObject({ challengeId: EntityId, templateKey: CatalogKey }),
  rollen_anfrage: RoleRequestPayload,
  deko_geschenk: z.strictObject({ actionId: EntityId, decoKey: CatalogKey, senderDisplayName: DisplayName }),
  /** Reine Information, keine Anfrage. */
  entkopplung: z.strictObject({ actionId: EntityId, senderDisplayName: DisplayName }),
};

type IntentType = keyof typeof payloads;

function intent<T extends IntentType>(type: T) {
  return z
    .strictObject({
      /** `<sourceEventId>:<recipientPersonId>:<type>`, damit jedes Ereignis je Empfänger höchstens einen Intent erzeugt. */
      intentId: z.string(),
      sourceEventId: EntityId,
      recipientPersonId: EntityId,
      type: z.literal(type),
      messageKey: MessageKey,
      createdAt: Instant,
      payload: payloads[type],
    })
    .refine((value) => value.intentId === `${value.sourceEventId}:${value.recipientPersonId}:${value.type}`, {
      message: 'intentId muss <sourceEventId>:<recipientPersonId>:<type> sein',
      path: ['intentId'],
    });
}

/** Vollständiger Katalog der Push-Anlässe; Insel-Ereignisse, Danke und Tages-Check-ins gehören nicht dazu. */
export const NotificationIntent = z.discriminatedUnion('type', [
  intent('anfeuern'),
  intent('levelaufstieg'),
  intent('gebiet'),
  intent('projektabschluss'),
  intent('challenge_vorschlag'),
  intent('challenge_erfolg'),
  intent('rollen_anfrage'),
  intent('deko_geschenk'),
  intent('entkopplung'),
]);
export type NotificationIntent = z.infer<typeof NotificationIntent>;

/** Ziel beim Antippen einer Benachrichtigung (Katalog in Spezifikation 0, Abschnitt 2). */
export function notificationTarget(intent: NotificationIntent): RouteTarget {
  switch (intent.type) {
    case 'anfeuern':
      return { type: 'partner', focus: 'received_encouragement' };
    case 'levelaufstieg':
    case 'gebiet':
      return { type: 'momo' };
    case 'projektabschluss':
      return { type: 'momo', view: 'projekt' };
    case 'challenge_vorschlag':
    case 'challenge_erfolg':
    case 'rollen_anfrage':
    case 'deko_geschenk':
    case 'entkopplung':
      return { type: 'partner' };
  }
}

/**
 * Erlaubnis für Mitteilungen auf einem Gerät (Spezifikation 5, Abschnitt 8): `undetermined`, solange
 * die Person den Systemdialog nicht beantwortet hat. Die App liest sie über den Mitteilungs-Port; Seeds
 * legen sie je Installation fest, die Push-Installation meldet sie dem Server (Abschnitt 9).
 */
export const NotificationPermission = z.enum(['undetermined', 'granted', 'denied']);
export type NotificationPermission = z.infer<typeof NotificationPermission>;

/** Lokale Wanduhrzeit `HH:MM` (00:00–23:59), etwa eines Tages-Check-ins; ohne Datum und Zone. */
export const WallClockTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export type WallClockTime = z.infer<typeof WallClockTime>;

const notificationSettingFields = {
  middayEnabled: z.boolean(),
  middayTime: WallClockTime,
  eveningEnabled: z.boolean(),
  eveningTime: WallClockTime,
  /** Tracker, die die Tages-Check-ins berücksichtigen. */
  trackerErnaehrung: z.boolean(),
  trackerWasser: z.boolean(),
  trackerSport: z.boolean(),
  trackerGewicht: z.boolean(),
  /** Alle Server-Pushes: Anfeuern, Challenge-Vorschläge, Insel-Meilensteine und gemeinsame Vorgänge. */
  partnerPushEnabled: z.boolean(),
};

/**
 * Abend nach Mittag, auch wenn einer der beiden aus ist, wie der `CHECK` beider Datenbanken. `HH:MM`
 * ordnet sich als Zeichenfolge wie die Uhrzeit.
 */
const eveningAfterMidday = [
  (value: { middayTime: string; eveningTime: string }) => value.eveningTime > value.middayTime,
  { message: 'Der Abend-Check-in muss nach dem Mittag-Check-in liegen', path: ['eveningTime'] },
] as const;

/**
 * Generisches Upsert der Benachrichtigungseinstellung (Spezifikation 5, Abschnitte 6 und 10): eine je
 * Person mit der ID aus `notificationSettingId`, Last-Write-Wins, nur die Eigentümerin liest und
 * schreibt. Die Uhrzeiten sind lokale Wanduhrzeiten der jeweils aktuellen Gerätezone.
 */
export const NotificationSettingUpsert = z.strictObject(notificationSettingFields).refine(...eveningAfterMidday);
export type NotificationSettingUpsert = z.infer<typeof NotificationSettingUpsert>;

/** Kanonischer Datensatz der Benachrichtigungseinstellung (`notification_setting`); nur die Eigentümerin erhält ihn. */
export const NotificationSettingRecord = z
  .strictObject({ personId: EntityId, ...notificationSettingFields, createdAt: Instant, updatedAt: Instant })
  .refine(...eveningAfterMidday);
export type NotificationSettingRecord = z.infer<typeof NotificationSettingRecord>;

/**
 * Standard, solange die Person nichts gespeichert hat: Mittag an, 13:00; Abend an, 19:00; alle vier
 * Tracker; Partner-Pushes an. Die Uhrzeiten sind Designwerte aus #37, nicht wissenschaftlich belegt.
 */
export const defaultNotificationSetting: NotificationSettingUpsert = Object.freeze({
  middayEnabled: true,
  middayTime: '13:00',
  eveningEnabled: true,
  eveningTime: '19:00',
  trackerErnaehrung: true,
  trackerWasser: true,
  trackerSport: true,
  trackerGewicht: true,
  partnerPushEnabled: true,
});

const checkInTrackerFields = {
  ernaehrung: 'trackerErnaehrung',
  wasser: 'trackerWasser',
  sport: 'trackerSport',
  gewicht: 'trackerGewicht',
} as const satisfies Record<AreaKey, keyof NotificationSettingUpsert>;

/** Feld der Einstellung, das einen Tracker in die Check-ins aufnimmt. */
export function checkInTrackerField(area: AreaKey): (typeof checkInTrackerFields)[AreaKey] {
  return checkInTrackerFields[area];
}

/** Tracker, die die Check-ins berücksichtigen, in der festen Reihenfolge Ernährung, Wasser, Sport, Gewicht. */
export function checkInTrackers(setting: NotificationSettingUpsert): AreaKey[] {
  return (Object.keys(checkInTrackerFields) as AreaKey[]).filter((area) => setting[checkInTrackerFields[area]]);
}

const notificationSettingNamespace = 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b66';

/**
 * Deterministische ID der Benachrichtigungseinstellung einer Person (UUIDv5): Zwei Geräte, die sie
 * gleichzeitig anlegen, erzeugen dieselbe ID und damit keine Dublette.
 */
export function notificationSettingId(personId: EntityId): EntityId {
  return EntityId.parse(uuidV5(notificationSettingNamespace, `notification_setting:${personId}`));
}
