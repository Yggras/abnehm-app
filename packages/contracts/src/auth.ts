import { z } from 'zod';

import { DisplayName, EntityId, ServerVersion, TimeZone } from './base.ts';

// Konto und Sitzung (Spezifikation 0, Abschnitt 9). Konto, Sitzung und E-Mail gehören dem Auth-Modul;
// hier stehen nur die Regeln und Nutzlasten, die App und Backend teilen.

/**
 * Passwortregeln aus #22: mindestens 10 Zeichen, mindestens 64 werden akzeptiert, keine starren
 * Zeichengruppen. 128 ist die Obergrenze von Better Auth (`maxPasswordLength`). Gezählt wird wie dort
 * die Länge der Zeichenfolge. Häufige und kompromittierte Passwörter lehnt nur der Server ab.
 */
export const passwordPolicy = { minLength: 10, maxLength: 128 } as const;

export const Password = z.string().min(passwordPolicy.minLength).max(passwordPolicy.maxLength);
export type Password = z.infer<typeof Password>;

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
