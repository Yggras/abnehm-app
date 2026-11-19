import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  activityTypes,
  asksForTypo,
  countedWaterMl,
  countingSportEntries,
  isValidManualSportMilliKcal,
  isValidManualSportMinutes,
  manualSportMilliKcal,
  manualSportMinutes,
  sportEntryMinutes,
  weekMinutes,
  weekOf,
  dayWeights,
  isCountingWeightEntry,
  isInFuture,
  isValidManualWeight,
  isValidWaterAmount,
  isSportDay,
  isWeighDay,
  lastWeightG,
  manualWeightG,
  trackerStatus,
  waterAmountMl,
  waterOrigin,
  activityMappingVersion,
  activityTypeOfPlatform,
  importedSportMinutes,
  importedWeightG,
  isValidImportedWeight,
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

describe('Messzeitpunkt', () => {
  it('liegt in der Zukunft, sobald er nach jetzt liegt; jetzt selbst ist erlaubt', () => {
    expect(isInFuture('2026-10-14T10:00:01.000Z', '2026-10-14T10:00:00.000Z')).toBe(true);
    expect(isInFuture('2026-10-14T10:00:00.000Z', '2026-10-14T10:00:00.000Z')).toBe(false);
    expect(isInFuture('2026-10-13T05:30:00.000Z', '2026-10-14T10:00:00.000Z')).toBe(false);
  });

  it('vergleicht Zeitpunkte, nicht Zeichenfolgen: mit und ohne Millisekunden', () => {
    expect(isInFuture('2026-10-14T10:00:00Z', '2026-10-14T10:00:00.000Z')).toBe(false);
  });
});

describe('Wiegetag', () => {
  it('ist ein Wochenplantag mit dem Baustein Gewogen, auf jedem Platz', () => {
    expect(isWeighDay(['gewogen', 'wasserziel', 'sporteinheit'])).toBe(true);
    expect(isWeighDay(['ernaehrung_erfasst', 'wasserziel', 'gewogen'])).toBe(true);
    expect(isWeighDay(['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'])).toBe(false);
  });
});

describe('Sporttag', () => {
  it('ist ein Wochenplantag mit dem Baustein Sporteinheit, auf jedem Platz', () => {
    expect(isSportDay(['sporteinheit', 'wasserziel', 'gewogen'])).toBe(true);
    expect(isSportDay(['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'])).toBe(true);
    expect(isSportDay(['ernaehrung_erfasst', 'wasserziel', 'gewogen'])).toBe(false);
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

type Session = Parameters<typeof countingSportEntries>[0][number];

/** Ein Sporteintrag; ohne Angaben ein manueller, zählender Eintrag von 30 Minuten am Mittwoch, 14.10.2026. */
const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  origin: 'manuell',
  durationMinutes: 30,
  localDate: '2026-10-14',
  deletedAt: null,
  hiddenAt: null,
  replacedByEntryId: null,
  reactivatedAt: null,
  ...overrides,
});
const at = '2026-10-14T18:00:00.000Z';
const counted = (entries: readonly Session[]) => countingSportEntries(entries).map((entry) => entry.id);

describe('zählender Sporteintrag', () => {
  it('importiert: zählt, wenn er weder gelöscht noch ausgeblendet ist', () => {
    const entries = [
      session('import', { origin: 'apple_health' }),
      session('geloescht', { origin: 'health_connect', deletedAt: at }),
      session('ausgeblendet', { origin: 'apple_health', hiddenAt: at }),
    ];

    expect(counted(entries)).toEqual(['import']);
  });

  it('manuell: zählt ohne „ersetzt durch“-Verweis, gelöscht nie', () => {
    expect(counted([session('manuell'), session('geloescht', { deletedAt: at })])).toEqual(['manuell']);
  });

  it('manuell und ersetzt: zählt nicht, solange der ersetzende Import zählt; der Import zählt', () => {
    const entries = [session('import', { origin: 'apple_health' }), session('ersetzt', { replacedByEntryId: 'import' })];

    expect(counted(entries)).toEqual(['import']);
  });

  it('manuell, ersetzt und reaktiviert: zählt neben dem Import', () => {
    const entries = [session('import', { origin: 'apple_health' }), session('reaktiviert', { replacedByEntryId: 'import', reactivatedAt: at })];

    expect(counted(entries)).toEqual(['import', 'reaktiviert']);
  });

  it.each([
    ['ausgeblendet', { hiddenAt: at }],
    ['in der Quelle gelöscht', { deletedAt: at }],
  ])('manuell und ersetzt: zählt wieder, wenn der ersetzende Import %s ist', (_, change) => {
    const entries = [session('import', { origin: 'health_connect', ...change }), session('ersetzt', { replacedByEntryId: 'import' })];

    expect(counted(entries)).toEqual(['ersetzt']);
  });

  it('manuell und ersetzt: zählt, wenn der ersetzende Import unbekannt ist, damit kein Training verschwindet', () => {
    expect(counted([session('ersetzt', { replacedByEntryId: 'fehlt' })])).toEqual(['ersetzt']);
  });

  it('berechnet die Ersetzungswirkung beim Zählen: Derselbe gespeicherte Eintrag zählt je nach Stand des Imports', () => {
    const replaced = session('ersetzt', { replacedByEntryId: 'import' });

    expect(counted([session('import', { origin: 'apple_health' }), replaced])).toEqual(['import']);
    expect(counted([session('import', { origin: 'apple_health', hiddenAt: at }), replaced])).toEqual(['ersetzt']);
    expect(replaced).toEqual(session('ersetzt', { replacedByEntryId: 'import' }));
  });
});

describe('Wochenminuten', () => {
  it('summieren die zählenden Einträge der Woche Montag bis Sonntag 1:1', () => {
    const entries = [
      session('montag', { localDate: '2026-10-12', durationMinutes: 40 }),
      session('mittwoch', { localDate: '2026-10-14', durationMinutes: 1 }),
      session('sonntag', { localDate: '2026-10-18', durationMinutes: 35 }),
      session('geloescht', { localDate: '2026-10-14', durationMinutes: 60, deletedAt: at }),
    ];

    for (const day of ['2026-10-12', '2026-10-14', '2026-10-18']) expect(weekMinutes(entries, day)).toBe(76);
  });

  it('enden an der Wochengrenze: Sonntag und der folgende Montag gehören zu verschiedenen Wochen', () => {
    const entries = [
      session('sonntag-vorher', { localDate: '2026-10-11', durationMinutes: 20 }),
      session('montag', { localDate: '2026-10-12', durationMinutes: 30 }),
      session('sonntag', { localDate: '2026-10-18', durationMinutes: 45 }),
      session('montag-danach', { localDate: '2026-10-19', durationMinutes: 50 }),
    ];

    expect(weekMinutes(entries, '2026-10-11')).toBe(20);
    expect(weekMinutes(entries, '2026-10-14')).toBe(75);
    expect(weekMinutes(entries, '2026-10-19')).toBe(50);
  });

  it('folgen über den Sommerzeitwechsel dem gespeicherten lokalen Tag (25.10.2026 endet die Sommerzeit)', () => {
    // Die Woche vom 19. bis 25.10. hat in Berlin 169 Stunden; maßgeblich ist der Kalendertag, nicht die Stundenzahl.
    const entries = [
      session('sonntag-spaet', { localDate: '2026-10-25', durationMinutes: 30 }),
      session('montag-frueh', { localDate: '2026-10-26', durationMinutes: 15 }),
    ];

    expect(weekMinutes(entries, '2026-10-19')).toBe(30);
    expect(weekMinutes(entries, '2026-10-25')).toBe(30);
    expect(weekMinutes(entries, '2026-10-26')).toBe(15);
  });

  it('gehen über Monats- und Jahresgrenzen', () => {
    const entries = [session('silvester', { localDate: '2026-12-31', durationMinutes: 25 }), session('neujahr', { localDate: '2027-01-03', durationMinutes: 35 })];

    expect(weekOf('2027-01-01')).toEqual({ monday: '2026-12-28', sunday: '2027-01-03' });
    expect(weekMinutes(entries, '2026-12-28')).toBe(60);
  });

  it('zählen ersetzte Einträge nicht und ausgeblendete Importe nicht, die Ersetzung über den Nachbartag hinweg schon', () => {
    const entries = [
      session('import', { origin: 'apple_health', localDate: '2026-10-11', durationMinutes: 45 }),
      session('ersetzt', { localDate: '2026-10-12', durationMinutes: 40, replacedByEntryId: 'import' }),
      session('ausgeblendet', { origin: 'apple_health', localDate: '2026-10-13', durationMinutes: 20, hiddenAt: at }),
      session('manuell', { localDate: '2026-10-13', durationMinutes: 30 }),
    ];

    expect(weekMinutes(entries, '2026-10-14')).toBe(30);
  });

  it('sind ohne Einträge 0', () => {
    expect(weekMinutes([], '2026-10-14')).toBe(0);
  });
});

describe('gültiger manueller Sporteintrag', () => {
  it('kennt genau die acht Aktivitätsarten, ohne Intensität', () => {
    expect(activityTypes).toEqual(['gehen', 'laufen', 'radfahren', 'schwimmen', 'krafttraining', 'yoga_dehnen', 'mannschaftssport', 'sonstiges']);
  });

  it.each([
    [1, true],
    [600, true],
    [0, false],
    [601, false],
    [30.5, false],
  ])('Dauer %s min: %s', (minutes, valid) => {
    expect(isValidManualSportMinutes(minutes)).toBe(valid);
  });

  it.each([
    [null, true],
    [0, true],
    [5_000_000, true],
    [210_000, true],
    [-1, false],
    [5_000_001, false],
    [210_000.5, false],
  ])('Kalorien %s milli_kcal: %s', (milliKcal, valid) => {
    expect(isValidManualSportMilliKcal(milliKcal)).toBe(valid);
  });

  it('nennt 1–600 Minuten, 0–5000 kcal in milli_kcal und für Importe die Schema-Grenze 1–1440 Minuten', () => {
    expect(manualSportMinutes).toEqual({ min: 1, max: 600 });
    expect(manualSportMilliKcal).toEqual({ min: 0, max: 5_000_000 });
    expect(sportEntryMinutes).toEqual({ min: 1, max: 1440 });
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

describe('Annahme importierter Trainings (#183)', () => {
  it('unter 60 Sekunden wird ein Training nicht importiert, auch nicht mit 0 Sekunden', () => {
    expect(importedSportMinutes(0)).toBeNull();
    expect(importedSportMinutes(59)).toBeNull();
    expect(importedSportMinutes(59.9)).toBeNull();
  });

  it('ab 60 Sekunden wird auf ganze Minuten gerundet, halbe Minuten aufwärts', () => {
    expect(importedSportMinutes(60)).toBe(1);
    expect(importedSportMinutes(89)).toBe(1);
    expect(importedSportMinutes(89.9)).toBe(1);
    expect(importedSportMinutes(90)).toBe(2);
    expect(importedSportMinutes(2_700)).toBe(45);
  });

  it('Trainings außerhalb der Schemagrenzen von 1–1440 Minuten werden nicht übernommen', () => {
    expect(importedSportMinutes(1_440 * 60)).toBe(sportEntryMinutes.max);
    expect(importedSportMinutes(1_440 * 60 + 29)).toBe(1_440);
    expect(importedSportMinutes(1_440 * 60 + 30)).toBeNull();
    expect(importedSportMinutes(Number.NaN)).toBeNull();
    expect(importedSportMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(importedSportMinutes(-120)).toBeNull();
  });
});

describe('Annahme importierter Gewichte (#183)', () => {
  it('gilt im Bereich 20–350 kg und behält die genauen Gramm', () => {
    expect(importedWeightG).toEqual({ min: 20_000, max: 350_000 });
    expect(isValidImportedWeight(20_000)).toBe(true);
    expect(isValidImportedWeight(82_437)).toBe(true);
    expect(isValidImportedWeight(350_000)).toBe(true);
  });

  it('nimmt Gewichte außerhalb des Bereichs und Bruchteile von Gramm nicht an', () => {
    expect(isValidImportedWeight(19_999)).toBe(false);
    expect(isValidImportedWeight(350_001)).toBe(false);
    expect(isValidImportedWeight(82_437.5)).toBe(false);
    expect(isValidImportedWeight(Number.NaN)).toBe(false);
  });
});

describe('Abbildung der Plattform-Aktivitätsarten (#183)', () => {
  it('ist versioniert', () => {
    expect(activityMappingVersion).toBe(1);
  });

  // HealthKit: `HKWorkoutActivityType` aus `HKWorkoutActivityType.h` des iOS SDK (Xcode 27.0).
  it.each([
    [52, 'gehen'],
    [24, 'gehen'],
    [37, 'laufen'],
    [13, 'radfahren'],
    [46, 'schwimmen'],
    [50, 'krafttraining'],
    [20, 'krafttraining'],
    [57, 'yoga_dehnen'],
    [62, 'yoga_dehnen'],
    [66, 'yoga_dehnen'],
    [41, 'mannschaftssport'],
    [6, 'mannschaftssport'],
    [3000, 'sonstiges'],
    [16, 'sonstiges'],
  ] as const)('Apple Health %i → %s', (code, type) => {
    expect(activityTypeOfPlatform('apple_health', code)).toBe(type);
  });

  // Health Connect: Konstanten `EXERCISE_TYPE_*` von `ExerciseSessionRecord`.
  it.each([
    [79, 'gehen'],
    [37, 'gehen'],
    [56, 'laufen'],
    [57, 'laufen'],
    [8, 'radfahren'],
    [9, 'radfahren'],
    [73, 'schwimmen'],
    [74, 'schwimmen'],
    [70, 'krafttraining'],
    [81, 'krafttraining'],
    [83, 'yoga_dehnen'],
    [71, 'yoga_dehnen'],
    [48, 'yoga_dehnen'],
    [64, 'mannschaftssport'],
    [5, 'mannschaftssport'],
    [0, 'sonstiges'],
    [25, 'sonstiges'],
  ] as const)('Health Connect %i → %s', (code, type) => {
    expect(activityTypeOfPlatform('health_connect', code)).toBe(type);
  });

  it('macht Unbekanntes zu `sonstiges`, auch Codes der jeweils anderen Plattform und ohne Art', () => {
    expect(activityTypeOfPlatform('apple_health', 9_999)).toBe('sonstiges');
    // 56 ist bei Health Connect Laufen, bei HealthKit Ringen.
    expect(activityTypeOfPlatform('apple_health', 56)).toBe('sonstiges');
    // 24 ist bei HealthKit Wandern, bei Health Connect nicht vergeben.
    expect(activityTypeOfPlatform('health_connect', 24)).toBe('sonstiges');
    expect(activityTypeOfPlatform('health_connect', null)).toBe('sonstiges');
  });

  it('bildet nur auf die acht Arten ab', () => {
    for (const code of Array.from({ length: 100 }, (_, index) => index)) {
      expect(activityTypes).toContain(activityTypeOfPlatform('apple_health', code));
      expect(activityTypes).toContain(activityTypeOfPlatform('health_connect', code));
    }
  });
});

describe('Reinheit', () => {
  it('hat keine Importe, also weder Ein- und Ausgabe noch Bibliotheks- oder Plattformtypen', () => {
    const source = readFileSync(new URL('../src/tracker-rules.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
