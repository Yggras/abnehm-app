import {
  ManualWeightG,
  WaterAddedOutcome,
  WaterAddedValues,
  WaterEntryRecord,
  WaterEntryUpsert,
  WaterMl,
  WeightEntryRecord,
  WeightEntryUpsert,
  WeightRecordedOutcome,
  WeightRecordedValues,
} from '../src/trackers.ts';
import { fixtures, without } from './define.ts';
import { now, philipp, timeZone, today } from './ids.ts';

const water = { amountMl: 250, origin: 'manuell', loggedAt: now, localDate: today, timeZone, utcOffsetMinutes: 120 } as const;
const weight = { weightG: 82_400, origin: 'manuell', measuredAt: '2026-10-14T05:30:00.000Z', localDate: today, timeZone, utcOffsetMinutes: 120 } as const;

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
  ManualWeightG: fixtures(ManualWeightG, {
    valid: { '82,4 kg': 82_400, 'kleinstes Gewicht': 20_000, 'größtes Gewicht': 350_000 },
    invalid: { '19,9 kg': 19_900, '350,1 kg': 350_100, 'zwei Nachkommastellen': 82_450, 'in kg': 82.4 },
  }),
  WeightEntryUpsert: fixtures(WeightEntryUpsert, {
    valid: { 'morgens gewogen': weight, 'nachgetragen nach der Zeitumstellung': { ...weight, measuredAt: '2026-10-26T06:00:00.000Z', localDate: '2026-10-26', utcOffsetMinutes: 60 } },
    invalid: {
      'importiert': { ...weight, origin: 'health_connect' },
      'genaue Gramm': { ...weight, weightG: 82_437 },
      'über der Grenze': { ...weight, weightG: 350_100 },
      'ohne Messzeitpunkt': without(weight, 'measuredAt'),
      'mit Eigentümer': { ...weight, personId: philipp },
    },
  }),
  WeightEntryRecord: fixtures(WeightEntryRecord, {
    valid: { 'kanonisch': { ...weight, personId: philipp, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Eigentümer': { ...weight, createdAt: now, updatedAt: now },
      'mit Tagesgewicht': { ...weight, personId: philipp, createdAt: now, updatedAt: now, dayWeightG: 82_400 },
    },
  }),
  WeightRecordedValues: fixtures(WeightRecordedValues, {
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
};
