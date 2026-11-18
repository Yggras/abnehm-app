import { z } from 'zod';

import { CatalogKey, DisplayName, EntityId, Instant, MessageKey } from './base.ts';
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
