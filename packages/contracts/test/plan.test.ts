import { describe, expect, it } from 'vitest';

import { EntityId, LocalDate } from '../src/base.ts';
import { calculateGoals, type GoalCalculation, type GoalCalculatorInput } from '../src/goal-calculator.ts';
import {
  CreateGoalVersion,
  CreateWeeklyPlanVersion,
  effectivePlanOf,
  goalVersionId,
  goalVersionKey,
  goalVersionOf,
  planVersionOfKey,
  weeklyPlanDaysOf,
  weeklyPlanVersionId,
  weeklyPlanVersionKey,
} from '../src/plan.ts';

// Nachweis für #128: Ziel- und Wochenplanversion im Vertragsmodul (Spezifikation 1, Abschnitte 4 und
// 11). Eine Zielversion ist nur gültig, wenn ihre Berechnungswerte sich über den Zielrechner aus den
// mitgelieferten Eingaben ergeben; diese Prüfung teilen App und Server.

const day = (value: string) => LocalDate.parse(value);
const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const change = EntityId.parse('4f6a8b0c-3d5e-4f7a-9b2c-4d6e8f0a2b01');

/** Referenzfall der Recherche: Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt. */
const referenz: GoalCalculatorInput = {
  calculationDate: day('2026-10-14'),
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

function berechnet(changes: Partial<GoalCalculatorInput> = {}): { input: GoalCalculatorInput; calculation: GoalCalculation } {
  const input = { ...referenz, ...changes };
  const calculation = calculateGoals(input);
  if (calculation.type !== 'berechnet') throw new Error(`Ungültig: ${calculation.errors.join(', ')}`);
  return { input, calculation };
}

function version(changes: Partial<GoalCalculatorInput> = {}) {
  const { input, calculation } = berechnet(changes);
  return goalVersionOf({ validFrom: day('2026-10-14'), input, calculation });
}

/** Fehlermeldungen der Prüfung; leer bei einer gültigen Zielversion. */
function issues(value: unknown): string[] {
  const parsed = CreateGoalVersion.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe('Zielversion aus einer Berechnung', () => {
  it('übernimmt alle Berechnungswerte vollständig, in ganzen kcal als milli_kcal', () => {
    expect(version()).toEqual({
      validFrom: '2026-10-14',
      calorieBudgetMilliKcal: 1_620_000,
      basalMetabolicRateMilliKcal: 1_514_000,
      totalEnergyExpenditureMilliKcal: 2_120_000,
      lowerBoundMilliKcal: 1_514_000,
      deficitMilliKcal: 500_000,
      budgetSource: 'berechnet',
      calculationSex: 'weiblich',
      ageYears: 35,
      heightCm: 168,
      weightG: 80_000,
      activityLevel: 'wenig_aktiv',
      maintenanceReason: null,
      pace: 'entspannt',
      goalWeightG: 76_000,
      waterTargetMl: 1_500,
      weeklySportTargetMinutes: 150,
    });
  });

  it.each([
    ['berechnet', {}],
    ['manuelles Budget an der Untergrenze', { manualBudgetKcal: 1_520 }],
    ['manuelles Budget am Gesamtumsatz', { manualBudgetKcal: 2_120 }],
    ['gewählter Haltemodus', { pace: null }],
    ['Zielgewicht nicht unter dem aktuellen Gewicht', { goalWeightG: 80_000 }],
    ['manuelles Budget im gewählten Haltemodus', { pace: null, manualBudgetKcal: 2_000 }],
    ['erzwungener Haltemodus: schwanger oder stillend', { pregnantOrBreastfeeding: true }],
    ['erzwungener Haltemodus: Essstörung', { knownEatingDisorder: true }],
    ['erzwungener Haltemodus: BMI unter 18,5', { weightG: 52_000, goalWeightG: 52_300 }],
    ['angehobenes Budget', { calculationSex: 'weiblich', heightCm: 150, weightG: 50_000, goalWeightG: 47_000, ageYears: 70, pace: 'zuegiger' }],
    ['zügiger, eigenes Wasser- und Sportziel', { pace: 'zuegiger', waterTargetMl: 2_250, weeklySportTargetMinutes: 200 }],
  ] satisfies [string, Partial<GoalCalculatorInput>][])('ist stimmig: %s', (_name, changes) => {
    expect(issues(version(changes))).toEqual([]);
  });

  it('setzt im erzwungenen Haltemodus weder Tempo noch Defizit', () => {
    expect(version({ knownEatingDisorder: true })).toMatchObject({
      maintenanceReason: 'sicherheits_check',
      pace: null,
      deficitMilliKcal: null,
      budgetSource: 'berechnet',
    });
  });
});

describe('Stimmigkeit der Zielversion', () => {
  const stimmig = version();

  it.each([
    ['Gesamtumsatz passt nicht zur Aktivitätsstufe', { totalEnergyExpenditureMilliKcal: 2_200_000 }],
    ['Grundumsatz passt nicht zu den Körperdaten', { basalMetabolicRateMilliKcal: 1_600_000 }],
    ['Untergrenze passt nicht zum Grundumsatz', { lowerBoundMilliKcal: 1_200_000 }],
    ['Defizit passt nicht zum Tempo', { deficitMilliKcal: 750_000 }],
    ['berechnetes Budget weicht ab', { calorieBudgetMilliKcal: 1_700_000 }],
    ['erzwungener Haltemodus mit dem Budget des Tempos', { maintenanceReason: 'sicherheits_check', pace: null, deficitMilliKcal: null }],
    ['Untergewicht ohne erzwungenen Haltemodus', { weightG: 52_000, goalWeightG: 52_300 }],
  ])('lehnt ab: %s', (_name, changes) => {
    expect(issues({ ...stimmig, ...changes })).not.toEqual([]);
  });

  it('lehnt ein Budget unter der Untergrenze ab, auch als manuelles Budget', () => {
    expect(issues({ ...stimmig, calorieBudgetMilliKcal: 1_400_000 })).not.toEqual([]);
    expect(issues({ ...stimmig, calorieBudgetMilliKcal: 1_400_000, budgetSource: 'manuell' })).toContain('manual_budget_out_of_range');
  });

  it('lehnt ein manuelles Budget über dem Gesamtumsatz und außerhalb des Rasters ab', () => {
    expect(issues({ ...stimmig, calorieBudgetMilliKcal: 2_130_000, budgetSource: 'manuell' })).toContain('manual_budget_out_of_range');
    expect(issues({ ...stimmig, calorieBudgetMilliKcal: 1_625_000, budgetSource: 'manuell' })).toContain('manual_budget_not_on_step');
  });

  it('lehnt ein manuelles Budget im erzwungenen Haltemodus ab', () => {
    const erzwungen = version({ knownEatingDisorder: true });
    expect(issues({ ...erzwungen, budgetSource: 'manuell' })).toContain('manual_budget_in_forced_maintenance');
  });

  it('nimmt ein Budget aus einem Budgetvorschlag zwischen Untergrenze und Gesamtumsatz an, auch außerhalb des Rasters', () => {
    expect(issues({ ...stimmig, budgetSource: 'budgetvorschlag', calorieBudgetMilliKcal: 1_514_000 })).toEqual([]);
    expect(issues({ ...stimmig, budgetSource: 'budgetvorschlag', calorieBudgetMilliKcal: 2_120_000 })).toEqual([]);
    expect(issues({ ...stimmig, budgetSource: 'budgetvorschlag', calorieBudgetMilliKcal: 2_121_000 })).not.toEqual([]);
    expect(issues({ ...stimmig, budgetSource: 'budgetvorschlag', calorieBudgetMilliKcal: 1_513_000 })).not.toEqual([]);
  });

  it.each([
    ['Größe außerhalb des Bereichs', { heightCm: 119 }, 'height_out_of_range'],
    ['Gewicht nicht im 100-g-Raster', { weightG: 80_050 }, 'weight_not_on_step'],
    ['Zielgewicht unter BMI 18,5', { goalWeightG: 52_100 }, 'goal_weight_below_lower_limit'],
    ['Wasserziel außerhalb des Rasters', { waterTargetMl: 1_600 }, 'water_target_not_on_step'],
    ['Sportwochenziel über der Grenze', { weeklySportTargetMinutes: 610 }, 'sport_target_out_of_range'],
  ])('prüft die Wertebereiche: %s', (_name, changes, error) => {
    expect(issues({ ...stimmig, ...changes })).toContain(error);
  });

  it('verlangt Alter ab 18 und ganze kcal', () => {
    expect(issues({ ...stimmig, ageYears: 17 })).not.toEqual([]);
    expect(issues({ ...stimmig, calorieBudgetMilliKcal: 1_620_500 })).not.toEqual([]);
  });

  it('kennt weder Person noch Serverfelder', () => {
    expect(issues({ ...stimmig, personId: philipp })).not.toEqual([]);
    expect(issues({ ...stimmig, serverVersion: '7' })).not.toEqual([]);
  });
});

describe('Wochenplanversion', () => {
  const days = {
    montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
    dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
    sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  } as const;

  it('hat sieben Wochentage mit je drei verschiedenen, geordneten Bausteinen', () => {
    expect(CreateWeeklyPlanVersion.safeParse({ validFrom: '2026-10-14', days }).success).toBe(true);
    expect(CreateWeeklyPlanVersion.safeParse({ validFrom: '2026-10-14', days: { ...days, montag: ['wasserziel', 'wasserziel', 'gewogen'] } }).success).toBe(false);
    const sechs = Object.fromEntries(Object.entries(days).filter(([weekday]) => weekday !== 'sonntag'));
    expect(CreateWeeklyPlanVersion.safeParse({ validFrom: '2026-10-14', days: sechs }).success).toBe(false);
    expect(CreateWeeklyPlanVersion.safeParse({ validFrom: '2026-10-14', days: { ...days, feiertag: days.montag } }).success).toBe(false);
  });
});

describe('IDs und fachliche Schlüssel', () => {
  it('leiten die ID aus Person und valid_from ab: zwei Geräte, dieselbe Fassung', () => {
    expect(goalVersionId(philipp, day('2026-10-14'))).toBe(goalVersionId(philipp, day('2026-10-14')));
    expect(goalVersionId(philipp, day('2026-10-14'))).not.toBe(goalVersionId(philipp, day('2026-10-15')));
    expect(goalVersionId(philipp, day('2026-10-14'))).not.toBe(goalVersionId(anna, day('2026-10-14')));
    expect(weeklyPlanVersionId(philipp, day('2026-10-14'))).not.toBe(goalVersionId(philipp, day('2026-10-14')));
  });

  it('tragen je Änderung einen eigenen Schlüssel, aus dem Person und valid_from hervorgehen', () => {
    const key = goalVersionKey(philipp, day('2026-10-14'), change);
    expect(planVersionOfKey('zielversion', key)).toEqual({ personId: philipp, validFrom: '2026-10-14' });
    expect(planVersionOfKey('wochenplan', key)).toBeNull();
    expect(planVersionOfKey('wochenplan', weeklyPlanVersionKey(anna, day('2026-10-15'), change))).toEqual({
      personId: anna,
      validFrom: '2026-10-15',
    });
    expect(planVersionOfKey('zielversion', 'zielversion:kein-uuid:2026-10-14:x')).toBeNull();
    expect(planVersionOfKey('zielversion', `zielversion:${philipp}:2026-13-40:${change}`)).toBeNull();
  });
});

describe('Abbildung gelesener Zeilen (PlanReader in SQLite und Postgres)', () => {
  const goal = { ...version(), id: goalVersionId(philipp, day('2026-10-14')) };
  const weeklyPlan = { id: weeklyPlanVersionId(philipp, day('2026-10-14')), validFrom: '2026-10-14' };
  const row = (weekday: string, third: string) => ({ weekday, baustein1: 'ernaehrung_erfasst', baustein2: 'wasserziel', baustein3: third });

  it('ist leer, solange Zielversion oder Wochenplanversion fehlt', () => {
    expect(effectivePlanOf(day('2026-10-14'), { goal: undefined, weeklyPlan, day: undefined })).toEqual({ type: 'leer', localDate: '2026-10-14' });
    expect(effectivePlanOf(day('2026-10-14'), { goal, weeklyPlan: undefined, day: undefined })).toEqual({ type: 'leer', localDate: '2026-10-14' });
  });

  it('liefert die Felder des Vertrags und die Bausteine des Wochentags', () => {
    expect(effectivePlanOf(day('2026-10-14'), { goal, weeklyPlan, day: row('mittwoch', 'im_kalorienbudget') })).toEqual({
      type: 'gueltig',
      localDate: '2026-10-14',
      goal: {
        id: goal.id, validFrom: '2026-10-14', calorieBudgetMilliKcal: 1_620_000, lowerBoundMilliKcal: 1_514_000, maintenanceReason: null,
        pace: 'entspannt', goalWeightG: 76_000, waterTargetMl: 1_500, weeklySportTargetMinutes: 150,
      },
      weeklyPlanDay: { weeklyPlanVersionId: weeklyPlan.id, validFrom: '2026-10-14', bausteine: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'] },
    });
  });

  it('wirft bei einem vertragswidrigen Stand statt ihn weiterzugeben', () => {
    expect(() => effectivePlanOf(day('2026-10-14'), { goal, weeklyPlan, day: undefined })).toThrow();
    expect(() => effectivePlanOf(day('2026-10-13'), { goal, weeklyPlan, day: row('dienstag', 'sporteinheit') })).toThrow();
  });

  it('prüft die Tageszeilen einer Wochenplanversion', () => {
    const weekdays = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
    expect(weeklyPlanDaysOf(weekdays.map((weekday) => row(weekday, 'gewogen')))).toMatchObject({ sonntag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] });
    expect(() => weeklyPlanDaysOf(weekdays.slice(0, 6).map((weekday) => row(weekday, 'gewogen')))).toThrow();
    expect(() => weeklyPlanDaysOf(weekdays.map((weekday) => row(weekday, 'wasserziel')))).toThrow();
  });
});
