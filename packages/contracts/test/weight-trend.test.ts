import { describe, expect, it } from 'vitest';

import { showsTrend, sinceStartG, trendValueOn, weightChange, weightForecast, weightTrend, type DayWeight } from '../src/tracker-rules.ts';

// Nachweis für #176: Gewichtstrend, Trendwert eines Tages, `changeKg`, „seit Start“ und Prognose der
// Tracker-Regeln (Spezifikation 3, Abschnitt 3; Spezifikation 0, Abschnitt 5).

const day = (localDate: string, weightG: number): DayWeight => ({ localDate, weightG });

describe('Gewichtstrend', () => {
  it('entspricht bei täglichem Wiegen der Glättung aus The Hacker’s Diet (Konstante 0,9)', () => {
    // Walker: Trend += 0,1 × (Gewicht − Trend), Startwert das erste Gewicht.
    const days = [day('2026-10-01', 80_000), day('2026-10-02', 81_000), day('2026-10-03', 79_000), day('2026-10-04', 79_500)];
    let expected = 80_000;
    const hackersDiet = days.map(({ weightG }, index) => (index === 0 ? expected : (expected += 0.1 * (weightG - expected))));

    expect(weightTrend(days).map((point) => point.trendG)).toEqual(hackersDiet.map(Math.round));
    expect(weightTrend(days).map((point) => point.trendG)).toEqual([80_000, 80_100, 79_990, 79_941]);
  });

  it('gewichtet eine Lücke mit 1 − 0,9^Δt, Δt in Kalendertagen seit dem letzten Tagesgewicht', () => {
    // Drei Tage Lücke: 80 000 + (1 − 0,729) × (79 000 − 80 000) = 79 729.
    expect(weightTrend([day('2026-10-01', 80_000), day('2026-10-04', 79_000)])).toEqual([
      { localDate: '2026-10-01', dayWeightG: 80_000, trendG: 80_000 },
      { localDate: '2026-10-04', dayWeightG: 79_000, trendG: 79_729 },
    ]);
  });

  it('zählt Kalendertage, auch über den Monatswechsel und die Zeitumstellung', () => {
    // 24.10. bis 26.10.2026 sind zwei Kalendertage, obwohl dazwischen eine Stunde mehr liegt.
    const [, second] = weightTrend([day('2026-10-24', 80_000), day('2026-10-26', 79_000)]);
    expect(second!.trendG).toBe(Math.round(80_000 + (1 - 0.9 ** 2) * -1_000));
    const [, overMonth] = weightTrend([day('2026-10-31', 80_000), day('2026-11-01', 79_000)]);
    expect(overMonth!.trendG).toBe(79_900);
  });

  it('rechnet mit Gleitkomma und rundet erst nach außen auf ganze g', () => {
    // 80 000,3 → 80 000; danach 80 000,3 + 0,1 × (80 004 − 80 000,3) = 80 000,67 → 80 001.
    // Mit gerundetem Zwischenwert wären es 80 000 und 80 000,4 → 80 000.
    expect(weightTrend([day('2026-10-01', 80_000), day('2026-10-02', 80_003), day('2026-10-03', 80_004)]).map((point) => point.trendG)).toEqual([
      80_000, 80_000, 80_001,
    ]);
  });

  it('ist ohne Tagesgewicht leer', () => {
    expect(weightTrend([])).toEqual([]);
  });
});

describe('Trendwert eines Tages', () => {
  const points = weightTrend([day('2026-10-01', 80_000), day('2026-10-04', 79_000), day('2026-10-05', 79_500)]);

  it('ist der Trend nach dem letzten Tagesgewicht an oder vor dem Tag', () => {
    expect(trendValueOn(points, '2026-10-04')).toBe(79_729);
    expect(trendValueOn(points, '2026-10-03')).toBe(80_000);
    expect(trendValueOn(points, '2026-10-20')).toBe(points[2]!.trendG);
  });

  it('fehlt vor dem ersten Tagesgewicht', () => {
    expect(trendValueOn(points, '2026-09-30')).toBeNull();
  });

  it('wird erst ab drei Tagesgewichten angezeigt', () => {
    expect(showsTrend(0)).toBe(false);
    expect(showsTrend(2)).toBe(false);
    expect(showsTrend(3)).toBe(true);
  });
});

describe('changeKg', () => {
  const today = '2026-10-14';

  it('ist Trendwert am Tag D minus Trendwert am Tag D − 14', () => {
    // Bezug: Trendwert am 30.09. = 80 000. Am 14.10. nach 14 Tagen Lücke 80 000 + (1 − 0,9^14) × 2 000 = 81 542,5.
    const points = weightTrend([day('2026-09-28', 80_000), day('2026-09-29', 80_000), day('2026-09-30', 80_000), day(today, 82_000)]);
    expect(points.at(-1)!.trendG).toBe(81_542);
    expect(weightChange(points, today)).toEqual({ changeKg: 1.5, direction: 'steigend' });
  });

  it('nimmt das erste Tagesgewicht als Bezug, wenn es nach D − 14 liegt', () => {
    // 80 000 + (1 − 0,81) × (76 000 − 80 000) = 79 240; Bezug ist das erste Tagesgewicht 80 000.
    const points = weightTrend([day('2026-10-10', 80_000), day('2026-10-12', 80_000), day(today, 76_000)]);
    expect(weightChange(points, today)).toEqual({ changeKg: -0.8, direction: 'sinkend' });
  });

  it('ist ohne Tagesgewicht zwischen D − 13 und D nicht verfügbar', () => {
    const points = weightTrend([day('2026-09-20', 80_000), day('2026-09-25', 79_500), day('2026-09-30', 79_000)]);
    expect(weightChange(points, today)).toEqual({ changeKg: null, direction: 'noch_nicht_verfuegbar' });
    // Am Tag D − 13 reicht es.
    expect(weightChange(weightTrend([...[day('2026-09-20', 80_000), day('2026-09-25', 79_500)], day('2026-10-01', 79_000)]), today).direction).not.toBe(
      'noch_nicht_verfuegbar',
    );
  });

  it('ist unter drei Tagesgewichten nicht verfügbar', () => {
    expect(weightChange(weightTrend([day('2026-10-12', 80_000), day(today, 79_000)]), today)).toEqual({ changeKg: null, direction: 'noch_nicht_verfuegbar' });
    expect(weightChange([], today)).toEqual({ changeKg: null, direction: 'noch_nicht_verfuegbar' });
  });

  it('zählt nur Tagesgewichte an oder vor D', () => {
    const points = weightTrend([day('2026-10-12', 80_000), day('2026-10-13', 79_000), day('2026-10-15', 79_000)]);
    expect(weightChange(points, '2026-10-13')).toEqual({ changeKg: null, direction: 'noch_nicht_verfuegbar' });
  });

  it('rundet auf 0,1 kg, halbe Zehntel vom Nullpunkt weg, und bestimmt die Richtung nach der Rundung', () => {
    // 80 000 → 75 500 täglich: 80 000 + 0,1 × (−4 500) = 79 550, also −450 g → −0,5 kg.
    expect(weightChange(weightTrend([day('2026-10-12', 80_000), day('2026-10-13', 80_000), day(today, 75_500)]), today)).toEqual({
      changeKg: -0.5,
      direction: 'sinkend',
    });
    expect(weightChange(weightTrend([day('2026-10-12', 80_000), day('2026-10-13', 80_000), day(today, 84_500)]), today)).toEqual({
      changeKg: 0.5,
      direction: 'steigend',
    });
    // −40 g rundet auf 0,0 kg: stabil, ohne negative Null.
    const stable = weightChange(weightTrend([day('2026-10-12', 80_000), day('2026-10-13', 80_000), day(today, 79_600)]), today);
    expect(stable).toEqual({ changeKg: 0, direction: 'stabil' });
    expect(Object.is(stable.changeKg, -0)).toBe(false);
  });
});

describe('seit Start', () => {
  const today = '2026-10-14';

  it('ist Trendwert heute minus erstes Tagesgewicht', () => {
    const points = weightTrend([day('2026-10-10', 80_000), day('2026-10-12', 80_000), day(today, 76_000)]);
    expect(sinceStartG(points, today)).toBe(-760);
  });

  it('gibt es nur, solange der Trend angezeigt wird', () => {
    expect(sinceStartG(weightTrend([day('2026-10-12', 80_000), day(today, 79_000)]), today)).toBeNull();
    expect(sinceStartG([], today)).toBeNull();
  });
});

describe('Prognose', () => {
  const today = '2026-10-14';

  it('ist heute + aufgerundet (Trendwert − Zielgewicht) ÷ 0,5 kg × 7 Tage bei „entspannt“', () => {
    // 5 kg ÷ 0,5 kg/Woche = 10 Wochen = 70 Tage.
    expect(weightForecast({ today, trendG: 80_000, goalWeightG: 75_000, pace: 'entspannt' })).toBe('2026-12-23');
    // 5,001 kg → 70,014 Tage → 71 Tage.
    expect(weightForecast({ today, trendG: 80_001, goalWeightG: 75_000, pace: 'entspannt' })).toBe('2026-12-24');
  });

  it('rechnet bei „zügiger“ mit 0,75 kg je Woche', () => {
    // 5 kg ÷ 0,75 kg/Woche × 7 = 46,67 → 47 Tage.
    expect(weightForecast({ today, trendG: 80_000, goalWeightG: 75_000, pace: 'zuegiger' })).toBe('2026-11-30');
  });

  it('entfällt im Haltemodus (ohne Tempo)', () => {
    expect(weightForecast({ today, trendG: 80_000, goalWeightG: 75_000, pace: null })).toBeNull();
  });

  it('entfällt ohne Trend', () => {
    expect(weightForecast({ today, trendG: null, goalWeightG: 75_000, pace: 'entspannt' })).toBeNull();
  });

  it('entfällt, sobald der Trendwert das Zielgewicht erreicht oder unterschritten hat', () => {
    expect(weightForecast({ today, trendG: 75_000, goalWeightG: 75_000, pace: 'entspannt' })).toBeNull();
    expect(weightForecast({ today, trendG: 74_900, goalWeightG: 75_000, pace: 'zuegiger' })).toBeNull();
  });
});
