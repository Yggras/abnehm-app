import { z } from 'zod';

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
