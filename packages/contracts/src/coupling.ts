import { z } from 'zod';

import { AreaKey, DisplayName, EntityId, Instant } from './base.ts';
import { ContractError } from './errors.ts';
import { IslandRole } from './island.ts';

// Kopplung (Spezifikation 0, Abschnitte 8 und 9): die drei Online-Abläufe zum Koppeln (Code erzeugen,
// Code prüfen, Einladung annehmen) und die kanonischen Datensätze von Kopplung, Mitgliedern und
// Freigaben im Sync. Konto und Person kommen ausschließlich aus der Sitzung; keine Nutzlast nennt sie.

/** Sechsstelliger Einladungscode; führende Nullen gehören dazu. */
export const InviteCode = z.string().regex(/^[0-9]{6}$/);
export type InviteCode = z.infer<typeof InviteCode>;

/**
 * Clientseitige Kennung eines Online-Ablaufs. Der Server bindet das Ergebnis an Konto, Ablaufart und
 * Inhalt der Anfrage; ein identischer Retry erhält es unverändert, auch nach verlorener Antwort.
 */
export const OnlineRequestId = EntityId;
export type OnlineRequestId = z.infer<typeof OnlineRequestId>;

/** Body von `POST /v1/invitations`. */
export const CreateInvitationRequest = z.strictObject({ requestId: OnlineRequestId });
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

/** Der Code im Klartext steht nur in dieser Antwort; der Server speichert ihn nie. */
export const CreateInvitationResult = z.strictObject({ code: InviteCode, expiresAt: Instant });
export type CreateInvitationResult = z.infer<typeof CreateInvitationResult>;

/** Body von `POST /v1/invitations/check`; prüft, ohne den Code zu verbrauchen. */
export const CheckInvitationRequest = z.strictObject({ code: InviteCode });
export type CheckInvitationRequest = z.infer<typeof CheckInvitationRequest>;

/** Wer einlädt und ob die Annahme eine archivierte Kopplung desselben Paars reaktiviert. */
export const CheckInvitationResult = z.strictObject({ inviterDisplayName: DisplayName, reactivates: z.boolean() });
export type CheckInvitationResult = z.infer<typeof CheckInvitationResult>;

/** Body von `POST /v1/invitations/accept`. */
export const AcceptInvitationRequest = z.strictObject({ requestId: OnlineRequestId, code: InviteCode });
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

/** Die Zeilen der Kopplung kommen per Pull; die Antwort nennt nur, was entstanden ist. */
export const AcceptInvitationResult = z.strictObject({ couplingId: EntityId, reactivated: z.boolean() });
export type AcceptInvitationResult = z.infer<typeof AcceptInvitationResult>;

/**
 * Fachliche Ablehnungen der Einladungsabläufe. Die App zeigt für die ersten vier denselben
 * generischen Text, damit die Antwort die Existenz eines Codes nicht unnötig verrät.
 */
export const InvitationErrorCode = z.enum([
  'invite_invalid',
  'invite_expired',
  'invite_consumed',
  'invite_self',
  'already_coupled',
  'invite_rate_limited',
]);
export type InvitationErrorCode = z.infer<typeof InvitationErrorCode>;

/**
 * Fehlerantwort eines Einladungsablaufs ohne Kontext. Nur die Begrenzung ist vorübergehend.
 * `operation_conflict` heißt: dieselbe `requestId` mit anderem Inhalt oder anderer Ablaufart.
 */
export const InvitationError = ContractError.extend({
  code: z.union([InvitationErrorCode, z.literal('operation_conflict')]),
  context: z.never().optional(),
}).refine((error) => error.retryable === (error.code === 'invite_rate_limited'), {
  message: 'Nur die Begrenzung ist vorübergehend',
  path: ['retryable'],
});
export type InvitationError = z.infer<typeof InvitationError>;

/** Status einer Kopplung; archiviert ist sie nach dem Entkoppeln (Spezifikation 5). */
export const CouplingStatus = z.enum(['aktiv', 'archiviert']);
export type CouplingStatus = z.infer<typeof CouplingStatus>;

/** Stufe einer Partnerfreigabe je Bereich (Spezifikation 0, Abschnitt 5). */
export const PartnerSharingLevel = z.enum(['privat', 'zusammengefasst']);
export type PartnerSharingLevel = z.infer<typeof PartnerSharingLevel>;

/** Stufe der Fotofreigabe; sie gehört zu keinem Gesundheitsbereich. */
export const PhotoSharingLevel = z.enum(['privat', 'geteilt']);
export type PhotoSharingLevel = z.infer<typeof PhotoSharingLevel>;

const syncTimes = { createdAt: Instant, updatedAt: Instant };

/** Kanonischer Datensatz der Kopplung (`coupling`); das Paar steht sortiert. */
export const CouplingRecord = z
  .strictObject({
    personLowId: EntityId,
    personHighId: EntityId,
    status: CouplingStatus,
    startedAt: Instant,
    endedAt: Instant.nullable(),
    reactivatedAt: Instant.nullable(),
    ...syncTimes,
  })
  .refine((record) => record.personLowId < record.personHighId, { message: 'Paar sortiert und verschieden', path: ['personHighId'] })
  .refine((record) => (record.status === 'archiviert') === (record.endedAt !== null), {
    message: 'Ende genau bei archivierter Kopplung',
    path: ['endedAt'],
  });
export type CouplingRecord = z.infer<typeof CouplingRecord>;

/**
 * Kanonischer Datensatz eines Kopplungsmitglieds (`coupling_member`). Den Anzeigenamen setzt der
 * Server aus der Person und zieht ihn bei jeder Änderung nach; er ist die einzige Quelle für den
 * Partnernamen auf dem Partnergerät. Die Rolle fehlt bis zum Schlüpfen.
 */
export const CouplingMemberRecord = z.strictObject({
  couplingId: EntityId,
  personId: EntityId,
  role: IslandRole.nullable(),
  displayName: DisplayName,
  ...syncTimes,
});
export type CouplingMemberRecord = z.infer<typeof CouplingMemberRecord>;

/** Kanonischer Datensatz einer Partnerfreigabe (`partner_sharing`); nur die Eigentümerin erhält ihn. */
export const PartnerSharingRecord = z.strictObject({
  ownerPersonId: EntityId,
  couplingId: EntityId,
  area: AreaKey,
  level: PartnerSharingLevel,
  ...syncTimes,
});
export type PartnerSharingRecord = z.infer<typeof PartnerSharingRecord>;

/** Kanonischer Datensatz der Fotofreigabe (`photo_sharing`); nur die Eigentümerin erhält ihn. */
export const PhotoSharingRecord = z.strictObject({
  ownerPersonId: EntityId,
  couplingId: EntityId,
  level: PhotoSharingLevel,
  ...syncTimes,
});
export type PhotoSharingRecord = z.infer<typeof PhotoSharingRecord>;
