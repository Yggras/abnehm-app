import { describe, expect, it } from 'vitest';

import { commonStage, projectNeed } from '../src/projects.ts';

// Nachweis für #179: Projektbedarf und gemeinsame Stufe nach Abschnitt 8 von #83.

describe('Projektbedarf je Anteil', () => {
  it.each([
    [1, 20],
    [2, 30],
    [8, 90], // knapp unter dem Deckel
    [9, 100], // exakt am Deckel
    [10, 100], // Ausbau nach Projekt 9
    [25, 100],
  ])('Projekt %i braucht %i', (sequenceNumber, need) => {
    expect(projectNeed(sequenceNumber)).toBe(need);
  });

  it('lehnt Nummern unter 1 ab', () => {
    expect(() => projectNeed(0)).toThrow(RangeError);
  });
});

const shares = (a: number, b: number, need = 50) => [{ paid: a, need }, { paid: b, need }] as const;

describe('gemeinsame Stufe', () => {
  it.each([
    [0, 0, 'gestartet'],
    [49, 0, 'gestartet'], // 49 %
    [50, 0, 'gut_unterwegs'], // 50 %
    [30, 20, 'gut_unterwegs'],
    [50, 29, 'gut_unterwegs'], // 79 %
    [50, 30, 'fast_geschafft'], // 80 %
    [49, 50, 'fast_geschafft'], // 99 %
    [50, 50, 'geschafft'],
  ] as const)('%i + %i von 50 + 50 → %s', (a, b, stage) => {
    expect(commonStage(shares(a, b))).toBe(stage);
  });

  it('zählt Überzahlung nur bis zum Bedarf und ist erst bei beiden vollen Anteilen geschafft', () => {
    expect(commonStage(shares(200, 0))).toBe('gut_unterwegs');
    expect(commonStage(shares(200, 49))).toBe('fast_geschafft');
    expect(commonStage(shares(200, 50))).toBe('geschafft');
  });

  it('rechnet mit ungleichen Anteilen über die Summe', () => {
    // 17 + 6 = 23: 50 % = 11,5, 80 % = 18,4
    const challenge = (a: number, b: number) => [{ paid: a, need: 17 }, { paid: b, need: 6 }] as const;
    expect(commonStage(challenge(11, 0))).toBe('gestartet');
    expect(commonStage(challenge(12, 0))).toBe('gut_unterwegs');
    expect(commonStage(challenge(12, 6))).toBe('gut_unterwegs');
    expect(commonStage(challenge(13, 6))).toBe('fast_geschafft');
    expect(commonStage(challenge(17, 6))).toBe('geschafft');
  });
});
