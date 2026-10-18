import { z } from 'zod';

import { AreaKey, EntityId } from '@abnehm/contracts/base';

// Ereignisse des Sicherheitslogs (Spezifikation 0, Abschnitt 11). Erlaubt sind ausschließlich die
// Ereignistypen aus #22: Anmeldung und Fehlschlag, Abmeldung, Sitzungswiderruf, Passwortänderung
// und -reset, Kopplung und Entkopplung, Freigabeänderung, verweigerter Fotozugriff und
// administrative Zugriffe (https://github.com/Yggras/abnehm-app/issues/22).
//
// Jedes Feld ist eine UUID, ein Wert aus einem festen Katalog, ein Wahrheitswert oder eine
// IP-Adresse; unbekannte Felder sind verboten. Passwörter, Tokens, Secrets, Codes, Fotos,
// Körperwerte oder ganze Requests passen deshalb in kein Feld: Ein Sitzungstoken etwa ist keine UUID.
// Grundlage: OWASP Logging Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

/** Konto-ID (Better-Auth-„user“, eine UUID). */
const AccountId = EntityId;

/** Quelladresse der Anfrage, sofern bekannt; Grundlage für die Begrenzung pro IP. */
const IpAddress = z.union([z.ipv4(), z.ipv6()]).nullable();

const accountEvent = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), accountId: AccountId, ...shape });

export const SecurityEvent = z.discriminatedUnion('type', [
  accountEvent('anmeldung', { ipAddress: IpAddress }),
  z.strictObject({
    type: z.literal('anmeldung_fehlgeschlagen'),
    /** Das Konto zur angegebenen E-Mail, falls es eines gibt; die E-Mail selbst nie. */
    accountId: AccountId.nullable(),
    reason: z.enum(['zugangsdaten_falsch', 'begrenzt']),
    ipAddress: IpAddress,
  }),
  accountEvent('abmeldung', {}),
  accountEvent('sitzungswiderruf', {
    scope: z.enum(['aktuelle', 'alle']),
    cause: z.enum(['widerruf', 'abmeldung', 'passwortaenderung', 'passwort_reset']),
  }),
  accountEvent('passwortaenderung', {}),
  accountEvent('passwort_reset', {}),
  accountEvent('kopplung', { couplingId: EntityId, reactivated: z.boolean() }),
  accountEvent('entkopplung', { couplingId: EntityId }),
  accountEvent('freigabeaenderung', {
    couplingId: EntityId,
    scope: z.union([AreaKey, z.literal('fotos')]),
    level: z.enum(['privat', 'zusammengefasst', 'geteilt']),
  }),
  accountEvent('fotozugriff_verweigert', { operation: z.enum(['fotoliste', 'bildabruf']) }),
  z.strictObject({
    type: z.literal('administrativer_zugriff'),
    command: z.enum(['passwort_reset']),
    /** Betroffenes Konto; das Kommando läuft ohne eigenes Konto auf dem Server. */
    targetAccountId: AccountId.nullable(),
  }),
]);
export type SecurityEvent = z.input<typeof SecurityEvent>;
export type SecurityEventType = z.infer<typeof SecurityEvent>['type'];

/** Alle Ereignistypen; der CHECK der Tabelle `security_log` verwendet dieselbe Liste. */
export const securityEventTypes: readonly SecurityEventType[] = SecurityEvent.options.map((option) => option.shape.type.value);
