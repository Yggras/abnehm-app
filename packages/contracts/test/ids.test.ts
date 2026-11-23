import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EntityId } from '../src/base.ts';
import { uuidV5 } from '../src/ids.ts';
import { eventRewardId, islandContentId } from '../src/island-records.ts';
import { foodFavoriteId, ownFoodBarcodeId } from '../src/nutrition.ts';
import { importedSportEntryId, importedWeightEntryId } from '../src/trackers.ts';

// Nachweis für #105: deterministische IDs nach RFC 9562, Abschnitt 5.5 (UUIDv5, SHA-1).

const dnsNamespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Unabhängige Referenz über node:crypto. */
function referenceV5(namespace: string, name: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('uuidV5', () => {
  it('ergibt das Beispiel der Python-Doku (uuid5(NAMESPACE_DNS, "python.org"))', () => {
    // https://docs.python.org/3/library/uuid.html#example
    expect(uuidV5(dnsNamespace, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it.each([
    '',
    'tagesziel:0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01:2026-10-14:2',
    'Grüße, Möwe 🐟 und Lagune',
    'x'.repeat(55),
    'y'.repeat(56),
    'z'.repeat(64),
    'lang '.repeat(100),
  ])('stimmt mit SHA-1 aus node:crypto überein: %j', (name) => {
    expect(uuidV5(dnsNamespace, name)).toBe(referenceV5(dnsNamespace, name));
  });

  it('lehnt einen ungültigen Namensraum ab', () => {
    expect(() => uuidV5('kein-namensraum', 'x')).toThrow();
  });
});

describe('IDs importierter Einträge (#183)', () => {
  const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
  const anna = EntityId.parse('7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f');
  const key = '5B0E3F6A-2C1D-4E8F-9A7B-3C2D1E0F9A8B';

  it('sind deterministisch aus Person, Herkunft und externem Schlüssel', () => {
    expect(importedSportEntryId(philipp, 'apple_health', key)).toBe(importedSportEntryId(philipp, 'apple_health', key));
    expect(importedWeightEntryId(philipp, 'health_connect', key)).toBe(importedWeightEntryId(philipp, 'health_connect', key));
    expect(EntityId.safeParse(importedSportEntryId(philipp, 'apple_health', key)).success).toBe(true);
  });

  it('unterscheiden Person, Herkunft, Schlüssel und Eintragsart', () => {
    const ids = new Set([
      importedSportEntryId(philipp, 'apple_health', key),
      importedSportEntryId(anna, 'apple_health', key),
      importedSportEntryId(philipp, 'health_connect', key),
      importedSportEntryId(philipp, 'apple_health', `${key}-2`),
      importedWeightEntryId(philipp, 'apple_health', key),
    ]);
    expect(ids.size).toBe(5);
  });
});

describe('ID des Lebensmittelfavoriten (#158)', () => {
  const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
  const anna = EntityId.parse('7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f');
  const oats = { type: 'bls', key: 'C133000' } as const;

  it('ist deterministisch aus Person und Lebensmittelreferenz', () => {
    expect(foodFavoriteId(philipp, oats)).toBe(foodFavoriteId(philipp, { ...oats }));
    expect(EntityId.safeParse(foodFavoriteId(philipp, oats)).success).toBe(true);
  });

  it('unterscheidet Person, Art und Schlüssel der Referenz', () => {
    const ids = new Set([
      foodFavoriteId(philipp, oats),
      foodFavoriteId(anna, oats),
      foodFavoriteId(philipp, { type: 'bls', key: 'C133032' }),
      foodFavoriteId(philipp, { type: 'off', key: '40060400' }),
      foodFavoriteId(philipp, { type: 'eigen', key: anna }),
    ]);
    expect(ids.size).toBe(5);
  });
});

describe('ID eines eigenen Lebensmittels mit Barcode-Herkunft (#160)', () => {
  const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
  const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');

  it('ist deterministisch aus Person und Barcode, also auf zwei Geräten dieselbe', () => {
    expect(ownFoodBarcodeId(philipp, '4000417025005')).toBe(ownFoodBarcodeId(philipp, '4000417025005'));
    expect(EntityId.safeParse(ownFoodBarcodeId(philipp, '4000417025005')).success).toBe(true);
  });

  it('unterscheidet Person und Barcode und nie die ID eines Favoriten desselben Barcodes', () => {
    const ids = new Set([
      ownFoodBarcodeId(philipp, '4000417025005'),
      ownFoodBarcodeId(anna, '4000417025005'),
      ownFoodBarcodeId(philipp, '40004170'),
      foodFavoriteId(philipp, { type: 'off', key: '4000417025005' }),
    ]);
    expect(ids.size).toBe(4);
  });

  it('nimmt nur Barcodes, die auch die Lebensmittelreferenz nimmt', () => {
    expect(() => ownFoodBarcodeId(philipp, '12345')).toThrow();
  });
});

describe('IDs der Inselzeilen aus ihrem Schlüssel (#204)', () => {
  const island = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c02');
  const other = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c03');

  it('sind deterministisch und unterscheiden Art, Insel und Schlüssel', () => {
    expect(islandContentId('island_field', island, 'schilfwiese:0:-1')).toBe(islandContentId('island_field', island, 'schilfwiese:0:-1'));
    const ids = new Set([
      islandContentId('island_field', island, 'schilfwiese:0:-1'),
      islandContentId('island_field', other, 'schilfwiese:0:-1'),
      islandContentId('island_field', island, 'schilfwiese:1:-1'),
      islandContentId('area_unlock', island, 'schilfwiese'),
      islandContentId('blueprint_unlock', island, 'schilfwiese'),
    ]);
    expect(ids.size).toBe(5);
  });
});

describe('IDs der Belohnungen eines Ereignisstands (#202, #204)', () => {
  const state = EntityId.parse('8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a');

  it('das erste Stück behält die ID ohne Index, weitere Stücke bekommen je Index eine eigene', () => {
    expect(eventRewardId(state, 0)).toBe(eventRewardId(state));
    expect(new Set([0, 1, 2].map((index) => eventRewardId(state, index))).size).toBe(3);
    expect(eventRewardId(state, 1)).toBe(eventRewardId(state, 1));
  });

  it('lehnt negative und gebrochene Indizes ab', () => {
    expect(() => eventRewardId(state, -1)).toThrow(RangeError);
    expect(() => eventRewardId(state, 0.5)).toThrow(RangeError);
  });
});
