import {
  ActivityType,
  ImportedSportEntryUpsert,
  ImportedWeightEntryUpsert,
  ManualSportMinutes,
  ManualWeightG,
  SportEntryRecord,
  SportEntryUpsert,
  SportRecordedOutcome,
  SportRecordedValues,
  WaterAddedOutcome,
  WaterAddedValues,
  WaterEntryRecord,
  WaterEntryUpsert,
  WaterMl,
  WeightEntryRecord,
  WeightEntryUpsert,
  WeightDeletedOutcome,
  WeightRecordedOutcome,
  WeightMessageValues,
  WeightUpdatedOutcome,
} from '../src/trackers.ts';
import { fixtures, without } from './define.ts';
import { now, philipp, timeZone, today } from './ids.ts';

const water = { amountMl: 250, origin: 'manuell', loggedAt: now, localDate: today, timeZone, utcOffsetMinutes: 120 } as const;
/** Manuelle Einheit: 30 Minuten Laufen am Mittwochabend in Berlin, ohne Kalorien. */
const sport = {
  activityType: 'laufen',
  startedAt: '2026-10-14T16:30:00.000Z',
  durationMinutes: 30,
  activeMilliKcal: null,
  origin: 'manuell',
  replacedByEntryId: null,
  reactivatedAt: null,
  localDate: today,
  timeZone,
  utcOffsetMinutes: 120,
} as const;
/** Import: Fitbit-Training über Apple Health, mit aktiven Kalorien der Quelle. */
const imported = {
  activityType: 'radfahren',
  overrideActivityType: null,
  startedAt: '2026-10-14T15:00:00.000Z',
  durationMinutes: 52,
  activeMilliKcal: 412_000,
  origin: 'apple_health',
  externalKey: '5B0E3F6A-2C1D-4E8F-9A7B-3C2D1E0F9A8B',
  sourceAppId: 'com.fitbit.FitbitMobile',
  sourceAppName: 'Fitbit',
  hiddenAt: null,
  localDate: today,
  timeZone,
  utcOffsetMinutes: 120,
} as const;
const owned = { personId: philipp, createdAt: now, updatedAt: now } as const;

const weight = { weightG: 82_400, origin: 'manuell', measuredAt: '2026-10-14T05:30:00.000Z', localDate: today, timeZone, utcOffsetMinutes: 120 } as const;
/** Import: Waagenwert über Health Connect mit den genauen Gramm der Quelle (#183). */
const importedWeight = {
  ...weight,
  weightG: 82_437,
  origin: 'health_connect',
  externalKey: '3f2b8c1e-7d4a-4b9e-8a1f-6c5d4e3b2a10',
  sourceAppId: 'com.fitbit.FitbitMobile',
  sourceAppName: null,
  hiddenAt: null,
} as const;

export const trackerFixtures = {
  WaterMl: fixtures(WaterMl, {
    valid: { 'ein Glas': 250, 'kleinste Menge': 1, 'größte Menge': 3000 },
    invalid: { 'nichts': 0, 'über der Grenze': 3001, 'Bruchteil': 250.5, 'in Litern': '0,25 l' },
  }),
  WaterEntryUpsert: fixtures(WaterEntryUpsert, {
    valid: { 'ein Glas in Berlin': water, 'nach einer Reise in Kathmandu': { ...water, timeZone: 'Asia/Kathmandu', utcOffsetMinutes: 345 } },
    invalid: {
      'importiert': { ...water, origin: 'apple_health' },
      'über der Grenze': { ...water, amountMl: 3001 },
      'ohne Offset': without(water, 'utcOffsetMinutes'),
      'mit Eigentümer': { ...water, personId: philipp },
      'mit Getränkeart': { ...water, drink: 'saft' },
    },
  }),
  WaterEntryRecord: fixtures(WaterEntryRecord, {
    valid: { 'kanonisch': { ...water, personId: philipp, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Eigentümer': { ...water, createdAt: now, updatedAt: now },
      'mit Serverversion': { ...water, personId: philipp, createdAt: now, updatedAt: now, serverVersion: '1842' },
    },
  }),
  WaterAddedValues: fixtures(WaterAddedValues, {
    valid: { '+250 ml': { ml: 250 }, 'Flasche': { ml: 500 } },
    invalid: { 'ohne Menge': {}, 'mit Tagessumme': { ml: 250, countedMl: 1500 } },
  }),
  WaterAddedOutcome: fixtures(WaterAddedOutcome, {
    valid: { '+250 ml Wasser': { messageKey: 'wasser.hinzugefuegt', values: { ml: 250 }, undoToken: 'undo-7f3a' } },
    invalid: {
      'ohne Rückgängig': { messageKey: 'wasser.hinzugefuegt', values: { ml: 250 } },
      'fremde Meldung': { messageKey: 'shell.nicht_geklappt', values: { ml: 250 }, undoToken: 'undo-7f3a' },
      'fertiger Text': { messageKey: 'wasser.hinzugefuegt', values: { ml: 250, text: '+250 ml Wasser' }, undoToken: 'undo-7f3a' },
      'synchronisiertes Feld': { messageKey: 'wasser.hinzugefuegt', values: { ml: 250 }, undoToken: 'undo-7f3a', entryId: philipp },
    },
  }),
  ActivityType: fixtures(ActivityType, {
    valid: { 'Laufen': 'laufen', 'Yoga und Dehnen': 'yoga_dehnen', 'Sonstiges': 'sonstiges' },
    invalid: { 'Anzeigename': 'Laufen', 'Plattformart': 'HKWorkoutActivityTypeRunning', 'mit Intensität': 'laufen_intensiv' },
  }),
  ManualSportMinutes: fixtures(ManualSportMinutes, {
    valid: { 'eine halbe Stunde': 30, 'kürzeste Einheit': 1, 'längste Einheit': 600 },
    invalid: { 'nichts': 0, 'über der Grenze': 601, 'Bruchteil': 30.5, 'in Stunden': '0,5 h' },
  }),
  SportEntryUpsert: fixtures(SportEntryUpsert, {
    valid: {
      'manuell ohne Kalorien': sport,
      'manuell mit Kalorien': { ...sport, activeMilliKcal: 210_000 },
      'manuell, ersetzt und reaktiviert': { ...sport, replacedByEntryId: philipp, reactivatedAt: now },
      'Import über Apple Health': imported,
      'Import über Health Connect, ausgeblendet und umbenannt': {
        ...imported, origin: 'health_connect', activeMilliKcal: null, sourceAppName: null, hiddenAt: now, overrideActivityType: 'krafttraining',
      },
      'Import über 600 Minuten': { ...imported, durationMinutes: 1440 },
    },
    invalid: {
      'unbekannte Art': { ...sport, activityType: 'tanzen' },
      'mit Intensität': { ...sport, intensity: 'hoch' },
      'manuell über 600 Minuten': { ...sport, durationMinutes: 601 },
      'manuell über 5000 kcal': { ...sport, activeMilliKcal: 5_000_001 },
      'negative Kalorien': { ...imported, activeMilliKcal: -1 },
      'Import über 1440 Minuten': { ...imported, durationMinutes: 1441 },
      'manuell mit externem Schlüssel': { ...sport, externalKey: imported.externalKey },
      'manuell ausgeblendet': { ...sport, hiddenAt: now },
      'Import mit „ersetzt durch“': { ...imported, replacedByEntryId: philipp },
      'Import ohne externen Schlüssel': without(imported, 'externalKey'),
      'unbekannte Herkunft': { ...imported, origin: 'fitbit' },
      'mit Eigentümer': { ...sport, personId: philipp },
    },
  }),
  ImportedSportEntryUpsert: fixtures(ImportedSportEntryUpsert, {
    valid: { 'Import über Apple Health': imported, 'Import über 600 Minuten': { ...imported, durationMinutes: 1440 } },
    invalid: { 'manuell': sport, 'Import über 1440 Minuten': { ...imported, durationMinutes: 1441 }, 'ohne externen Schlüssel': without(imported, 'externalKey') },
  }),
  ImportedWeightEntryUpsert: fixtures(ImportedWeightEntryUpsert, {
    valid: { 'Import mit genauen Gramm': importedWeight, 'Import an den Grenzen': { ...importedWeight, weightG: 350_000 } },
    invalid: { 'manuell': weight, 'Import unter 20 kg': { ...importedWeight, weightG: 19_999 }, 'ohne externen Schlüssel': without(importedWeight, 'externalKey') },
  }),
  SportEntryRecord: fixtures(SportEntryRecord, {
    valid: { 'manuell kanonisch': { ...sport, ...owned }, 'Import kanonisch': { ...imported, ...owned } },
    invalid: {
      'ohne Eigentümer': { ...sport, createdAt: now, updatedAt: now },
      'mit Ersetzungswirkung': { ...sport, ...owned, counting: false },
    },
  }),
  SportRecordedValues: fixtures(SportRecordedValues, {
    valid: { '30 min Laufen': { activityType: 'laufen', durationMinutes: 30 } },
    invalid: { 'ohne Art': { durationMinutes: 30 }, 'mit Kalorien': { activityType: 'laufen', durationMinutes: 30, activeMilliKcal: 210_000 } },
  }),
  SportRecordedOutcome: fixtures(SportRecordedOutcome, {
    valid: { 'Einheit eingetragen': { messageKey: 'sport.eingetragen', values: { activityType: 'laufen', durationMinutes: 30 }, undoToken: 'undo-7f3c' } },
    invalid: {
      'ohne Rückgängig': { messageKey: 'sport.eingetragen', values: { activityType: 'laufen', durationMinutes: 30 } },
      'fremde Meldung': { messageKey: 'gewicht.eingetragen', values: { activityType: 'laufen', durationMinutes: 30 }, undoToken: 'undo-7f3c' },
    },
  }),
  ManualWeightG: fixtures(ManualWeightG, {
    valid: { '82,4 kg': 82_400, 'kleinstes Gewicht': 20_000, 'größtes Gewicht': 350_000 },
    invalid: { '19,9 kg': 19_900, '350,1 kg': 350_100, 'zwei Nachkommastellen': 82_450, 'in kg': 82.4 },
  }),
  WeightEntryUpsert: fixtures(WeightEntryUpsert, {
    valid: {
      'morgens gewogen': weight,
      'nachgetragen nach der Zeitumstellung': { ...weight, measuredAt: '2026-10-26T06:00:00.000Z', localDate: '2026-10-26', utcOffsetMinutes: 60 },
      'Import mit genauen Gramm': importedWeight,
      'Import über Apple Health, ausgeblendet': { ...importedWeight, origin: 'apple_health', sourceAppName: 'Fitbit', hiddenAt: now },
      'Import an den Grenzen': { ...importedWeight, weightG: 20_000 },
    },
    invalid: {
      'importiert ohne externen Schlüssel': { ...weight, origin: 'health_connect' },
      'manuell mit genauen Gramm': { ...weight, weightG: 82_437 },
      'manuell mit externem Schlüssel': { ...weight, externalKey: importedWeight.externalKey },
      'manuell ausgeblendet': { ...weight, hiddenAt: now },
      'Import unter 20 kg': { ...importedWeight, weightG: 19_999 },
      'Import über 350 kg': { ...importedWeight, weightG: 350_001 },
      'Import mit Bruchteil eines Gramms': { ...importedWeight, weightG: 82_437.5 },
      'unbekannte Herkunft': { ...importedWeight, origin: 'fitbit' },
      'über der Grenze': { ...weight, weightG: 350_100 },
      'ohne Messzeitpunkt': without(weight, 'measuredAt'),
      'mit Eigentümer': { ...weight, personId: philipp },
    },
  }),
  WeightEntryRecord: fixtures(WeightEntryRecord, {
    valid: { 'kanonisch': { ...weight, personId: philipp, createdAt: now, updatedAt: now }, 'Import kanonisch': { ...importedWeight, ...owned } },
    invalid: {
      'ohne Eigentümer': { ...weight, createdAt: now, updatedAt: now },
      'mit Tagesgewicht': { ...weight, personId: philipp, createdAt: now, updatedAt: now, dayWeightG: 82_400 },
    },
  }),
  WeightMessageValues: fixtures(WeightMessageValues, {
    valid: { '82,4 kg': { weightG: 82_400 } },
    invalid: { 'ohne Gewicht': {}, 'in kg': { weightG: 82.4 }, 'mit Abweichung': { weightG: 82_400, changeG: 2_100 } },
  }),
  WeightRecordedOutcome: fixtures(WeightRecordedOutcome, {
    valid: { 'Gewicht eingetragen': { messageKey: 'gewicht.eingetragen', values: { weightG: 82_400 }, undoToken: 'undo-7f3b' } },
    invalid: {
      'ohne Rückgängig': { messageKey: 'gewicht.eingetragen', values: { weightG: 82_400 } },
      'fremde Meldung': { messageKey: 'wasser.hinzugefuegt', values: { weightG: 82_400 }, undoToken: 'undo-7f3b' },
      'fertiger Text': { messageKey: 'gewicht.eingetragen', values: { weightG: 82_400, text: '82,4 kg eingetragen' }, undoToken: 'undo-7f3b' },
    },
  }),
  WeightUpdatedOutcome: fixtures(WeightUpdatedOutcome, {
    valid: { 'Gewicht geändert': { messageKey: 'gewicht.geaendert', values: { weightG: 82_100 }, undoToken: 'undo-7f3c' } },
    invalid: {
      'ohne Rückgängig': { messageKey: 'gewicht.geaendert', values: { weightG: 82_100 } },
      'Meldung des Eintragens': { messageKey: 'gewicht.eingetragen', values: { weightG: 82_100 }, undoToken: 'undo-7f3c' },
      'importierte Gramm': { messageKey: 'gewicht.geaendert', values: { weightG: 82_137 }, undoToken: 'undo-7f3c' },
    },
  }),
  WeightDeletedOutcome: fixtures(WeightDeletedOutcome, {
    valid: { 'Gewicht gelöscht': { messageKey: 'gewicht.geloescht', values: { weightG: 82_400 }, undoToken: 'undo-7f3d' } },
    invalid: {
      'ohne Rückgängig': { messageKey: 'gewicht.geloescht', values: { weightG: 82_400 } },
      'ohne Gewicht': { messageKey: 'gewicht.geloescht', values: {}, undoToken: 'undo-7f3d' },
    },
  }),
};
