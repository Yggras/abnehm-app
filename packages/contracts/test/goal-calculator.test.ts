import { describe, expect, it } from 'vitest';

import { LocalDate } from '../src/base.ts';
import { calculateGoals, type GoalCalculation, type GoalCalculatorInput } from '../src/goal-calculator.ts';

// Nachweis für #127: Wahrheitstabellen des Zielrechners (Spezifikation 1, Abschnitt 3). Erwartete
// Werte sind von Hand nachgerechnet, nicht mit der Formel des Rechners erzeugt.

const day = (value: string) => LocalDate.parse(value);

/** Referenzfall aus research/calorie-needs.md: Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt. */
const referenz: GoalCalculatorInput = {
  calculationDate: day('2026-10-28'),
  calculationSex: 'weiblich',
  birthDate: day('1991-05-10'),
  heightCm: 168,
  weightG: 80_000,
  weightTrendG: null,
  activityLevel: 'wenig_aktiv',
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  goalWeightG: 76_000,
  pace: 'entspannt',
  manualBudgetKcal: null,
  waterTargetMl: null,
  weeklySportTargetMinutes: null,
};

function berechnet(changes: Partial<GoalCalculatorInput> = {}): GoalCalculation {
  const result = calculateGoals({ ...referenz, ...changes });
  if (result.type !== 'berechnet') throw new Error(`Ungültig: ${result.errors.join(', ')}`);
  return result;
}

describe('Referenzfall der Recherche', () => {
  it('Frau, 35 Jahre, 168 cm, 80 kg → 1.514 kcal Grundumsatz, ≈ 2.120 kcal Gesamtumsatz, ≈ 1.620 kcal Budget', () => {
    const result = berechnet();

    expect(result.ageYears).toBe(35);
    expect(result.basalMetabolicRate).toEqual({ kcal: 1_514, milliKcal: 1_514_000 });
    expect(result.totalEnergyExpenditure).toEqual({ kcal: 2_120, milliKcal: 2_120_000 });
    expect(result.deficit).toEqual({ kcal: 500, milliKcal: 500_000 });
    expect(result.lowerBound).toEqual({ kcal: 1_514, milliKcal: 1_514_000 });
    expect(result.calorieBudget).toEqual({ kcal: 1_620, milliKcal: 1_620_000 });
    expect(result.budgetSource).toBe('berechnet');
  });
});

describe('Wahrheitstabelle: Berechnungsgeschlecht × Aktivitätsstufe', () => {
  // 35 Jahre, 168 cm, 80 kg. Grundumsatz 800 + 1.050 − 175 − 161 = 1.514 bzw. + 5 = 1.680 kcal.
  it.each([
    ['weiblich', 'wenig_aktiv', 1.4, 1_514, 2_120, 1_620, 1_520],
    ['weiblich', 'maessig_aktiv', 1.6, 1_514, 2_422, 1_920, 1_670],
    ['weiblich', 'aktiv', 1.8, 1_514, 2_725, 2_230, 1_980],
    ['maennlich', 'wenig_aktiv', 1.4, 1_680, 2_352, 1_850, 1_680],
    ['maennlich', 'maessig_aktiv', 1.6, 1_680, 2_688, 2_190, 1_940],
    ['maennlich', 'aktiv', 1.8, 1_680, 3_024, 2_520, 2_270],
  ] as const)(
    '%s, %s (PAL %s): Grundumsatz %i, Gesamtumsatz %i, Budget entspannt %i, zügiger %i',
    (calculationSex, activityLevel, activityFactor, basal, total, relaxed, faster) => {
      const entspannt = berechnet({ calculationSex, activityLevel });
      const zuegiger = berechnet({ calculationSex, activityLevel, pace: 'zuegiger' });

      expect(entspannt.activityFactor).toBe(activityFactor);
      expect(entspannt.basalMetabolicRate.kcal).toBe(basal);
      expect(entspannt.lowerBound.kcal).toBe(basal);
      expect(entspannt.totalEnergyExpenditure.kcal).toBe(total);
      expect(entspannt.calorieBudget.kcal).toBe(relaxed);
      expect(zuegiger.deficit?.kcal).toBe(750);
      expect(zuegiger.calorieBudget.kcal).toBe(faster);
    },
  );
});

describe('Untergrenze und Rundung des Budgets', () => {
  it('hebt auf 1.200 kcal an, wenn der Grundumsatz darunter liegt, und setzt den Hinweis', () => {
    // Frau, 60 Jahre, 155 cm, 50 kg: Grundumsatz 1.007,75; × 1,4 = 1.410,85; − 500 = 910,85 < 1.200.
    const result = berechnet({ birthDate: day('1966-01-01'), heightCm: 155, weightG: 50_000, goalWeightG: 47_500 });

    expect(result.basalMetabolicRate.kcal).toBe(1_008);
    expect(result.lowerBound.kcal).toBe(1_200);
    expect(result.calorieBudget.kcal).toBe(1_200);
    expect(result.budgetRaisedToLowerBound).toBe(true);
    expect(result.hints).toContain('budget_raised_to_lower_bound');
  });

  it('hebt auf den Grundumsatz an und rundet dann auf das nächste Vielfache von 10 darüber', () => {
    // Mann, 41 Jahre, 175 cm, 80 kg, zügiger: Grundumsatz 1.693,75; × 1,4 = 2.371,25; − 750 = 1.621,25.
    // Auf den Grundumsatz angehoben ergäbe die Rundung 1.690 und läge unter der Untergrenze.
    const result = berechnet({
      calculationSex: 'maennlich',
      birthDate: day('1985-01-01'),
      heightCm: 175,
      pace: 'zuegiger',
    });

    expect(result.lowerBound.kcal).toBe(1_694);
    expect(result.calorieBudget).toEqual({ kcal: 1_700, milliKcal: 1_700_000 });
    expect(result.budgetRaisedToLowerBound).toBe(true);
    expect(result.hints).toContain('budget_raised_to_lower_bound');
  });

  it('rundet ein knapp über der Untergrenze liegendes Budget nach oben statt darunter, ohne Anhebungshinweis', () => {
    // Mann, 30 Jahre, 173 cm, 94,4 kg, zügiger: Grundumsatz 1.880,25; × 1,4 − 750 = 1.882,35 → 1.880 < 1.880,25.
    const result = berechnet({
      calculationSex: 'maennlich',
      birthDate: day('1996-01-01'),
      heightCm: 173,
      weightG: 94_400,
      goalWeightG: 90_000,
      pace: 'zuegiger',
    });

    expect(result.lowerBound.kcal).toBe(1_880);
    expect(result.calorieBudget.kcal).toBe(1_890);
    expect(result.budgetRaisedToLowerBound).toBe(false);
    expect(result.hints).not.toContain('budget_raised_to_lower_bound');
  });

  it('setzt im Referenzfall keinen Anhebungshinweis', () => {
    expect(berechnet().budgetRaisedToLowerBound).toBe(false);
    expect(berechnet().hints).not.toContain('budget_raised_to_lower_bound');
  });
});

describe('Haltemodus', () => {
  it.each([
    ['Schwangerschaft oder Stillzeit', { pregnantOrBreastfeeding: true }, ['schwanger_oder_stillend']],
    ['bekannter Essstörung', { knownEatingDisorder: true }, ['essstoerung']],
    ['beiden Angaben', { pregnantOrBreastfeeding: true, knownEatingDisorder: true }, ['schwanger_oder_stillend', 'essstoerung']],
  ] as const)('erzwingt ihn bei %s: ohne Tempo und Defizit, Budget = Gesamtumsatz', (_, changes, triggers) => {
    const result = berechnet(changes);

    expect(result.maintenanceReason).toBe('sicherheits_check');
    expect(result.safetyTriggers).toEqual(triggers);
    expect(result.pace).toBeNull();
    expect(result.deficit).toBeNull();
    expect(result.calorieBudget.kcal).toBe(2_120);
    expect(result.hints).toContain('maintenance_forced');
  });

  describe('BMI aus aktuellem Gewicht und Größe (200 cm: BMI 18,5 bei 74,0 kg)', () => {
    const at = (weightG: number) => berechnet({ heightCm: 200, weightG, goalWeightG: 74_000 });

    it('erzwingt ihn knapp unter 18,5', () => {
      const result = at(73_900);

      expect(result.bmi).toBeCloseTo(18.475, 10);
      expect(result.maintenanceReason).toBe('sicherheits_check');
      expect(result.safetyTriggers).toEqual(['untergewicht']);
    });

    it.each([
      ['genau 18,5', 74_000, 18.5],
      ['knapp über 18,5', 74_100, 18.525],
    ])('erzwingt ihn nicht bei %s', (_, weightG, bmi) => {
      const result = at(weightG);

      expect(result.bmi).toBeCloseTo(bmi, 10);
      expect(result.safetyTriggers).toEqual([]);
      expect(result.maintenanceReason).not.toBe('sicherheits_check');
      expect(result.hints).not.toContain('maintenance_forced');
    });
  });

  it('kennt ohne Sicherheitsgrund weder Haltemodus noch Hinweis', () => {
    const result = berechnet();

    expect(result.bmi).toBeCloseTo(28.345, 3);
    expect(result.maintenanceReason).toBeNull();
    expect(result.pace).toBe('entspannt');
    expect(result.safetyTriggers).toEqual([]);
    expect(result.hints).toEqual([]);
  });

  it('hat den Grund „gewählt“, wenn kein Tempo gewählt ist', () => {
    const result = berechnet({ pace: null });

    expect(result.maintenanceReason).toBe('gewaehlt');
    expect(result.deficit).toBeNull();
    expect(result.calorieBudget.kcal).toBe(2_120);
    expect(result.hints).toEqual([]);
  });

  it.each([
    ['gleich dem aktuellen Gewicht', 80_000],
    ['über dem aktuellen Gewicht', 82_500],
  ])('setzt ihn mit Grund „gewählt“ und Hinweis, wenn das Zielgewicht %s liegt', (_, goalWeightG) => {
    const result = berechnet({ goalWeightG, pace: 'zuegiger' });

    expect(result.maintenanceReason).toBe('gewaehlt');
    expect(result.pace).toBeNull();
    expect(result.deficit).toBeNull();
    expect(result.calorieBudget.kcal).toBe(2_120);
    expect(result.hints).toEqual(['goal_weight_not_below_current']);
  });

  it('bleibt erzwungen, auch wenn das Zielgewicht nicht unter dem aktuellen liegt', () => {
    const result = berechnet({ goalWeightG: 80_000, knownEatingDisorder: true });

    expect(result.maintenanceReason).toBe('sicherheits_check');
    expect(result.hints).toEqual(['maintenance_forced']);
  });
});

/** Fehlerschlüssel einer ungültigen Eingabe; bei gültiger Eingabe ein leeres Array. */
function fehler(changes: Partial<GoalCalculatorInput>): string[] {
  const result = calculateGoals({ ...referenz, ...changes });
  return result.type === 'ungueltig' ? result.errors : [];
}

describe('Eingabegrenzen', () => {
  it.each([
    ['Größe 120 cm', { heightCm: 120, weightG: 30_000, goalWeightG: 28_000 }],
    ['Größe 230 cm', { heightCm: 230, weightG: 300_000, goalWeightG: 290_000 }],
    ['Gewicht 30,0 kg', { heightCm: 125, weightG: 30_000, goalWeightG: 29_000 }],
    ['Gewicht 300,0 kg', { weightG: 300_000, goalWeightG: 280_000 }],
  ])('%s ist erlaubt', (_, changes) => {
    expect(fehler(changes)).toEqual([]);
  });

  it.each([
    ['Größe 119 cm', { heightCm: 119 }, ['height_out_of_range']],
    ['Größe 231 cm', { heightCm: 231 }, ['height_out_of_range']],
    ['Größe 170,5 cm', { heightCm: 170.5 }, ['height_not_on_step']],
    ['Gewicht 29,9 kg', { weightG: 29_900 }, ['weight_out_of_range']],
    ['Gewicht 300,1 kg', { weightG: 300_100 }, ['weight_out_of_range']],
    ['Gewicht 80,05 kg', { weightG: 80_050 }, ['weight_not_on_step']],
    ['Größe und Gewicht zugleich', { heightCm: 100, weightG: 400_000 }, ['height_out_of_range', 'weight_out_of_range']],
  ] as const)('%s ergibt einen typisierten Fehlerschlüssel statt einer Ausnahme', (_, changes, errors) => {
    expect(fehler(changes)).toEqual(errors);
  });

  describe('Alter ab 18 Jahren am Berechnungstag', () => {
    it('ein 18. Geburtstag am Berechnungstag gilt als volljährig', () => {
      expect(berechnet({ birthDate: day('2008-10-28') }).ageYears).toBe(18);
    });

    it('einen Tag vor dem 18. Geburtstag ergibt `underage`', () => {
      expect(fehler({ birthDate: day('2008-10-29') })).toEqual(['underage']);
    });

    it('ein Geburtsdatum nach dem Berechnungstag ergibt `underage`', () => {
      expect(fehler({ birthDate: day('2026-10-29') })).toEqual(['underage']);
    });

    it('wer am 29. Februar geboren ist, wird in Nichtschaltjahren am 1. März ein Jahr älter (Designwert)', () => {
      const born = { birthDate: day('2008-02-29') };
      expect(fehler({ ...born, calculationDate: day('2026-02-28') })).toEqual(['underage']);
      expect(berechnet({ ...born, calculationDate: day('2026-03-01') }).ageYears).toBe(18);
    });

    it('zählt volle Jahre: 35 am Geburtstag, 34 am Tag davor', () => {
      expect(berechnet({ calculationDate: day('2026-05-10') }).ageYears).toBe(35);
      expect(berechnet({ calculationDate: day('2026-05-09') }).ageYears).toBe(34);
    });
  });
});

describe('Zielgewicht', () => {
  it('schlägt 5–10 % unter dem aktuellen Gewicht vor und wählt 5 % vor', () => {
    const result = berechnet({ goalWeightG: null });

    expect(result.goalWeight).toEqual({
      goalWeightG: 76_000,
      preselectedG: 76_000,
      suggestion: { fromG: 72_000, toG: 76_000 },
      // 18,5 × 1,68² = 52,2144 kg, auf 0,1 kg aufgerundet.
      range: { min: 52_300, max: 300_000, step: 100 },
    });
  });

  it('rundet den Vorschlag auf 0,1 kg nach innen, damit er im Bereich 5–10 % bleibt', () => {
    // 83,3 kg: 5 % darunter 79,135 → 79,1 kg; 10 % darunter 74,97 → 75,0 kg.
    expect(berechnet({ weightG: 83_300, goalWeightG: null }).goalWeight.suggestion).toEqual({ fromG: 75_000, toG: 79_100 });
  });

  it('übernimmt ein eingegebenes Zielgewicht', () => {
    expect(berechnet({ goalWeightG: 70_500 }).goalWeight.goalWeightG).toBe(70_500);
  });

  describe('Untergrenze bei BMI 18,5', () => {
    it.each([
      ['200 cm, genau BMI 18,5', 200, 74_000, 73_900],
      ['168 cm, aufgerundet von 52,2144 kg', 168, 52_300, 52_200],
    ])('%s: %i g erlaubt, %i g nicht', (_, heightCm, allowedG, belowG) => {
      expect(fehler({ heightCm, weightG: 90_000, goalWeightG: allowedG })).toEqual([]);
      expect(fehler({ heightCm, weightG: 90_000, goalWeightG: belowG })).toEqual(['goal_weight_below_lower_limit']);
    });

    it('beschneidet den Vorschlag an der Untergrenze', () => {
      // 200 cm, 80 kg: 72,0–76,0 kg vorgeschlagen, Untergrenze 74,0 kg.
      const result = berechnet({ heightCm: 200, goalWeightG: null });

      expect(result.goalWeight.suggestion).toEqual({ fromG: 74_000, toG: 76_000 });
      expect(result.goalWeight.preselectedG).toBe(76_000);
    });

    it('hat keinen Vorschlag, wenn schon 5 % unter dem Gewicht unter der Untergrenze liegen, und wählt die Untergrenze vor', () => {
      // 200 cm, 77 kg: 5 % darunter sind 73,1 kg < 74,0 kg.
      const result = berechnet({ heightCm: 200, weightG: 77_000, goalWeightG: null });

      expect(result.goalWeight.suggestion).toBeNull();
      expect(result.goalWeight.goalWeightG).toBe(74_000);
      expect(result.maintenanceReason).toBeNull();
    });

    it('wählt im Untergewicht die Untergrenze vor, ohne Hinweis zum Zielgewicht', () => {
      const result = berechnet({ heightCm: 200, weightG: 73_900, goalWeightG: null });

      expect(result.goalWeight.suggestion).toBeNull();
      expect(result.goalWeight.goalWeightG).toBe(74_000);
      expect(result.maintenanceReason).toBe('sicherheits_check');
      expect(result.hints).toEqual(['maintenance_forced']);
    });
  });

  it.each([
    ['nicht in 0,1-kg-Schritten', 76_050, 'goal_weight_not_on_step'],
    ['über 300,0 kg', 300_100, 'goal_weight_out_of_range'],
  ])('ist %s ungültig', (_, goalWeightG, error) => {
    expect(fehler({ goalWeightG })).toEqual([error]);
  });
});
