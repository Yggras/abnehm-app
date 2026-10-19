import type { Clock } from '@abnehm/clock';

import { createSlidingWindows } from '../rate-limit.ts';

// Begrenzung der Anmeldeversuche pro Konto und pro IP (#22; Spezifikation 0, Abschnitt 9). Gezählt
// werden Fehlversuche. Der Kontoschlüssel ist die kleingeschriebene E-Mail, so wie Better Auth das Konto
// sucht, und gilt auch für E-Mails ohne Konto, sonst verriete die Sperre, welche E-Mails registriert
// sind. Die Grenzwerte sind dieselben Designwerte wie bei den Einladungscodes und nicht
// wissenschaftlich belegt.
// Die Zähler liegen im Speicher des einen Backend-Prozesses; ein Neustart setzt sie zurück.

const MINUTE_MS = 60_000;

export const loginLimits = {
  perAccount: { max: 5, windowMs: 15 * MINUTE_MS },
  perIp: { max: 20, windowMs: 60 * MINUTE_MS },
} as const;

/** Wer anfragt: E-Mail (wie eingegeben) und Quelladresse, falls bekannt. */
export type LoginAttempt = Readonly<{ email: string; ipAddress: string | null }>;

export type LoginLimiter = {
  /** Gesperrt, solange Konto oder IP ihre Fehlversuche im Fenster aufgebraucht haben. */
  isBlocked(attempt: LoginAttempt): boolean;
  recordFailure(attempt: LoginAttempt): void;
  /** Eine erfolgreiche Anmeldung setzt die Fehlversuche des Kontos zurück, nicht die der IP. */
  recordSuccess(attempt: LoginAttempt): void;
};

const accountKey = (email: string) => `konto:${email.toLowerCase()}`;

export function createLoginLimiter({ clock }: { clock: Clock }): LoginLimiter {
  const windows = createSlidingWindows({ clock, longestWindowMs: loginLimits.perIp.windowMs });
  const keys = ({ email, ipAddress }: LoginAttempt) => [
    { key: accountKey(email), limit: loginLimits.perAccount },
    // Ohne erkennbare Adresse greift nur die Begrenzung pro Konto: Ein gemeinsamer Zähler ließe
    // 20 Fehlversuche irgendwo die Anmeldung für alle sperren. Hinter dem Reverse Proxy kommt die
    // Adresse aus `X-Forwarded-For` (`AUTH_TRUSTED_PROXIES`).
    ...(ipAddress === null ? [] : [{ key: `ip:${ipAddress}`, limit: loginLimits.perIp }]),
  ];

  return {
    isBlocked: (attempt) => keys(attempt).some(({ key, limit }) => windows.exhausted(key, limit)),
    recordFailure(attempt) {
      for (const { key, limit } of keys(attempt)) windows.add(key, limit);
    },
    recordSuccess(attempt) {
      windows.clear(accountKey(attempt.email));
    },
  };
}
