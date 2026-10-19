import type { Clock } from '@abnehm/clock';

import { createSlidingWindows, MINUTE_MS } from '../rate-limit.ts';

// Begrenzung von „Code prüfen“ und „Einladung annehmen“ (Spezifikation 0, Abschnitt 9): fünf
// Fehlversuche je Konto bzw. je Code in 15 Minuten, 20 Versuche je IP in der Stunde. Je IP zählt
// wörtlich jeder Versuch, nicht nur ein Fehlversuch; zwei Personen hinter einer Adresse brauchen für
// eine Kopplung trotzdem nur wenige. Die Grenzwerte sind Designwerte und nicht wissenschaftlich belegt.
// Der Code geht nur als HMAC in den Schlüssel ein.
//
// Ein Versuch zählt schon beim Beginn als Fehlversuch und wird erst bei einem anderen Ausgang wieder
// freigegeben. So kommen auch gleichzeitige Anfragen nicht an der Sperre vorbei.

export const invitationLimits = {
  perAccount: { max: 5, windowMs: 15 * MINUTE_MS },
  perCode: { max: 5, windowMs: 15 * MINUTE_MS },
  perIp: { max: 20, windowMs: 60 * MINUTE_MS },
} as const;

/** Wer mit welchem Code anfragt; die IP fehlt ohne erkennbare Quelladresse. */
export type InvitationAttempt = Readonly<{ accountId: string; codeHmac: string; ipAddress: string | null }>;

/** Ein begonnener Versuch; bis zur Freigabe zählt er als Fehlversuch. */
export type AttemptTicket = Readonly<{ provisional: readonly { key: string; at: number }[] }>;

export type InvitationLimiter = {
  /** `null`, solange Konto, Code oder IP ihr Kontingent im Fenster aufgebraucht haben; sonst zählt der Versuch. */
  begin(attempt: InvitationAttempt): AttemptTicket | null;
  /** Der Versuch war kein Fehlversuch: ungültiger, abgelaufener, verbrauchter oder eigener Code. */
  succeeded(ticket: AttemptTicket): void;
};

export function createInvitationLimiter({ clock }: { clock: Clock }): InvitationLimiter {
  const windows = createSlidingWindows({ clock, longestWindowMs: invitationLimits.perIp.windowMs });
  const failureKeys = ({ accountId, codeHmac }: InvitationAttempt) => [
    { key: `konto:${accountId}`, limit: invitationLimits.perAccount },
    { key: `code:${codeHmac}`, limit: invitationLimits.perCode },
  ];
  // Ohne erkennbare Adresse kein gemeinsamer Zähler, wie bei der Anmeldung (login-limiter.ts).
  const ipKey = ({ ipAddress }: InvitationAttempt) =>
    ipAddress === null ? [] : [{ key: `ip:${ipAddress}`, limit: invitationLimits.perIp }];

  return {
    begin(attempt) {
      const keys = [...failureKeys(attempt), ...ipKey(attempt)];
      if (keys.some(({ key, limit }) => windows.exhausted(key, limit))) return null;
      for (const { key, limit } of ipKey(attempt)) windows.add(key, limit);
      return { provisional: failureKeys(attempt).map(({ key, limit }) => ({ key, at: windows.add(key, limit) })) };
    },
    succeeded(ticket) {
      for (const { key, at } of ticket.provisional) windows.remove(key, at);
    },
  };
}
