import { minutesOfDay, readingOf, type ClockReading } from '@abnehm/clock';
import { localDateAfter, type Instant } from '@abnehm/contracts/base';
import type { InvitationErrorCode } from '@abnehm/contracts/coupling';

import type { FlowState } from '../online';
import { couplingTexts } from './texts';

// Was die Kopplungsabläufe `partner.invite` und `partner.redeem` aus dem Zustand eines Online-Ablaufs
// zeigen (Spezifikation 5, Abschnitt 5; #120). Reine Ableitungen; die Bildschirme zeichnen sie nur.

const pad = (value: number) => String(value).padStart(2, '0');

/** „heute, 14:20“, „morgen, 14:20“ oder „16.10., 14:20“ in der Zeitzone der Ablesung. */
export function validUntilWhen(expiresAt: Instant, now: ClockReading): string {
  const then = readingOf(expiresAt, now.timeZone);
  const minutes = minutesOfDay(then);
  const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  if (then.localDate === now.localDate) return `heute, ${time}`;
  if (then.localDate === localDateAfter(now.localDate, 1)) return `morgen, ${time}`;
  const [, month, day] = then.localDate.split('-');
  return `${day}.${month}., ${time}`;
}

/**
 * Was ein gescheiterter Ablauf zeigt: der Satz mit nächstem Schritt, sein Anlass und ob „Erneut versuchen“
 * dazugehört. `offline` ist „Braucht Internet“. Ungültige, abgelaufene, verbrauchte und eigene Codes teilen einen
 * Text; eigene Texte gibt es nur für `already_coupled` und `invite_rate_limited`. `null`, solange nichts scheiterte.
 */
export type CouplingProblem = Readonly<{ text: string; retry: boolean; cause: 'offline' | 'technik' | 'ungueltige_eingabe' | 'hinweis' }>;

export function couplingProblemOf(state: FlowState<unknown, InvitationErrorCode>): CouplingProblem | null {
  switch (state.type) {
    case 'idle':
    case 'pending':
    case 'ok':
      return null;
    case 'offline':
      return { text: couplingTexts.offline, retry: true, cause: 'offline' };
    case 'rejected':
      switch (state.code) {
        case 'already_coupled':
          return { text: couplingTexts.alreadyCoupled, retry: false, cause: 'hinweis' };
        case 'invite_rate_limited':
          return { text: couplingTexts.rateLimited, retry: false, cause: 'hinweis' };
        case 'invite_invalid':
        case 'invite_expired':
        case 'invite_consumed':
        case 'invite_self':
          return { text: couplingTexts.codeMismatch, retry: false, cause: 'ungueltige_eingabe' };
      }
    // Eine abgelehnte Sitzung sperrt das Auth-Modul schon; bis die Weiche wechselt, gilt der allgemeine Text.
    case 'unauthorized':
    case 'failed':
      return { text: couplingTexts.failed, retry: true, cause: 'technik' };
  }
}
