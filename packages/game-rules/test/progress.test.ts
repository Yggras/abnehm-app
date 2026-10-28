import { describe, expect, it } from 'vitest';

import { EnergyBooking } from '@abnehm/contracts/energy';

import { islandProgress, levelNeed, levelThreshold, memberHalf, spentOnIsland } from '../src/progress.ts';

// Nachweis für #179: verbaute Energie und Levelkurve nach Abschnitt 3 von #83. Erwartete Werte von
// Hand aus Bedarf(L) = min(10 + L, 30) und Schwelle(L) = Σ Bedarf(k) für k < L gerechnet.

describe('Bedarf und Schwelle', () => {
  it.each([
    [1, 11],
    [2, 12],
    [19, 29],
    [20, 30], // Deckel erreicht
    [21, 30],
    [60, 30],
  ])('Bedarf(%i) = %i', (level, need) => {
    expect(levelNeed(level)).toBe(need);
  });

  it.each([
    [1, 0],
    [2, 11],
    [3, 23],
    [4, 36],
    [6, 65],
    [19, 351],
    [20, 380],
    [21, 410], // ab hier je Level + 30
    [22, 440],
    [60, 1580],
  ])('Schwelle(%i) = %i', (level, threshold) => {
    expect(levelThreshold(level)).toBe(threshold);
  });

  it('lehnt Level unter 1 und Bruchteile ab', () => {
    expect(() => levelNeed(0)).toThrow(RangeError);
    expect(() => levelThreshold(1.5)).toThrow(RangeError);
  });
});

describe('Level der Insel', () => {
  it.each([
    [0, 0, 1],
    [10, 10, 1], // knapp unter Schwelle(2)
    [11, 11, 2], // exakt an Schwelle(2)
    [12, 12, 2],
    [22, 22, 2],
    [23, 23, 3],
    [100, 11, 2], // ungleiche Hälften: die kleinere entscheidet
    [11, 100, 2],
    [100, 10, 1],
    [379, 379, 19],
    [380, 380, 20],
    [409, 409, 20],
    [410, 410, 21],
    [1580, 1580, 60],
  ])('verbaut %i und %i → Level %i', (a, b, level) => {
    expect(islandProgress([a, b]).level).toBe(level);
  });

  it('liefert den Bedarf je Hälfte im aktuellen Level', () => {
    expect(islandProgress([11, 11]).levelNeed).toBe(12);
    expect(islandProgress([400, 395]).levelNeed).toBe(30);
  });

  it('rechnet auch sehr hohe Stände ohne Schleife über alle Level', () => {
    expect(islandProgress([1_000_000_000, 1_000_000_000]).level).toBe(33_333_340);
  });

  it('lehnt negative und gebrochene Stände ab', () => {
    expect(() => islandProgress([-1, 0])).toThrow(RangeError);
    expect(() => islandProgress([0, 0.5])).toThrow(RangeError);
  });
});

describe('Hälften', () => {
  it('beginnt nach dem Aufstieg leer', () => {
    expect(islandProgress([11, 11]).halves).toEqual([
      { percent: 0, full: false },
      { percent: 0, full: false },
    ]);
  });

  it('rundet ab und ist nur bei voller Hälfte 100', () => {
    // Level 2, Bedarf 12: 4/12 = 33,3 %, 6/12 = 50 %, 11/12 = 91,7 %, 12/12 = 100 %
    expect(islandProgress([15, 17]).halves).toEqual([
      { percent: 33, full: false },
      { percent: 50, full: false },
    ]);
    expect(islandProgress([22, 23]).halves).toEqual([
      { percent: 91, full: false },
      { percent: 100, full: true },
    ]);
  });

  it('zeigt eine volle Hälfte, solange der Partner noch fehlt', () => {
    expect(islandProgress([100, 11])).toMatchObject({
      level: 2,
      halves: [
        { percent: 100, full: true },
        { percent: 0, full: false },
      ],
    });
  });

  it('behält den Überschuss beim Aufstieg', () => {
    // A hat 30 verbaut, B erreicht mit 23 Level 3 (Schwelle 23, Bedarf 13): A behält 7 von 13.
    expect(islandProgress([30, 23])).toMatchObject({
      level: 3,
      halves: [
        { percent: 53, full: false },
        { percent: 0, full: false },
      ],
    });
  });

  it('nutzt ab Level 20 den Deckel 30', () => {
    expect(islandProgress([395, 380]).halves).toEqual([
      { percent: 50, full: false },
      { percent: 0, full: false },
    ]);
  });
});

describe('eigene Hälfte zum Level der Projektion', () => {
  it.each([
    [11, 2, { percent: 0, full: false }],
    [15, 2, { percent: 33, full: false }],
    [22, 2, { percent: 91, full: false }],
    [23, 2, { percent: 100, full: true }], // voll: Momo wartet auf den Partner
    [500, 2, { percent: 100, full: true }],
    [10, 2, { percent: 0, full: false }], // lokal unter der Schwelle, etwa nach einer Gegenbuchung
  ])('verbaut %i auf Level %i', (spent, level, half) => {
    expect(memberHalf(spent, level)).toEqual(half);
  });
});

const person = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const ownObject = '3e5f7a9b-2c4d-4e6f-8a1b-3c5d7e9f1a02';
const otherObject = '3e5f7a9b-2c4d-4e6f-8a1b-3c5d7e9f1a04';
const ownProject = '7a2e4c6b-1d3f-4b5a-8c9e-0f1a2b3c4d02';
const otherProject = '7a2e4c6b-1d3f-4b5a-8c9e-0f1a2b3c4d03';
const island = { objectIds: new Set([ownObject]), projectIds: new Set([ownProject]) };

let nextId = 0;
const bookingId = () => `4f6a8b0c-3d5e-4f7a-9b2c-${String(++nextId).padStart(12, '0')}`;
const base = () => {
  const id = bookingId();
  return { id, personId: person, localDate: '2026-10-14', createdAt: '2026-10-14T12:00:00.000Z', bookingKey: id };
};
const credit = (): EnergyBooking =>
  EnergyBooking.parse({
    type: 'daily_goal_credit', ...base(), amount: 1, bookingKey: `tagesziel:${person}:2026-10-14:1`,
    trigger: { dailyGoalCompletionId: bookingId(), slot: 1 },
  });
const build = (amount: number, islandObjectId: string): EnergyBooking => {
  const b = base();
  return EnergyBooking.parse({ type: 'build_debit', ...b, amount, trigger: { commandId: b.id, islandObjectId } });
};
const upgrade = (amount: number, islandObjectId: string): EnergyBooking => {
  const b = base();
  return EnergyBooking.parse({ type: 'upgrade_debit', ...b, amount, trigger: { commandId: b.id, islandObjectId, toLevel: 2 } });
};
const contribution = (amount: number, projectId: string): EnergyBooking => {
  const b = base();
  return EnergyBooking.parse({ type: 'project_contribution_debit', ...b, amount, trigger: { commandId: b.id, projectId } });
};
const counterOf = (original: EnergyBooking): EnergyBooking => {
  const b = base();
  return EnergyBooking.parse({
    type: 'counter_booking', ...b, amount: -original.amount, bookingKey: `gegenbuchung:${original.id}`,
    trigger: { originalBookingId: original.id, originalType: original.type, originalAmount: original.amount },
  });
};

describe('verbaute Energie je Insel', () => {
  it('zählt Bauen, Aufwerten und Einzahlen auf dieser Insel mit ihrem Betrag', () => {
    expect(spentOnIsland([build(-3, ownObject), upgrade(-6, ownObject), contribution(-5, ownProject)], island)).toBe(14);
  });

  it('zählt keine Gutschriften und nichts von einer anderen Insel', () => {
    expect(spentOnIsland([credit(), build(-3, otherObject), contribution(-5, otherProject)], island)).toBe(0);
  });

  it('nimmt Gegenbuchungen mit Gegenzeichen und nur für Ausgaben dieser Insel mit', () => {
    const own = build(-3, ownObject);
    const other = build(-4, otherObject);
    const gift = credit();
    const bookings = [own, upgrade(-6, ownObject), counterOf(own), other, counterOf(other), gift, counterOf(gift)];
    expect(spentOnIsland(bookings, island)).toBe(6);
  });

  it('ist ohne Buchungen 0', () => {
    expect(spentOnIsland([], island)).toBe(0);
  });

  it('verlangt die ursprüngliche Buchung einer Gegenbuchung', () => {
    expect(() => spentOnIsland([counterOf(build(-3, ownObject))], island)).toThrow(/ursprüngliche Buchung/);
  });

  it('verlangt die Buchungen genau einer Person', () => {
    const partner = EnergyBooking.parse({ ...build(-3, ownObject), personId: '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02' });
    expect(() => spentOnIsland([build(-3, ownObject), partner], island)).toThrow(/einer Person/);
  });
});
