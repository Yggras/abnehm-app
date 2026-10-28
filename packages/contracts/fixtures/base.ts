import {
  AreaKey,
  BausteinKey,
  CatalogKey,
  DisplayName,
  EntityId,
  Instant,
  LocalDate,
  MealKey,
  MessageKey,
  MessageValues,
  ServerVersion,
  SyncCursor,
  TimeZone,
  UtcOffsetMinutes,
  Weekday,
} from '../src/base.ts';
import { fixtures } from './define.ts';
import { now, philipp, timeZone, today } from './ids.ts';

export const baseFixtures = {
  EntityId: fixtures(EntityId, {
    valid: { 'UUIDv4': philipp, 'deterministische UUIDv5': '886313e1-3b8a-5372-9b90-0c9aee199e5d' },
    invalid: {
      'Großbuchstaben': philipp.toUpperCase(),
      'ohne Bindestriche': philipp.replaceAll('-', ''),
      'keine UUID': 'philipp',
    },
  }),
  Instant: fixtures(Instant, {
    valid: { 'UTC mit Millisekunden': now, 'UTC ohne Millisekunden': '2026-10-14T12:00:00Z' },
    invalid: { 'mit Versatz': '2026-10-14T14:00:00+02:00', 'nur Datum': today, 'Zahl': 1_792_065_600_000 },
  }),
  LocalDate: fixtures(LocalDate, {
    valid: { 'Mittwoch': today, 'Schalttag': '2028-02-29' },
    invalid: { 'kein Schalttag': '2026-02-29', 'deutsches Format': '14.10.2026', 'Zeitpunkt': now },
  }),
  TimeZone: fixtures(TimeZone, {
    valid: { 'Berlin': timeZone, 'Halbstundenzone': 'Asia/Kolkata' },
    invalid: { 'Versatz': '+02:00', 'unbekannt': 'Mars/Olympus_Mons', 'falsche Schreibweise': 'europe/berlin' },
  }),
  UtcOffsetMinutes: fixtures(UtcOffsetMinutes, {
    valid: { 'Berlin im Sommer': 120, 'New York': -240, 'Kathmandu': 345, 'Kiritimati': 840, 'Baker Island': -720 },
    invalid: { 'Bruchteil einer Minute': 120.5, 'über 14 Stunden': 841, 'als Text': '+02:00' },
  }),
  ServerVersion: fixtures(ServerVersion, {
    valid: { 'erste Version': '1', 'größtes bigint': '9223372036854775807' },
    invalid: {
      'Zahl statt Zeichenfolge': 42,
      'führende Null': '042',
      'negativ': '-1',
      'größer als bigint': '9223372036854775808',
    },
  }),
  SyncCursor: fixtures(SyncCursor, {
    valid: { 'kein Pull': '0', 'Position': '1834' },
    invalid: { 'Dezimalbruch': '18.5', 'leer': '' },
  }),
  MealKey: fixtures(MealKey, {
    valid: { 'Frühstück': 'fruehstueck', 'Snacks': 'snacks' },
    invalid: { 'mit Umlaut': 'frühstück', 'unbekannt': 'brunch' },
  }),
  AreaKey: fixtures(AreaKey, {
    valid: { 'Ernährung': 'ernaehrung', 'Gewicht': 'gewicht' },
    invalid: { 'Kalorienbudget ist kein Bereich': 'kalorienbudget' },
  }),
  BausteinKey: fixtures(BausteinKey, {
    valid: { 'Im Kalorienbudget': 'im_kalorienbudget', 'Gewogen': 'gewogen' },
    invalid: { 'Bereich statt Baustein': 'wasser' },
  }),
  Weekday: fixtures(Weekday, {
    valid: { 'Montag': 'montag', 'Sonntag': 'sonntag' },
    invalid: { 'abgekürzt': 'mo' },
  }),
  MessageKey: fixtures(MessageKey, {
    valid: { 'einfach': 'levelaufstieg', 'gegliedert': 'tagesziel.wasserziel.teilweise' },
    invalid: { 'sichtbarer Text': 'Wasserziel erreicht', 'Großbuchstaben': 'Tagesziel.Wasser' },
  }),
  MessageValues: fixtures(MessageValues, {
    valid: { 'leer': {}, 'Mengen und Name': { countedMl: 1000, targetMl: 1500, senderName: 'Anna' } },
    invalid: { 'verschachtelt': { progress: { countedMl: 1000 } }, 'Schlüssel mit Leerzeichen': { 'counted ml': 1 } },
  }),
  CatalogKey: fixtures(CatalogKey, {
    valid: { 'Accessoire': 'strohhuetchen', 'Vorlage': 'gemeinsam_dranbleiben' },
    invalid: { 'Leerzeichen': 'gut getrunken', 'Bindestrich': 'gut-getrunken' },
  }),
  DisplayName: fixtures(DisplayName, {
    valid: { 'einfach': 'Anna', 'genau 30 Zeichen': 'Anna-Lena Müller-Lüdenscheidt.' },
    invalid: { 'leer': '', 'Leerraum am Rand': ' Anna', '31 Zeichen': 'Anna-Lena Müller-Lüdenscheidt..' },
  }),
};
