import { z } from 'zod';

import { DisplayName, EntityId, Instant, ServerVersion, TimeZone } from './base.ts';
import { OnlineRequestId } from './coupling.ts';

// Konto und Sitzung (Spezifikation 0, Abschnitt 9). Konto, Sitzung und E-Mail gehören dem Auth-Modul;
// hier stehen nur die Regeln und Nutzlasten, die App und Backend teilen.

/**
 * Passwortregeln aus #22: mindestens 10 Zeichen, mindestens 64 werden akzeptiert, keine starren
 * Zeichengruppen. 128 ist der Standardwert von `maxPasswordLength` in Better Auth
 * (https://github.com/better-auth/better-auth/blob/v1.7.10/packages/core/src/types/init-options.ts).
 * Gezählt wird wie dort die Länge der Zeichenfolge. Häufige und kompromittierte Passwörter lehnt nur
 * der Server ab.
 */
export const passwordPolicy = { minLength: 10, maxLength: 128 } as const;

/** Prüft Passwortfelder der Anmeldebildschirme vor dem Absenden mit denselben Grenzen wie der Server. */
export const Password = z.string().min(passwordPolicy.minLength).max(passwordPolicy.maxLength);
export type Password = z.infer<typeof Password>;

/**
 * Fehlercodes, die das Auth-Modul des Backends zusätzlich zu denen von Better Auth liefert. Sie stehen
 * wie die Codes von Better Auth im Feld `code` der Fehlerantwort.
 */
export const authErrorCodes = {
  /** Neues Passwort steht auf der Liste häufiger bzw. kompromittierter Passwörter. */
  passwordCompromised: 'PASSWORD_COMPROMISED',
  /** Zu viele Fehlversuche für dieses Konto oder diese IP; Antwort `429`. */
  tooManyLoginAttempts: 'TOO_MANY_LOGIN_ATTEMPTS',
} as const;

/**
 * Nutzlast von `POST /v1/person/bootstrap`. Konto und Person kommen ausschließlich aus der Sitzung;
 * eine mitgeschickte Konto- oder Personen-ID ist ungültig.
 */
export const BootstrapPersonRequest = z.strictObject({
  displayName: DisplayName,
  /** Aktuelle IANA-Zone des Geräts; danach ändert sie nur noch `updatePersonTimeZone`. */
  timeZone: TimeZone,
});
export type BootstrapPersonRequest = z.infer<typeof BootstrapPersonRequest>;

/** Die eine Person des Kontos. Ein wiederholter Bootstrap liefert dieselbe Person unverändert. */
export const BootstrapPersonResult = z.strictObject({
  personId: EntityId,
  displayName: DisplayName,
  onboardingStatus: z.enum(['begonnen', 'abgeschlossen']),
  timeZone: TimeZone,
  serverVersion: ServerVersion,
});
export type BootstrapPersonResult = z.infer<typeof BootstrapPersonResult>;

/**
 * Body von `POST /v1/session/logout`, dem serverseitigen Teil des vollständigen Abmeldens. Die
 * `requestId` speichert die App vor dem Aufruf (`logout_pending`); ein identischer Retry mit derselben
 * Sitzung erhält dasselbe Ergebnis, auch nachdem die Sitzung widerrufen ist.
 */
export const LogoutRequest = z.strictObject({ requestId: OnlineRequestId });
export type LogoutRequest = z.infer<typeof LogoutRequest>;

/** Terminales Ergebnis der Serverabmeldung: Die Sitzung ist seit `loggedOutAt` widerrufen. */
export const LogoutResult = z.strictObject({ loggedOutAt: Instant });
export type LogoutResult = z.infer<typeof LogoutResult>;
