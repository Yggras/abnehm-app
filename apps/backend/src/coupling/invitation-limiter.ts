import type { Clock } from '@abnehm/clock';

import { createSlidingWindows } from '../rate-limit.ts';

// Begrenzung von „Code prüfen“ und „Einladung annehmen“ (Spezifikation 0, Abschnitt 9): fünf
// Fehlversuche je Konto bzw. je Code in 15 Minuten, 20 Versuche je IP in der Stunde. Je IP zählt
// wörtlich jeder Versuch, nicht nur ein Fehlversuch; zwei Personen hinter einer Adresse brauchen für
// eine Kopplung trotzdem nur wenige. Die Grenzwerte sind Designwerte und nicht wissenschaftlich belegt.
// Der Code geht nur als HMAC in den Schlüssel ein.

const MINUTE_MS = 60_000;

export const invitationLimits = {
  perAccount: { max: 5, windowMs: 15 * MINUTE_MS },
  perCode: { max: 5, windowMs: 15 * MINUTE_MS },
  perIp: { max: 20, windowMs: 60 * MINUTE_MS },
} as const;

/** Wer mit welchem Code anfragt; die IP fehlt ohne erkennbare Quelladresse. */
export type InvitationAttempt = Readonly<{ accountId: string; codeHmac: string; ipAddress: string | null }>;

export type InvitationLimiter = {
  /** Gesperrt, solange Konto, Code oder IP ihr Kontingent im Fenster aufgebraucht haben. */
  isBlocked(attempt: InvitationAttempt): boolean;
  /** Ein abgearbeiteter Versuch; `failed` bei ungültigem, abgelaufenem, verbrauchtem oder eigenem Code. */
  record(attempt: InvitationAttempt, outcome: { failed: boolean }): void;
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
    isBlocked: (attempt) => [...failureKeys(attempt), ...ipKey(attempt)].some(({ key, limit }) => windows.exhausted(key, limit)),
    record(attempt, { failed }) {
      for (const { key, limit } of [...ipKey(attempt), ...(failed ? failureKeys(attempt) : [])]) windows.add(key, limit);
    },
  };
}
