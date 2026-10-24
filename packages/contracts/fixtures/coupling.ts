import {
  AcceptInvitationRequest,
  AcceptInvitationResult,
  CheckInvitationRequest,
  CheckInvitationResult,
  CouplingMemberRecord,
  CouplingRecord,
  CouplingStatus,
  CreateInvitationRequest,
  CreateInvitationResult,
  InvitationError,
  InvitationErrorCode,
  InviteCode,
  OnlineRequestId,
  PartnerSharingLevel,
  PartnerSharingRecord,
  PartnerSharingUpsert,
  PhotoSharingLevel,
  PhotoSharingRecord,
  PhotoSharingUpsert,
} from '../src/coupling.ts';
import { fixtures, without } from './define.ts';
import { anna, coupling, now, operation, philipp } from './ids.ts';

const times = { createdAt: now, updatedAt: now };

const couplingRecord = {
  personLowId: philipp,
  personHighId: anna,
  status: 'aktiv',
  startedAt: now,
  endedAt: null,
  reactivatedAt: null,
  ...times,
} as const;

const member = { couplingId: coupling, personId: anna, role: null, displayName: 'Anna', ...times } as const;
const sharing = { ownerPersonId: anna, couplingId: coupling, area: 'ernaehrung', level: 'zusammengefasst', ...times } as const;
const photoSharing = { ownerPersonId: anna, couplingId: coupling, level: 'geteilt', ...times } as const;

export const couplingFixtures = {
  InviteCode: fixtures(InviteCode, {
    valid: { 'sechs Ziffern': '482915', 'mit führender Null': '004211' },
    invalid: { 'fünf Ziffern': '48291', 'sieben Ziffern': '4829150', 'mit Leerzeichen': '482 915', 'als Zahl': 482915 },
  }),
  OnlineRequestId: fixtures(OnlineRequestId, { valid: { 'UUID': operation }, invalid: { 'keine UUID': 'anfrage-1' } }),
  CreateInvitationRequest: fixtures(CreateInvitationRequest, {
    valid: { 'mit requestId': { requestId: operation } },
    invalid: { 'ohne requestId': {}, 'mit Personen-ID': { requestId: operation, personId: philipp } },
  }),
  CreateInvitationResult: fixtures(CreateInvitationResult, {
    valid: { 'Code und Ablauf': { code: '482915', expiresAt: now } },
    invalid: { 'ohne Ablauf': { code: '482915' }, 'mit Einladungs-ID': { code: '482915', expiresAt: now, invitationId: operation } },
  }),
  CheckInvitationRequest: fixtures(CheckInvitationRequest, {
    valid: { 'Code': { code: '482915' } },
    invalid: { 'Code mit Buchstaben': { code: '48291a' }, 'mit Konto-ID': { code: '482915', accountId: philipp } },
  }),
  CheckInvitationResult: fixtures(CheckInvitationResult, {
    valid: { 'neue Kopplung': { inviterDisplayName: 'Philipp', reactivates: false }, 'Reaktivierung': { inviterDisplayName: 'Philipp', reactivates: true } },
    invalid: {
      'mit Personen-ID der einladenden Person': { inviterDisplayName: 'Philipp', reactivates: false, inviterPersonId: philipp },
      'ohne reactivates': { inviterDisplayName: 'Philipp' },
    },
  }),
  AcceptInvitationRequest: fixtures(AcceptInvitationRequest, {
    valid: { 'requestId und Code': { requestId: operation, code: '482915' } },
    invalid: { 'ohne requestId': { code: '482915' }, 'mit Personen-ID': { requestId: operation, code: '482915', personId: anna } },
  }),
  AcceptInvitationResult: fixtures(AcceptInvitationResult, {
    valid: { 'neue Kopplung': { couplingId: coupling, reactivated: false } },
    invalid: { 'ohne Kopplung': { reactivated: true } },
  }),
  InvitationErrorCode: fixtures(InvitationErrorCode, {
    valid: { 'ungültig': 'invite_invalid', 'begrenzt': 'invite_rate_limited' },
    invalid: { 'Fotofehler': 'photo_invalid_image' },
  }),
  InvitationError: fixtures(InvitationError, {
    valid: {
      'verbraucht': { code: 'invite_consumed', retryable: false },
      'begrenzt': { code: 'invite_rate_limited', retryable: true },
      'requestId mit anderem Inhalt': { code: 'operation_conflict', retryable: false },
    },
    invalid: {
      'Begrenzung nicht wiederholbar': { code: 'invite_rate_limited', retryable: false },
      'abgelaufen als wiederholbar': { code: 'invite_expired', retryable: true },
      'mit Kontext': { code: 'invite_invalid', retryable: false, context: { codeHmac: 'abc' } },
      'fremder Code': { code: 'forbidden', retryable: false },
    },
  }),
  CouplingStatus: fixtures(CouplingStatus, { valid: { 'aktiv': 'aktiv' }, invalid: { 'beendet': 'beendet' } }),
  PartnerSharingLevel: fixtures(PartnerSharingLevel, { valid: { 'privat': 'privat' }, invalid: { 'geteilt gilt nur für Fotos': 'geteilt' } }),
  PhotoSharingLevel: fixtures(PhotoSharingLevel, { valid: { 'geteilt': 'geteilt' }, invalid: { 'zusammengefasst gilt nur für Bereiche': 'zusammengefasst' } }),
  CouplingRecord: fixtures(CouplingRecord, {
    valid: {
      'aktiv': couplingRecord,
      'archiviert': { ...couplingRecord, status: 'archiviert', endedAt: now },
      'reaktiviert': { ...couplingRecord, reactivatedAt: now },
    },
    invalid: {
      'Paar unsortiert': { ...couplingRecord, personLowId: anna, personHighId: philipp },
      'archiviert ohne Ende': { ...couplingRecord, status: 'archiviert' },
      'aktiv mit Ende': { ...couplingRecord, endedAt: now },
      'ohne Beginn': without(couplingRecord, 'startedAt'),
    },
  }),
  CouplingMemberRecord: fixtures(CouplingMemberRecord, {
    valid: { 'ohne Rolle': member, 'Rolle Natur': { ...member, role: 'natur' } },
    invalid: { 'leerer Name': { ...member, displayName: '' }, 'unbekannte Rolle': { ...member, role: 'deko' } },
  }),
  PartnerSharingRecord: fixtures(PartnerSharingRecord, {
    valid: { 'zusammengefasst': sharing, 'privat': { ...sharing, area: 'gewicht', level: 'privat' } },
    invalid: { 'Stufe geteilt': { ...sharing, level: 'geteilt' }, 'Bereich Fotos': { ...sharing, area: 'fotos' } },
  }),
  PhotoSharingRecord: fixtures(PhotoSharingRecord, {
    valid: { 'geteilt': photoSharing },
    invalid: { 'Stufe zusammengefasst': { ...photoSharing, level: 'zusammengefasst' }, 'mit Bereich': { ...photoSharing, area: 'ernaehrung' } },
  }),
  PartnerSharingUpsert: fixtures(PartnerSharingUpsert, {
    valid: { 'abschalten': { level: 'privat' }, 'einschalten': { level: 'zusammengefasst' } },
    invalid: {
      'Stufe geteilt': { level: 'geteilt' },
      'mit Eigentümerin': { level: 'privat', ownerPersonId: anna },
      'mit anderem Bereich': { level: 'privat', area: 'gewicht' },
    },
  }),
  PhotoSharingUpsert: fixtures(PhotoSharingUpsert, {
    valid: { 'abschalten': { level: 'privat' }, 'einschalten': { level: 'geteilt' } },
    invalid: { 'Stufe zusammengefasst': { level: 'zusammengefasst' }, 'mit anderer Kopplung': { level: 'geteilt', couplingId: coupling } },
  }),
};
