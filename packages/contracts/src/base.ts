import { z } from 'zod';

import { isoWeekdayIndex } from './calendar.ts';

/**
 * Fach-ID als UUID, immer kleingeschrieben: RFC 9562 gibt UUIDs kleingeschrieben aus
 * (https://www.rfc-editor.org/rfc/rfc9562#section-4). So ist dieselbe ID in Postgres (`uuid`)
 * und SQLite (`TEXT`) auch dieselbe Zeichenfolge.
 */
export const EntityId = z
  .uuid()
  .regex(/^[0-9a-f-]+$/, { message: 'UUID muss kleingeschrieben sein' })
  .brand<'EntityId'>();
export type EntityId = z.infer<typeof EntityId>;

/** Zeitpunkt als UTC-ISO-8601-Zeichenfolge, z. B. `2026-10-14T12:00:00.000Z`. */
export const Instant = z.iso.datetime().brand<'Instant'>();
export type Instant = z.infer<typeof Instant>;

/** Lokaler Kalendertag im Format `YYYY-MM-DD`. */
export const LocalDate = z.iso.date().brand<'LocalDate'>();
export type LocalDate = z.infer<typeof LocalDate>;

/** IANA-Zeitzonenkennung wie `Europe/Berlin`; Versatzangaben wie `+02:00` sind keine Zeitzone. */
export const TimeZone = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/)
  .refine(isKnownTimeZone, { message: 'Unbekannte IANA-Zeitzone' })
  .brand<'TimeZone'>();
export type TimeZone = z.infer<typeof TimeZone>;

// Nur bekannte Zonen werden gemerkt: Davon gibt es wenige Hundert, von unbekannten Eingaben beliebig viele.
const knownTimeZones = new Set<string>();

function isKnownTimeZone(timeZone: string): boolean {
  if (knownTimeZones.has(timeZone)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    return false;
  }
  knownTimeZones.add(timeZone);
  return true;
}

// Postgres `bigint` reicht bis 2^63 − 1 (https://www.postgresql.org/docs/current/datatype-numeric.html).
const decimal = /^(?:0|[1-9][0-9]{0,18})$/;
const opaqueDecimal = z
  .string()
  .refine((value) => decimal.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n, {
    message: 'Dezimalzahl zwischen 0 und Postgres-bigint-Maximum',
  });

/** Serverversion einer Zeile: opake Dezimalzeichenfolge (in Postgres `bigint`). */
export const ServerVersion = opaqueDecimal.brand<'ServerVersion'>();
export type ServerVersion = z.infer<typeof ServerVersion>;

/** Position im Änderungsprotokoll, bis zu der ein Gerät gezogen hat: opake Dezimalzeichenfolge. */
export const SyncCursor = opaqueDecimal.brand<'SyncCursor'>();
export type SyncCursor = z.infer<typeof SyncCursor>;

/** Mahlzeit des Tagesprotokolls. */
export const MealKey = z.enum(['fruehstueck', 'mittagessen', 'abendessen', 'snacks']);
export type MealKey = z.infer<typeof MealKey>;

/** Gesundheitsbereich; derselbe Katalog gilt für Partnerfreigaben, Zusammenfassungen und Tages-Check-ins. */
export const AreaKey = z.enum(['ernaehrung', 'wasser', 'sport', 'gewicht']);
export type AreaKey = z.infer<typeof AreaKey>;

/** Baustein eines Tagesziels. */
export const BausteinKey = z.enum(['ernaehrung_erfasst', 'im_kalorienbudget', 'wasserziel', 'sporteinheit', 'gewogen']);
export type BausteinKey = z.infer<typeof BausteinKey>;

/** Wochentag in ISO-Reihenfolge (Montag zuerst). */
export const Weekday = z.enum(['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag']);
export type Weekday = z.infer<typeof Weekday>;

export function weekdayOf(localDate: LocalDate): Weekday {
  return Weekday.options[isoWeekdayIndex(localDate)] as Weekday;
}

/**
 * Schlüssel eines sichtbaren Textes, z. B. `tagesziel.wasserziel.teilweise`. Den deutschen Text
 * erzeugt erst die App aus Schlüssel und Werten; Transportverträge enthalten keinen UI-Text.
 */
export const MessageKey = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/);
export type MessageKey = z.infer<typeof MessageKey>;

/** Typisierte Werte zu einem `MessageKey`, z. B. `{ countedMl: 1000, targetMl: 1500 }`. */
export const MessageValues = z.record(
  z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  z.union([z.string().max(200), z.number(), z.boolean()]),
);
export type MessageValues = z.infer<typeof MessageValues>;

/** Schlüssel aus dem versionierten Spielkatalog (Bauplan, Deko, Gebiet, Vorlage, Accessoire …). */
export const CatalogKey = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
export type CatalogKey = z.infer<typeof CatalogKey>;

/**
 * Anzeigename einer Person: 1–30 Zeichen (Designwert aus Spezifikation 1, Abschnitt 9), ohne
 * Leerraum am Rand. Gezählt werden Unicode-Codepunkte.
 */
export const DisplayName = z
  .string()
  .refine((value) => value === value.trim(), { message: 'Kein Leerraum am Rand' })
  .refine((value) => [...value].length >= 1 && [...value].length <= 30, { message: '1–30 Zeichen' });
export type DisplayName = z.infer<typeof DisplayName>;
