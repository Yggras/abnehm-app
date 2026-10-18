import type { Clock } from '@abnehm/clock';

// Begrenzung der Anmeldeversuche pro Konto und pro IP (#22; Spezifikation 0, Abschnitt 9). Gezählt
// werden Fehlversuche. Der Kontoschlüssel ist die normalisierte E-Mail und gilt auch für E-Mails ohne
// Konto, sonst verriete die Sperre, welche E-Mails registriert sind. Die Grenzwerte sind dieselben
// Designwerte wie bei den Einladungscodes und nicht wissenschaftlich belegt.
// Die Zähler liegen im Speicher des einen Backend-Prozesses; ein Neustart setzt sie zurück.

const MINUTE_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

export const loginLimits = {
  perAccount: { maxFailures: 5, windowMs: 15 * MINUTE_MS },
  perIp: { maxFailures: 20, windowMs: 60 * MINUTE_MS },
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

export function createLoginLimiter({ clock }: { clock: Clock }): LoginLimiter {
  const failures = new Map<string, number[]>();
  const now = () => Date.parse(clock.read().instant);
  const keys = ({ email, ipAddress }: LoginAttempt) => [
    { key: `konto:${email.toLowerCase()}`, limit: loginLimits.perAccount },
    // Ohne erkennbare Adresse teilen sich alle Anfragen einen Zähler; hinter dem Reverse Proxy kommt
    // die Adresse aus `X-Forwarded-For`.
    { key: `ip:${ipAddress ?? 'unbekannt'}`, limit: loginLimits.perIp },
  ];

  /** Fehlversuche im Fenster; ältere fallen heraus, leere Einträge verschwinden. */
  function recent(key: string, windowMs: number, at: number): number[] {
    const kept = (failures.get(key) ?? []).filter((time) => at - time < windowMs);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  }

  return {
    isBlocked(attempt) {
      const at = now();
      return keys(attempt).some(({ key, limit }) => recent(key, limit.windowMs, at).length >= limit.maxFailures);
    },
    recordFailure(attempt) {
      const at = now();
      // Viele verschiedene Schlüssel (etwa wechselnde IPs) dürfen den Speicher nicht füllen.
      if (failures.size > MAX_TRACKED_KEYS) {
        for (const key of [...failures.keys()]) recent(key, loginLimits.perIp.windowMs, at);
      }
      for (const { key, limit } of keys(attempt)) failures.set(key, [...recent(key, limit.windowMs, at), at]);
    },
    recordSuccess(attempt) {
      failures.delete(`konto:${attempt.email.toLowerCase()}`);
    },
  };
}
