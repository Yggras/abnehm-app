import { z } from 'zod';

import { type AreaKey, CatalogKey, DisplayName, EntityId, Instant, MessageKey } from './base.ts';
import { uuidV5 } from './ids.ts';
import { EncouragementKey } from './partner.ts';
import { RouteTarget } from './routes.ts';
import { InstallationId } from './sync.ts';

// Benachrichtigungsabsichten (Spezifikation 0, Abschnitt 2). Fachmodule erzeugen sie in der
// Transaktion des auslösenden Ereignisses, Spezifikation 5 stellt sie höchstens einmal zu.
// Die Payloads sind strikt: Gesundheitswerte haben darin keinen Platz.

/** Nutzlast von `rollen_anfrage`; der Textkatalog unterscheidet Rollenwahl und Rollentausch über `kind`. */
export const RoleRequestPayload = z.strictObject({
  actionId: EntityId,
  kind: z.enum(['rollenwahl', 'rollentausch']),
  senderDisplayName: DisplayName,
});

/** Nutzlast von `levelaufstieg`: das höchste neu erreichte Level (Spezifikation 0, Abschnitt 4). */
export const LevelUpPayload = z.strictObject({ level: z.int().min(2) });

/** Nutzlast von `anfeuern`: Absender-Anzeigename und fester Botschaftsschlüssel (Spezifikation 5, Abschnitt 4). */
export const EncouragementNotificationPayload = z.strictObject({ senderDisplayName: DisplayName, encouragementKey: EncouragementKey });

/** Nutzlast von `entkopplung`: reine Information an den Partner, keine Anfrage (Spezifikation 5, Abschnitt 9). */
export const UncouplingNotificationPayload = z.strictObject({ actionId: EntityId, senderDisplayName: DisplayName });

const payloads = {
  anfeuern: EncouragementNotificationPayload,
  levelaufstieg: LevelUpPayload,
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
  entkopplung: UncouplingNotificationPayload,
};

type IntentType = keyof typeof payloads;

/** ID eines Intents: `<sourceEventId>:<recipientPersonId>:<type>`, damit jedes Ereignis je Empfänger höchstens einen Intent erzeugt. */
export function notificationIntentId({ sourceEventId, recipientPersonId, type }: Readonly<{
  sourceEventId: EntityId;
  recipientPersonId: EntityId;
  type: IntentType;
}>): string {
  return `${sourceEventId}:${recipientPersonId}:${type}`;
}

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
    .refine((value) => value.intentId === notificationIntentId(value), {
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
 * `data` eines Server-Pushes (Spezifikation 5, Abschnitte 8 und 9): der Intent und sein Ziel aus
 * `notificationTarget`. Titel und Text stehen nur in der Benachrichtigung selbst; Gesundheitswerte
 * haben hier keinen Platz. Die App öffnet beim Antippen ein unbekanntes Ziel als `today`
 * (`routeTargetOrToday`).
 */
export const ServerPushData = z.strictObject({ intentId: z.string().min(1).max(200), target: RouteTarget });
export type ServerPushData = z.infer<typeof ServerPushData>;

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

/** Minute des Tages (0–1439) einer Wanduhrzeit. */
export function wallClockMinutes(time: WallClockTime): number {
  const parsed = WallClockTime.parse(time);
  return Number(parsed.slice(0, 2)) * 60 + Number(parsed.slice(3, 5));
}

/** Wanduhrzeit `HH:MM` zu einer Minute des Tages (0–1439). */
export function wallClockTimeOf(minutes: number): WallClockTime {
  const pad = (value: number) => String(value).padStart(2, '0');
  return WallClockTime.parse(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
}

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
const eveningAfterMidday = (value: { middayTime: string; eveningTime: string }) => value.eveningTime > value.middayTime;
const eveningAfterMiddayIssue = { message: 'Der Abend-Check-in muss nach dem Mittag-Check-in liegen', path: ['eveningTime'] };

/**
 * Generisches Upsert der Benachrichtigungseinstellung (Spezifikation 5, Abschnitte 6 und 10): eine je
 * Person mit der ID aus `notificationSettingId`, Last-Write-Wins, nur die Eigentümerin liest und
 * schreibt. Die Uhrzeiten sind lokale Wanduhrzeiten der jeweils aktuellen Gerätezone.
 */
export const NotificationSettingUpsert = z.strictObject(notificationSettingFields).refine(eveningAfterMidday, eveningAfterMiddayIssue);
export type NotificationSettingUpsert = z.infer<typeof NotificationSettingUpsert>;

/** Kanonischer Datensatz der Benachrichtigungseinstellung (`notification_setting`); nur die Eigentümerin erhält ihn. */
export const NotificationSettingRecord = z
  .strictObject({ personId: EntityId, ...notificationSettingFields, createdAt: Instant, updatedAt: Instant })
  .refine(eveningAfterMidday, eveningAfterMiddayIssue);
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

const settingKeys = Object.keys(notificationSettingFields) as (keyof NotificationSettingUpsert)[];

/** Nur die Felder der Einstellung, etwa aus einer Zeile oder einem Datensatz mit Eigentümer und Zeitpunkten. */
export function notificationSettingOf(value: NotificationSettingUpsert): NotificationSettingUpsert {
  return Object.fromEntries(settingKeys.map((key) => [key, value[key]])) as NotificationSettingUpsert;
}

/** Ob zwei Einstellungen in allen Feldern übereinstimmen. */
export function sameNotificationSetting(a: NotificationSettingUpsert, b: NotificationSettingUpsert): boolean {
  return settingKeys.every((key) => a[key] === b[key]);
}

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

const notificationSettingNamespace = 'a3c1f0e2-5b7d-4e9a-8c6f-1d2e3f4a5b66';

/**
 * Deterministische ID der Benachrichtigungseinstellung einer Person (UUIDv5): Zwei Geräte, die sie
 * gleichzeitig anlegen, erzeugen dieselbe ID und damit keine Dublette.
 */
export function notificationSettingId(personId: EntityId): EntityId {
  return EntityId.parse(uuidV5(notificationSettingNamespace, `notification_setting:${personId}`));
}

/** Plattform einer Push-Installation. */
export const PushPlatform = z.enum(['ios', 'android']);
export type PushPlatform = z.infer<typeof PushPlatform>;

/**
 * Expo-Push-Token, wie `getExpoPushTokenAsync` es liefert. Die Form folgt `Expo.isExpoPushToken` aus
 * `expo-server-sdk` (https://github.com/expo/expo-server-sdk-node/blob/main/src/ExpoClient.ts):
 * `ExponentPushToken[…]` oder `ExpoPushToken[…]`. Die Höchstlänge ist ein Designwert gegen
 * übergroße Nutzlasten, nicht belegt.
 */
export const ExpoPushToken = z
  .string()
  .max(256)
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/);
export type ExpoPushToken = z.infer<typeof ExpoPushToken>;

/**
 * „Registrieren oder aktualisieren“ der Push-Installation dieses Geräts (Spezifikation 5, Abschnitt 9).
 * Die Person und die Sitzung kommen aus der Sitzung, nie aus der Nutzlast. Die Installationskennung ist
 * dieselbe wie im Sync. Das Token gelangt nur über diesen Endpunkt zum Server, nie über den Fach-Sync.
 */
export const RegisterPushInstallationRequest = z.strictObject({
  installationKey: InstallationId,
  platform: PushPlatform,
  expoPushToken: ExpoPushToken,
  permission: NotificationPermission,
});
export type RegisterPushInstallationRequest = z.infer<typeof RegisterPushInstallationRequest>;

/**
 * „Eigene Installation deaktivieren“ (Spezifikation 5, Abschnitt 9): der Pfadparameter
 * `POST /v1/push-installations/:installationKey/deactivate`. Eine fremde, unbekannte oder ungültige
 * Kennung lehnt der Guard mit `forbidden` ab, ohne zu verraten, ob es sie gibt.
 */
export const DeactivatePushInstallationParams = z.strictObject({ installationKey: InstallationId });
export type DeactivatePushInstallationParams = z.infer<typeof DeactivatePushInstallationParams>;
