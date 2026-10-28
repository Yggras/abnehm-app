import { WaterAddedOutcome, WaterAddedValues, WaterEntryRecord, WaterEntryUpsert, WaterMl } from '../src/trackers.ts';
import { fixtures, without } from './define.ts';
import { now, philipp, timeZone, today } from './ids.ts';

const water = { amountMl: 250, origin: 'manuell', loggedAt: now, localDate: today, timeZone, utcOffsetMinutes: 120 } as const;

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
};
