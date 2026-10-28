import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { countedWaterMl, isValidWaterAmount, trackerStatus, waterAmountMl, waterOrigin } from '../src/tracker-rules.ts';

// Tracker-Regeln (Spezifikation 3, Abschnitte 2 und 3; #171): reines Modul, das App und Server teilen.

const entry = (amountMl: number, localDate = '2026-10-14', deletedAt: string | null = null) => ({ amountMl, localDate, deletedAt });

describe('Wasser-Zählregel', () => {
  it('summiert alle nicht gelöschten Einträge des lokalen Tags 1:1', () => {
    expect(countedWaterMl([entry(250), entry(500), entry(1)], '2026-10-14')).toBe(751);
  });

  it('zählt gelöschte Einträge nicht', () => {
    expect(countedWaterMl([entry(250), entry(500, '2026-10-14', '2026-10-14T10:00:00.000Z')], '2026-10-14')).toBe(250);
  });

  it('zählt nur den eigenen lokalen Tag, nicht die Nachbartage', () => {
    expect(countedWaterMl([entry(250, '2026-10-13'), entry(300), entry(400, '2026-10-15')], '2026-10-14')).toBe(300);
  });

  it('ergibt ohne Einträge 0', () => {
    expect(countedWaterMl([], '2026-10-14')).toBe(0);
  });

  it('kennt keine Getränkearten oder Gewichtung: Gleich große Einträge zählen gleich', () => {
    const glas = countedWaterMl([entry(250)], '2026-10-14');
    expect(countedWaterMl([entry(250), entry(250)], '2026-10-14')).toBe(2 * glas);
  });
});

describe('gültige Wassermenge', () => {
  it.each([
    [0, false],
    [1, true],
    [250, true],
    [3000, true],
    [3001, false],
    [250.5, false],
    [-250, false],
  ])('%s ml ist gültig: %s', (ml, valid) => {
    expect(isValidWaterAmount(ml)).toBe(valid);
  });

  it('nennt die Grenzen 1–3000 ml und die Herkunft manuell', () => {
    expect(waterAmountMl).toEqual({ min: 1, max: 3000 });
    expect(waterOrigin).toBe('manuell');
  });
});

describe('Status eines Mini-Trackers', () => {
  it.each([
    [0, 1500, 'leer'],
    [1, 1500, 'teil'],
    [1499, 1500, 'teil'],
    [1500, 1500, 'erreicht'],
    [1501, 1500, 'ueber_ziel'],
  ] as const)('%s von %s ist %s', (value, target, status) => {
    expect(trackerStatus(value, target)).toBe(status);
  });
});

describe('Reinheit', () => {
  it('hat keine Importe, also weder Ein- und Ausgabe noch Bibliotheks- oder Plattformtypen', () => {
    const source = readFileSync(new URL('../src/tracker-rules.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
