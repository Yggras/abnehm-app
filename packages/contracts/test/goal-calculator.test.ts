import { describe, expect, it } from 'vitest';

import { LocalDate } from '../src/base.ts';
import {
  ageOn,
  bodyDataErrors,
  bodyInputLimits,
  calculateGoals,
  sportSessionThreshold,
  type GoalCalculation,
  type GoalCalculatorInput,
  type GoalInputError,
} from '../src/goal-calculator.ts';

// Nachweis für #127: Wahrheitstabellen des Zielrechners (Spezifikation 1, Abschnitt 3). Erwartete
// Werte sind von Hand nachgerechnet, nicht mit der Formel des Rechners erzeugt.

const day = (value: string) => LocalDate.parse(value);

/** Referenzfall aus research/calorie-needs.md: Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt. */
const referenz: GoalCalculatorInput = {
  calculationDate: day('2026-10-28'),
  calculationSex: 'weiblich',
  ageYears: 35,
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

/** Fehlerschlüssel einer ungültigen Eingabe; bei gültiger Eingabe ein leeres Array. */
function fehler(changes: Partial<GoalCalculatorInput>): GoalInputError[] {
  const result = calculateGoals({ ...referenz, ...changes });
  return result.type === 'ungueltig' ? result.errors : [];
}

describe('Referenzfall der Recherche', () => {
  it('Frau, 35 Jahre, 168 cm, 80 kg → 1.514 kcal Grundumsatz, ≈ 2.120 kcal Gesamtumsatz, ≈ 1.620 kcal Budget', () => {
    const result = berechnet();

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
    const result = berechnet({ ageYears: 60, heightCm: 155, weightG: 50_000, goalWeightG: 47_500 });

    expect(result.basalMetabolicRate.kcal).toBe(1_008);
    expect(result.lowerBound.kcal).toBe(1_200);
    expect(result.calorieBudget.kcal).toBe(1_200);
    expect(result.budgetRaisedToLowerBound).toBe(true);
    expect(result.hints).toEqual(['budget_raised_to_lower_bound']);
  });

  it('hebt auf den Grundumsatz an und rundet dann auf das nächste Vielfache von 10 darüber', () => {
    // Mann, 41 Jahre, 175 cm, 80 kg, zügiger: Grundumsatz 1.693,75; × 1,4 = 2.371,25; − 750 = 1.621,25.
    // Auf den Grundumsatz angehoben ergäbe die Rundung 1.690 und läge unter der Untergrenze.
    const result = berechnet({ calculationSex: 'maennlich', ageYears: 41, heightCm: 175, pace: 'zuegiger' });

    expect(result.lowerBound.kcal).toBe(1_694);
    expect(result.calorieBudget).toEqual({ kcal: 1_700, milliKcal: 1_700_000 });
    expect(result.budgetRaisedToLowerBound).toBe(true);
    expect(result.hints).toEqual(['budget_raised_to_lower_bound']);
  });

  it('rundet ein knapp über der Untergrenze liegendes Budget nach oben statt darunter, ohne Anhebungshinweis', () => {
    // Mann, 30 Jahre, 173 cm, 94,4 kg, zügiger: Grundumsatz 1.880,25; × 1,4 − 750 = 1.882,35 → 1.880 < 1.880,25.
    const result = berechnet({
      calculationSex: 'maennlich',
      ageYears: 30,
      heightCm: 173,
      weightG: 94_400,
      goalWeightG: 90_000,
      pace: 'zuegiger',
    });

    expect(result.lowerBound.kcal).toBe(1_880);
    expect(result.calorieBudget.kcal).toBe(1_890);
    expect(result.budgetRaisedToLowerBound).toBe(false);
    expect(result.hints).toEqual([]);
  });

  it('hebt auch im Haltemodus an, wenn schon der Gesamtumsatz unter der Untergrenze liegt', () => {
    // Frau, 70 Jahre, 140 cm, 36,3 kg: Grundumsatz 727; × 1,4 = 1.017,8 < 1.200.
    const result = berechnet({ ageYears: 70, heightCm: 140, weightG: 36_300, goalWeightG: null, pace: null });

    expect(result.maintenanceReason).toBe('gewaehlt');
    expect(result.totalEnergyExpenditure.kcal).toBe(1_018);
    expect(result.calorieBudget.kcal).toBe(1_200);
    expect(result.budgetRaisedToLowerBound).toBe(true);
    expect(result.hints).toContain('budget_raised_to_lower_bound');
    expect(result.manualBudgetRange).toEqual({ min: 1_200, max: 1_200, step: 10 });
  });

  it('setzt im Referenzfall keinen Anhebungshinweis', () => {
    expect(berechnet().budgetRaisedToLowerBound).toBe(false);
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
    expect(result.hints).toEqual(['maintenance_forced']);
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
    ['gleich dem aktuellen Gewicht mit Tempo', { goalWeightG: 80_000, pace: 'zuegiger' }],
    ['über dem aktuellen Gewicht mit Tempo', { goalWeightG: 82_500, pace: 'zuegiger' }],
    ['gleich dem aktuellen Gewicht ohne Tempo', { goalWeightG: 80_000, pace: null }],
  ] as const)('setzt ihn mit Grund „gewählt“ und Hinweis bei einem Zielgewicht %s', (_, changes) => {
    const result = berechnet(changes);

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

describe('Eingabegrenzen', () => {
  it.each([
    ['Größe 120 cm', { heightCm: 120, weightG: 30_000, goalWeightG: 28_000 }],
    ['Größe 230 cm', { heightCm: 230, weightG: 300_000, goalWeightG: 290_000 }],
    ['Gewicht 30,0 kg', { heightCm: 125, weightG: 30_000, goalWeightG: 29_000 }],
    ['Gewicht 300,0 kg', { weightG: 300_000, goalWeightG: 280_000 }],
    ['Alter 18 Jahre', { ageYears: 18 }],
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
    ['Alter 17 Jahre', { ageYears: 17 }, ['underage']],
    ['Größe und Gewicht zugleich', { heightCm: 100, weightG: 400_000 }, ['height_out_of_range', 'weight_out_of_range']],
  ] as const)('%s ergibt einen typisierten Fehlerschlüssel statt einer Ausnahme', (_, changes, errors) => {
    expect(fehler(changes)).toEqual(errors);
  });

  it('`bodyDataErrors` prüft Körperdaten allein, wie der Onboarding-Schritt „Körperdaten“ es vor den Zielen braucht', () => {
    expect(bodyDataErrors({ heightCm: 168, weightG: 80_000, ageYears: 18 })).toEqual([]);
    expect(bodyDataErrors({ heightCm: 119, weightG: 80_050, ageYears: 17 })).toEqual(['height_out_of_range', 'weight_not_on_step', 'underage']);
  });

  it('`bodyInputLimits` nennt die Grenzen aus Abschnitt 3 der Spezifikation 1 für Hinweistexte', () => {
    expect(bodyInputLimits).toEqual({
      heightCm: { min: 120, max: 230, step: 1 },
      weightG: { min: 30_000, max: 300_000, step: 100 },
      minimumAgeYears: 18,
    });
  });

  it('meldet mehrere Verstöße der Ziele zugleich', () => {
    expect(fehler({ goalWeightG: 40_000, manualBudgetKcal: 1_000, waterTargetMl: 100, weeklySportTargetMinutes: 5 })).toEqual([
      'goal_weight_below_lower_limit',
      'manual_budget_out_of_range',
      'water_target_out_of_range',
      'sport_target_out_of_range',
    ]);
  });
});

describe('ageOn: Alter in vollen Jahren am Berechnungstag', () => {
  it('ein 18. Geburtstag am Berechnungstag gilt als volljährig, der Tag davor nicht', () => {
    expect(ageOn(day('2008-10-28'), day('2026-10-28'))).toBe(18);
    expect(ageOn(day('2008-10-29'), day('2026-10-28'))).toBe(17);
  });

  it('zählt volle Jahre: 35 am Geburtstag, 34 am Tag davor', () => {
    expect(ageOn(day('1991-05-10'), day('2026-05-10'))).toBe(35);
    expect(ageOn(day('1991-05-10'), day('2026-05-09'))).toBe(34);
  });

  it('wer am 29. Februar geboren ist, wird in Nichtschaltjahren am 1. März ein Jahr älter (Designwert)', () => {
    expect(ageOn(day('2008-02-29'), day('2026-02-28'))).toBe(17);
    expect(ageOn(day('2008-02-29'), day('2026-03-01'))).toBe(18);
    expect(ageOn(day('2008-02-29'), day('2028-02-29'))).toBe(20);
  });

  it('führt vom Geburtsdatum zur Altersgrenze des Rechners', () => {
    const calculationDate = day('2026-10-28');

    expect(fehler({ calculationDate, ageYears: ageOn(day('2008-10-28'), calculationDate) })).toEqual([]);
    expect(fehler({ calculationDate, ageYears: ageOn(day('2008-10-29'), calculationDate) })).toEqual(['underage']);
  });

  it('ist vor der Geburt negativ, der Rechner meldet dann `underage`', () => {
    expect(ageOn(day('2026-10-29'), day('2026-10-28'))).toBe(-1);
    expect(fehler({ ageYears: -1 })).toEqual(['underage']);
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
  ] as const)('ist %s ungültig', (_, goalWeightG, error) => {
    expect(fehler({ goalWeightG })).toEqual([error]);
  });
});

describe('Manuelles Budget', () => {
  // Referenzfall: Untergrenze 1.514 kcal, Gesamtumsatz 2.119,6 → 2.120 kcal.
  it('reicht in 10-kcal-Schritten von der Untergrenze bis zum Gesamtumsatz', () => {
    expect(berechnet().manualBudgetRange).toEqual({ min: 1_520, max: 2_120, step: 10 });
  });

  it.each([
    ['an der unteren Grenze', 1_520],
    ['an der oberen Grenze', 2_120],
  ])('gilt %s anstelle der Rechnung', (_, manualBudgetKcal) => {
    const result = berechnet({ manualBudgetKcal });

    expect(result.calorieBudget).toEqual({ kcal: manualBudgetKcal, milliKcal: manualBudgetKcal * 1_000 });
    expect(result.budgetSource).toBe('manuell');
    expect(result.deficit?.kcal).toBe(500);
    expect(result.budgetRaisedToLowerBound).toBe(false);
  });

  it.each([
    ['unter der Untergrenze', 1_510, 'manual_budget_out_of_range'],
    ['über dem Gesamtumsatz', 2_130, 'manual_budget_out_of_range'],
    ['nicht in 10-kcal-Schritten', 1_625, 'manual_budget_not_on_step'],
  ] as const)('ist %s ungültig', (_, manualBudgetKcal, error) => {
    expect(fehler({ manualBudgetKcal })).toEqual([error]);
  });

  it('übersteigt den Gesamtumsatz auch dann nicht, wenn dieser auf 5 endet', () => {
    // 80,4 kg: Grundumsatz 1.518; × 1,4 = 2.125,2 → 2.125 kcal. Größtes Vielfaches von 10 darunter: 2.120.
    const changes = { weightG: 80_400 };

    expect(berechnet(changes).totalEnergyExpenditure.kcal).toBe(2_125);
    expect(berechnet(changes).manualBudgetRange).toEqual({ min: 1_520, max: 2_120, step: 10 });
    expect(fehler({ ...changes, manualBudgetKcal: 2_130 })).toEqual(['manual_budget_out_of_range']);
  });

  it('gibt es im erzwungenen Haltemodus nicht', () => {
    expect(berechnet({ pregnantOrBreastfeeding: true }).manualBudgetRange).toBeNull();
    expect(fehler({ pregnantOrBreastfeeding: true, manualBudgetKcal: 1_800 })).toEqual(['manual_budget_in_forced_maintenance']);
  });

  it('gilt im gewählten Haltemodus, ohne Defizit', () => {
    const result = berechnet({ pace: null, manualBudgetKcal: 1_800 });

    expect(result.maintenanceReason).toBe('gewaehlt');
    expect(result.manualBudgetRange).toEqual({ min: 1_520, max: 2_120, step: 10 });
    expect(result.calorieBudget.kcal).toBe(1_800);
    expect(result.budgetSource).toBe('manuell');
    expect(result.deficit).toBeNull();
  });
});

describe('Prognose', () => {
  // Berechnungstag 28.10.2026; Wochen = (Basisgewicht − Zielgewicht) ÷ 0,5 bzw. 0,75 kg je Woche.
  it('schätzt im Onboarding aus dem eingegebenen Gewicht: 4 kg ÷ 0,5 kg = 8 Wochen → Dezember 2026', () => {
    expect(berechnet().forecast).toEqual({
      type: 'schaetzung',
      weeks: 8,
      year: 2026,
      month: 12,
      hintKey: 'weight_loss_slows_after_three_months',
    });
  });

  it('nimmt den Gewichtstrend als Basisgewicht, wenn es einen gibt', () => {
    // 79 kg − 76 kg = 3 kg ÷ 0,5 kg = 6 Wochen.
    expect(berechnet({ weightTrendG: 79_000 }).forecast?.weeks).toBe(6);
  });

  it('rundet angebrochene Tage auf: 3,6 kg ÷ 0,75 kg = 4,8 Wochen = 33,6 Tage → 1. Dezember', () => {
    expect(berechnet({ goalWeightG: 76_400, pace: 'zuegiger' }).forecast).toMatchObject({ weeks: 4.8, year: 2026, month: 12 });
  });

  it('reicht über den Jahreswechsel: 20 kg ÷ 0,5 kg = 40 Wochen → August 2027', () => {
    expect(berechnet({ goalWeightG: 60_000 }).forecast).toMatchObject({ weeks: 40, year: 2027, month: 8 });
  });

  it('schätzt 0 Wochen, wenn der Trend schon auf dem Zielgewicht liegt', () => {
    expect(berechnet({ weightTrendG: 75_800 }).forecast).toMatchObject({ weeks: 0, year: 2026, month: 10 });
  });

  it.each([
    ['im erzwungenen Haltemodus', { knownEatingDisorder: true }],
    ['im gewählten Haltemodus', { pace: null }],
    ['bei einem Zielgewicht nicht unter dem aktuellen Gewicht', { goalWeightG: 80_000 }],
  ])('gibt es %s nicht', (_, changes) => {
    expect(berechnet(changes).forecast).toBeNull();
  });
});

describe('Wasserziel', () => {
  it.each([
    [18, 1_500],
    [50, 1_500],
    [51, 1_250],
  ])('schlägt mit %i Jahren %i ml vor', (ageYears, suggestedMl) => {
    expect(berechnet({ ageYears }).water).toEqual({
      targetMl: suggestedMl,
      suggestedMl,
      range: { min: 500, max: 5_000, step: 250 },
      hintKey: 'water_need_higher_in_heat_and_sport',
    });
  });

  it('übernimmt eine Wahl in 250-ml-Schritten von 500 bis 5.000 ml', () => {
    for (const waterTargetMl of [500, 2_250, 5_000]) expect(berechnet({ waterTargetMl }).water.targetMl).toBe(waterTargetMl);
  });

  it.each([
    [250, 'water_target_out_of_range'],
    [5_250, 'water_target_out_of_range'],
    [1_600, 'water_target_not_on_step'],
  ] as const)('lehnt %i ml ab', (waterTargetMl, error) => {
    expect(fehler({ waterTargetMl })).toEqual([error]);
  });

  it('nennt den Mehrbedarf bei Hitze und Sport auch im Haltemodus', () => {
    expect(berechnet({ pregnantOrBreastfeeding: true }).water.hintKey).toBe('water_need_higher_in_heat_and_sport');
  });
});

describe('Sportwochenziel', () => {
  it('schlägt 150 aktive Minuten vor', () => {
    expect(berechnet().sport).toEqual({ weeklyTargetMinutes: 150, suggestedMinutes: 150, range: { min: 30, max: 600, step: 10 } });
  });

  it('übernimmt eine Wahl in 10-Minuten-Schritten von 30 bis 600', () => {
    for (const minutes of [30, 210, 600]) {
      expect(berechnet({ weeklySportTargetMinutes: minutes }).sport.weeklyTargetMinutes).toBe(minutes);
    }
  });

  it.each([
    [20, 'sport_target_out_of_range'],
    [610, 'sport_target_out_of_range'],
    [155, 'sport_target_not_on_step'],
  ] as const)('lehnt %i Minuten ab', (weeklySportTargetMinutes, error) => {
    expect(fehler({ weeklySportTargetMinutes })).toEqual([error]);
  });
});

describe('Schwelle der Sporteinheit', () => {
  it.each([
    [0, null],
    [1, 150],
    [2, 75],
    [3, 50],
    [4, 38], // 37,5 aufgerundet
    [5, 30],
    [6, 25],
    [7, 22], // 21,43 aufgerundet; nur im Wochenplan-Editor möglich
  ])('150 Minuten auf %i Sporttage: %s Minuten', (sportDayCount, minutes) => {
    expect(sportSessionThreshold(150, sportDayCount)).toBe(minutes);
  });

  it('rundet auf ganze Minuten auf: 200 Minuten auf 3 Sporttage = 66,67 → 67', () => {
    expect(sportSessionThreshold(200, 3)).toBe(67);
  });
});
