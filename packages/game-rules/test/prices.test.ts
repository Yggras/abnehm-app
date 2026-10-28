import { describe, expect, it } from 'vitest';

import type { Blueprint } from '../src/catalog.ts';
import { basePrice, upgradePrice } from '../src/prices.ts';

// Nachweis für #179: Preise nach Abschnitt 3 von #83, Grundpreis min(round(3 + 0,6 × P), 24).

const art = ['a_1', 'a_2', 'a_3'] as const;
const leveled = (priceLevel: number, origin: 'level' | 'entdeckung' | 'besucher' = 'level'): Blueprint => ({
  key: 'b', name: 'B', role: 'bauen', origin, priceLevel, art,
});
const start = (startPrice: 1 | 2 | 3): Blueprint => ({ key: 's', name: 'S', role: 'natur', origin: 'start', startPrice, art });

describe('Grundpreis', () => {
  it.each([
    [1, 4], // 3,6 → aufgerundet
    [2, 4], // 4,2 → abgerundet
    [3, 5], // 4,8
    [5, 6], // 6,0
    [10, 9],
    [20, 15],
    [34, 23], // 23,4: knapp unter dem Deckel
    [35, 24], // 24,0: exakt am Deckel
    [36, 24], // 24,6 → 25, gedeckelt
    [60, 24],
  ])('Preislevel %i kostet %i', (priceLevel, price) => {
    expect(basePrice(leveled(priceLevel))).toBe(price);
  });

  it.each([1, 2, 3] as const)('Start-Bauplan zu %i Energie', (price) => {
    expect(basePrice(start(price))).toBe(price);
  });

  it('hängt nur vom Bauplan ab, gleich für Entdeckungs- und Besucher-Baupläne', () => {
    expect(basePrice(leveled(10, 'entdeckung'))).toBe(9);
    expect(basePrice(leveled(10, 'besucher'))).toBe(9);
  });

  it('lehnt Preislevel unter 1 und Bruchteile ab', () => {
    expect(() => basePrice(leveled(0))).toThrow(RangeError);
    expect(() => basePrice(leveled(2.5))).toThrow(RangeError);
  });
});

describe('Aufwerten', () => {
  it.each([
    [start(3), 2, 6],
    [start(3), 3, 9],
    [start(1), 2, 2],
    [leveled(10), 2, 18],
    [leveled(10), 3, 27],
    [leveled(36), 2, 48], // vom gedeckelten Grundpreis
    [leveled(36), 3, 72],
  ] as const)('%o auf Stufe %i kostet %i', (blueprint, stage, price) => {
    expect(upgradePrice(blueprint, stage)).toBe(price);
  });
});
