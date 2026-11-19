import { readingOf, type ClockReading } from '@abnehm/clock';
import { localDateAfter, type Instant } from '@abnehm/contracts/base';
import type { InvitationErrorCode } from '@abnehm/contracts/coupling';

import type { NoticeProps } from '../design';
import type { FlowState } from '../online';
import { clockTimeOf } from './partner-view';
import { couplingTexts } from './texts';

// Was die Kopplungsabläufe `partner.invite` und `partner.redeem` aus dem Zustand eines Online-Ablaufs
// zeigen (Spezifikation 5, Abschnitt 5; #120). Reine Ableitungen; die Bildschirme zeichnen sie nur.

/** „heute, 14:20“, „morgen, 14:20“ oder „16.10., 14:20“ in der Zeitzone der Ablesung. */
export function validUntilWhen(expiresAt: Instant, now: ClockReading): string {
  const then = readingOf(expiresAt, now.timeZone);
  const time = clockTimeOf(then);
  if (then.localDate === now.localDate) return couplingTexts.today(time);
  if (then.localDate === localDateAfter(now.localDate, 1)) return couplingTexts.tomorrow(time);
  const [, month, day] = then.localDate.split('-');
  return couplingTexts.onDate(`${day}.${month}.`, time);
}

/** Ton, Anlass und Symbol des Hinweises; `problem` nur für Technik und einen nicht passenden Code. */
type NoticeLook = NoticeProps extends infer P ? (P extends unknown ? Omit<P, 'text' | 'action'> : never) : never;

const offlineLook: NoticeLook = { tone: 'problem', cause: 'technik', icon: 'offline' };
const technikLook: NoticeLook = { tone: 'problem', cause: 'technik' };
const inputLook: NoticeLook = { tone: 'problem', cause: 'ungueltige_eingabe' };
const hintLook: NoticeLook = { tone: 'hint' };

/**
 * Was ein gescheiterter Ablauf zeigt: der Satz mit nächstem Schritt, die Darstellung als Hinweis und ob „Erneut
 * versuchen“ dazugehört. Offline heißt „Braucht Internet“. Ungültige, abgelaufene, verbrauchte und eigene Codes
 * teilen einen Text; eigene Texte gibt es nur für `already_coupled` und `invite_rate_limited`. `null`, solange nichts
 * scheiterte.
 */
export type CouplingProblem = Readonly<{ text: string; retry: boolean; look: NoticeLook }>;

export function couplingProblemOf(state: FlowState<unknown, InvitationErrorCode>): CouplingProblem | null {
  switch (state.type) {
    case 'idle':
    case 'pending':
    case 'ok':
      return null;
    case 'offline':
      return { text: couplingTexts.offline, retry: true, look: offlineLook };
    case 'rejected':
      switch (state.code) {
        case 'already_coupled':
          return { text: couplingTexts.alreadyCoupled, retry: false, look: hintLook };
        case 'invite_rate_limited':
          return { text: couplingTexts.rateLimited, retry: false, look: hintLook };
        case 'invite_invalid':
        case 'invite_expired':
        case 'invite_consumed':
        case 'invite_self':
          return { text: couplingTexts.codeMismatch, retry: false, look: inputLook };
        default:
          // Ein neuer Fehlercode soll hier auffallen, statt still als allgemeiner Fehler zu enden.
          return state.code satisfies never;
      }
    // Eine abgelehnte Sitzung sperrt das Auth-Modul schon; bis die Weiche wechselt, gilt der allgemeine Text.
    case 'unauthorized':
    case 'failed':
      return { text: couplingTexts.failed, retry: true, look: technikLook };
  }
}
