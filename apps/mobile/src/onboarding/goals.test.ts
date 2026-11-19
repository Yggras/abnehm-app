/** @jest-environment node */
import { LocalDate } from '@abnehm/contracts/base';

import type { OnboardingDraft } from './draft';
import { calculatedBudgetOf, goalPreviewOf, keepsManualBudget } from './goals';

// Ziele im Onboarding (Spezifikation 1, Abschnitte 3 und 9) über der Vorschau des Zielrechners. Der
// Referenzfall stammt aus research/calorie-needs.md: Frau, 35 Jahre, 168 cm, 80 kg → Grundumsatz
// 1.514 kcal, Gesamtumsatz ≈ 2.120 kcal bei PAL 1,4, Budget ≈ 1.620 kcal.

const today = LocalDate.parse('2026-10-14');
const body: OnboardingDraft = { calculationSex: 'weiblich', birthDate: LocalDate.parse('1991-04-02'), heightCm: 168, weightG: 80_000 };
const answered: OnboardingDraft = { ...body, pregnantOrBreastfeeding: false, knownEatingDisorder: false };

describe('Vorschau der Schritte 5–7', () => {
  it('gibt es erst mit gültigen Körperdaten', () => {
    expect(goalPreviewOf({}, today)).toBeNull();
    expect(goalPreviewOf({ ...body, heightCm: 119 }, today)).toBeNull();
    expect(goalPreviewOf({ ...body, birthDate: LocalDate.parse('2008-10-15') }, today)).toBeNull();
  });

  it('übernimmt die Vorauswahl: niedrigste Aktivitätsstufe, Tempo „entspannt“, Zielgewicht 5 % unter dem aktuellen', () => {
    expect(goalPreviewOf(answered, today)).toMatchObject({
      type: 'berechnet',
      activityFactor: 1.4,
      pace: 'entspannt',
      maintenanceReason: null,
      basalMetabolicRate: { kcal: 1_514 },
      totalEnergyExpenditure: { kcal: 2_120 },
      deficit: { kcal: 500 },
      calorieBudget: { kcal: 1_620 },
      budgetSource: 'berechnet',
      // BMI 18,5 bei 168 cm: 52,21… kg, auf 0,1 kg aufgerundet.
      goalWeight: { goalWeightG: 76_000, preselectedG: 76_000, suggestion: { fromG: 72_000, toG: 76_000 }, range: { min: 52_300, step: 100 } },
      // 4 kg bei 0,5 kg pro Woche: 8 Wochen ab dem 14.10.2026.
      forecast: { type: 'schaetzung', year: 2026, month: 12, hintKey: 'weight_loss_slows_after_three_months' },
      water: { targetMl: 1_500, range: { min: 500, max: 5_000, step: 250 } },
      sport: { weeklyTargetMinutes: 150, range: { min: 30, max: 600, step: 10 } },
    });
  });

  it('rechnet mit den Eingaben der Schritte 5–7', () => {
    const result = goalPreviewOf(
      { ...answered, activityLevel: 'aktiv', goalWeightG: 74_500, pace: 'zuegiger', manualBudgetKcal: 2_000, waterTargetMl: 2_250, weeklySportTargetMinutes: 180 },
      today,
    );
    expect(result).toMatchObject({
      type: 'berechnet',
      activityFactor: 1.8,
      pace: 'zuegiger',
      calorieBudget: { kcal: 2_000 },
      budgetSource: 'manuell',
      goalWeight: { goalWeightG: 74_500 },
      water: { targetMl: 2_250 },
      sport: { weeklyTargetMinutes: 180 },
    });
  });

  it('ein Zielgewicht nicht unter dem aktuellen führt in den gewählten Haltemodus, ohne Tempo und Prognose', () => {
    expect(goalPreviewOf({ ...answered, goalWeightG: 80_000 }, today)).toMatchObject({
      maintenanceReason: 'gewaehlt',
      pace: null,
      deficit: null,
      forecast: null,
      calorieBudget: { kcal: 2_120 },
      hints: ['goal_weight_not_below_current'],
    });
  });

  it('der Sicherheits-Check erzwingt den Haltemodus: kein Tempo, keine Prognose, kein eigenes Budget', () => {
    expect(goalPreviewOf({ ...answered, pregnantOrBreastfeeding: true }, today)).toMatchObject({
      maintenanceReason: 'sicherheits_check',
      pace: null,
      forecast: null,
      manualBudgetRange: null,
      hints: ['maintenance_forced'],
    });
  });

  it('hebt ein Budget unter der Untergrenze an und meldet das', () => {
    // 2.119,6 − 750 = 1.369,6 kcal liegt unter dem Grundumsatz von 1.514 kcal.
    expect(goalPreviewOf({ ...answered, pace: 'zuegiger' }, today)).toMatchObject({
      calorieBudget: { kcal: 1_520 },
      budgetRaisedToLowerBound: true,
      hints: ['budget_raised_to_lower_bound'],
      manualBudgetRange: { min: 1_520, max: 2_120, step: 10 },
    });
  });
});

describe('Eigenes Budget aus Schritt 7', () => {
  const own: OnboardingDraft = { ...answered, manualBudgetKcal: 1_700 };

  it('das berechnete Budget samt Bereich lässt ein eigenes außer Acht', () => {
    expect(calculatedBudgetOf(own, today)).toEqual({ kcal: 1_620, range: { min: 1_520, max: 2_120 } });
    expect(calculatedBudgetOf({ ...own, knownEatingDisorder: true }, today)).toEqual({ kcal: 2_120, range: null });
    expect(calculatedBudgetOf({}, today)).toBeNull();
  });

  it('gilt weiter, solange Rechnung und Bereich gleich bleiben', () => {
    expect(keepsManualBudget(own, { ...own, waterTargetMl: 2_000, weeklySportTargetMinutes: 200 }, today)).toBe(true);
    expect(keepsManualBudget(own, { ...own, goalWeightG: 75_000 }, today)).toBe(true);
  });

  it('entfällt, wenn sich die Rechnung ändert', () => {
    expect(keepsManualBudget(own, { ...own, activityLevel: 'maessig_aktiv' }, today)).toBe(false);
    expect(keepsManualBudget(own, { ...own, pace: 'zuegiger' }, today)).toBe(false);
    expect(keepsManualBudget(own, { ...own, goalWeightG: 80_000 }, today)).toBe(false);
    expect(keepsManualBudget(own, { ...own, weightG: 79_000 }, today)).toBe(false);
    expect(keepsManualBudget(own, { ...own, pregnantOrBreastfeeding: true }, today)).toBe(false);
    expect(keepsManualBudget(own, { ...own, heightCm: 10 }, today)).toBe(false);
  });
});
