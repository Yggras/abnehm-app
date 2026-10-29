import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  asksForTypo,
  countedWaterMl,
  dayWeights,
  isCountingWeightEntry,
  isValidManualWeight,
  isValidWaterAmount,
  isWeighDay,
  lastWeightG,
  manualWeightG,
  trackerStatus,
  waterAmountMl,
  waterOrigin,
} from '../src/tracker-rules.ts';

// Tracker-Regeln (Spezifikation 3, Abschnitte 2 und 3; #171, #175): reines Modul, das App und Server teilen.

const entry = (amountMl: number, localDate = '2026-10-14', deletedAt: string | null = null) => ({ amountMl, localDate, deletedAt });

const weighing = (
  weightG: number,
  measuredAt: string,
  { localDate = measuredAt.slice(0, 10), deletedAt = null, hiddenAt = null }: { localDate?: string; deletedAt?: string | null; hiddenAt?: string | null } = {},
) => ({ weightG, measuredAt, localDate, deletedAt, hiddenAt });

describe('zählender Gewichtseintrag', () => {
  it('zählt, solange er weder gelöscht noch ausgeblendet ist', () => {
    expect(isCountingWeightEntry(weighing(82_400, '2026-10-14T05:30:00.000Z'))).toBe(true);
    expect(isCountingWeightEntry(weighing(82_400, '2026-10-14T05:30:00.000Z', { deletedAt: '2026-10-14T06:00:00.000Z' }))).toBe(false);
    expect(isCountingWeightEntry(weighing(82_400, '2026-10-14T05:30:00.000Z', { hiddenAt: '2026-10-14T06:00:00.000Z' }))).toBe(false);
  });
});

describe('Tagesgewicht', () => {
  it('ist bei mehreren Messungen eines lokalen Tags die früheste, unabhängig von der Reihenfolge', () => {
    const entries = [
      weighing(82_900, '2026-10-14T18:00:00.000Z'),
      weighing(82_400, '2026-10-14T05:30:00.000Z'),
      weighing(82_600, '2026-10-14T07:10:00.000Z'),
    ];

    expect(dayWeights(entries)).toEqual([{ localDate: '2026-10-14', weightG: 82_400 }]);
  });

  it('folgt dem gespeicherten lokalen Tag, nicht dem UTC-Datum des Zeitpunkts', () => {
    // 23:30 UTC am 13.10. ist in Berlin schon der 14.10., 01:30 Uhr.
    const entries = [weighing(82_400, '2026-10-13T23:30:00.000Z', { localDate: '2026-10-14' }), weighing(82_100, '2026-10-14T05:00:00.000Z')];

    expect(dayWeights(entries)).toEqual([{ localDate: '2026-10-14', weightG: 82_400 }]);
  });

  it('übergeht gelöschte und ausgeblendete Messungen; die nächste zählende wird Tagesgewicht', () => {
    const entries = [
      weighing(80_000, '2026-10-14T05:00:00.000Z', { deletedAt: '2026-10-14T05:01:00.000Z' }),
      weighing(80_100, '2026-10-14T05:10:00.000Z', { hiddenAt: '2026-10-14T05:11:00.000Z' }),
      weighing(82_400, '2026-10-14T05:30:00.000Z'),
    ];

    expect(dayWeights(entries)).toEqual([{ localDate: '2026-10-14', weightG: 82_400 }]);
  });

  it('liefert je Tag genau ein Tagesgewicht, aufsteigend nach Tag', () => {
    const entries = [
      weighing(82_000, '2026-10-14T05:30:00.000Z'),
      weighing(82_800, '2026-10-12T05:30:00.000Z'),
      weighing(83_000, '2026-10-12T20:00:00.000Z'),
      weighing(82_500, '2026-10-13T06:00:00.000Z'),
    ];

    expect(dayWeights(entries)).toEqual([
      { localDate: '2026-10-12', weightG: 82_800 },
      { localDate: '2026-10-13', weightG: 82_500 },
      { localDate: '2026-10-14', weightG: 82_000 },
    ]);
  });

  it('gibt ohne zählende Messung keine Tagesgewichte', () => {
    expect(dayWeights([])).toEqual([]);
    expect(dayWeights([weighing(82_000, '2026-10-14T05:30:00.000Z', { deletedAt: '2026-10-14T06:00:00.000Z' })])).toEqual([]);
  });
});

describe('letztes Gewicht', () => {
  it('ist die zuletzt gemessene zählende Messung, auch nach dem Tagesgewicht desselben Tags', () => {
    const entries = [
      weighing(82_800, '2026-10-13T05:30:00.000Z'),
      weighing(82_400, '2026-10-14T05:30:00.000Z'),
      weighing(82_900, '2026-10-14T18:00:00.000Z'),
      weighing(82_100, '2026-10-14T20:00:00.000Z', { deletedAt: '2026-10-14T20:01:00.000Z' }),
    ];

    expect(lastWeightG(entries)).toBe(82_900);
  });

  it('gibt es ohne zählende Messung nicht', () => {
    expect(lastWeightG([])).toBeNull();
    expect(lastWeightG([weighing(82_000, '2026-10-14T05:30:00.000Z', { hiddenAt: '2026-10-14T06:00:00.000Z' })])).toBeNull();
  });
});

describe('Wiegetag', () => {
  it('ist ein Wochenplantag mit dem Baustein Gewogen, auf jedem Platz', () => {
    expect(isWeighDay(['gewogen', 'wasserziel', 'sporteinheit'])).toBe(true);
    expect(isWeighDay(['ernaehrung_erfasst', 'wasserziel', 'gewogen'])).toBe(true);
    expect(isWeighDay(['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'])).toBe(false);
  });
});

describe('Plausibilitätsgrenze „Tippfehler?“', () => {
  it.each([
    [84_400, false, 'genau 2,0 kg darüber'],
    [80_400, false, 'genau 2,0 kg darunter'],
    [84_500, true, '2,1 kg darüber'],
    [80_300, true, '2,1 kg darunter'],
    [82_400, false, 'unverändert'],
  ])('%s g gegen 82,4 kg fragt %s (%s)', (weightG, asks) => {
    expect(asksForTypo(weightG, 82_400)).toBe(asks);
  });

  it('fragt ohne letztes Tagesgewicht nie', () => {
    expect(asksForTypo(150_000, null)).toBe(false);
  });
});

describe('gültige manuelle Gewichtseingabe', () => {
  it.each([
    [19_900, false],
    [20_000, true],
    [82_400, true],
    [350_000, true],
    [350_100, false],
    [82_450, false],
    [82_400.5, false],
  ])('%s g ist gültig: %s', (weightG, valid) => {
    expect(isValidManualWeight(weightG)).toBe(valid);
  });

  it('nennt 20,0–350,0 kg in 100-g-Schritten', () => {
    expect(manualWeightG).toEqual({ min: 20_000, max: 350_000, step: 100 });
  });
});

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
