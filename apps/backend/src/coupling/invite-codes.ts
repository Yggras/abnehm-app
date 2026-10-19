import { createHmac } from 'node:crypto';

import { InviteCode } from '@abnehm/contracts/coupling';

import { canonicalJson } from '../canonical-json.ts';
import type { OnlineFlow } from '../online/flows.ts';

// Einladungscodes (Spezifikation 0, Abschnitt 9). Alles hängt an einem eigenen Secret, getrennt vom
// Better-Auth-Secret; die drei Verwendungen sind über ein Präfix voneinander getrennt.
//
// Der Server speichert nie den Klartext eines Codes. Damit ein Retry der Erzeugung dennoch denselben
// Code liefert, ist der Code eine HMAC-Ableitung der zufälligen Einladungs-ID: HMAC-SHA256 ist mit
// geheimem Schlüssel eine Pseudozufallsfunktion (RFC 2104, Abschnitt 6,
// https://www.rfc-editor.org/rfc/rfc2104#section-6), die UUID trägt 122 zufällige Bits. Ohne Secret
// ist der Code also nicht vorherzusagen; mit Secret ließen sich ohnehin alle eine Million Codes gegen
// den gespeicherten HMAC durchprobieren, die Ableitung verrät darüber hinaus nichts.

/** Mindestlänge des Secrets wie beim Better-Auth-Secret; `openssl rand -hex 32` ergibt 64 Zeichen. */
export const MIN_INVITE_CODE_SECRET_LENGTH = 32;

const CODE_SPACE = 1_000_000n;

export type InviteCodes = {
  /** Der Code einer Einladung, aus ihrer ID abgeleitet; dieselbe ID ergibt immer denselben Code. */
  codeFor(invitationId: string): InviteCode;
  /** Was die Tabelle `invitation` speichert und worüber sie den eingegebenen Code findet. */
  hmacOf(code: InviteCode): string;
  /** Bindet eine Anfrage an ihren Inhalt, ohne einen enthaltenen Code lesbar zu speichern. */
  requestHash(flow: OnlineFlow, request: object): string;
};

export function createInviteCodes(secret: string): InviteCodes {
  if (secret.length < MIN_INVITE_CODE_SECRET_LENGTH) throw new Error('Einladungs-Secret ist zu kurz');
  const hmac = (purpose: string, value: string) => createHmac('sha256', secret).update(`${purpose}:${value}`);
  return {
    codeFor(invitationId) {
      // 64 Bit reichen: Der Rest modulo einer Million weicht um weniger als 2^-44 von gleichverteilt ab.
      const value = hmac('code', invitationId).digest().readBigUInt64BE(0) % CODE_SPACE;
      return InviteCode.parse(value.toString().padStart(6, '0'));
    },
    hmacOf: (code) => hmac('einladung', code).digest('hex'),
    requestHash: (flow, request) => hmac(`anfrage:${flow}`, canonicalJson(request)).digest('hex'),
  };
}
