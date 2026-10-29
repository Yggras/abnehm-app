import { BudgetSource, CreateGoalVersion, CreateWeeklyPlanVersion, GoalVersionRecord, WeeklyPlanDays, WeeklyPlanVersionRecord } from '../src/plan.ts';
import { fixtures, without } from './define.ts';
import { now, philipp, today } from './ids.ts';

/** Referenzfall der Recherche (research/calorie-needs.md): Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt; auch für Server-Tests. */
export const referenceGoalVersion = {
  validFrom: today,
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
} as const;

/** Derselbe Fall im erzwungenen Haltemodus: Budget = Gesamtumsatz, ohne Tempo und Defizit. */
const forced = { ...referenceGoalVersion, calorieBudgetMilliKcal: 2_120_000, deficitMilliKcal: null, maintenanceReason: 'sicherheits_check', pace: null } as const;

/** Standard-Wochenplan aus dem Onboarding: Sporttage Di/Do/Sa, Wiegetag Montag. */
export const standardWeekDays = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
} as const;

const stored = { personId: philipp, createdAt: now, updatedAt: now } as const;

export const planFixtures = {
  BudgetSource: fixtures(BudgetSource, {
    valid: { 'berechnet': 'berechnet', 'manuell': 'manuell', 'aus Budgetvorschlag': 'budgetvorschlag' },
    invalid: { 'geschätzt': 'geschaetzt' },
  }),
  CreateGoalVersion: fixtures(CreateGoalVersion, {
    valid: {
      'Referenzfall, berechnet': referenceGoalVersion,
      'manuelles Budget': { ...referenceGoalVersion, calorieBudgetMilliKcal: 1_800_000, budgetSource: 'manuell' },
      'erzwungener Haltemodus': forced,
      'Budgetvorschlag außerhalb des Rasters': { ...referenceGoalVersion, calorieBudgetMilliKcal: 1_765_000, budgetSource: 'budgetvorschlag' },
    },
    invalid: {
      'Gesamtumsatz passt nicht zur Aktivitätsstufe': { ...referenceGoalVersion, totalEnergyExpenditureMilliKcal: 2_423_000 },
      'Budget unter der Untergrenze': { ...referenceGoalVersion, calorieBudgetMilliKcal: 1_200_000, budgetSource: 'manuell' },
      'manuelles Budget im erzwungenen Haltemodus': { ...forced, budgetSource: 'manuell' },
      'Bruchteil einer kcal': { ...referenceGoalVersion, calorieBudgetMilliKcal: 1_619_600 },
      'mit Eigentümer': { ...referenceGoalVersion, personId: philipp },
      'ohne Sportwochenziel': without(referenceGoalVersion, 'weeklySportTargetMinutes'),
    },
  }),
  GoalVersionRecord: fixtures(GoalVersionRecord, {
    valid: { 'kanonisch': { ...referenceGoalVersion, ...stored }, 'Haltemodus': { ...forced, ...stored } },
    invalid: {
      'ohne Eigentümer': { ...referenceGoalVersion, createdAt: now, updatedAt: now },
      'Tempo im Haltemodus': { ...forced, ...stored, pace: 'entspannt' },
      'Budget unter der Untergrenze': { ...referenceGoalVersion, ...stored, calorieBudgetMilliKcal: 1_400_000 },
    },
  }),
  WeeklyPlanDays: fixtures(WeeklyPlanDays, {
    valid: { 'Standard-Wochenplan': standardWeekDays, 'zweimal wiegen ohne Sport': { ...standardWeekDays, dienstag: ['ernaehrung_erfasst', 'gewogen', 'im_kalorienbudget'] } },
    invalid: {
      'doppelter Baustein': { ...standardWeekDays, montag: ['wasserziel', 'wasserziel', 'gewogen'] },
      'nur sechs Tage': without(standardWeekDays, 'sonntag'),
      'vier Plätze': { ...standardWeekDays, montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen', 'sporteinheit'] },
    },
  }),
  CreateWeeklyPlanVersion: fixtures(CreateWeeklyPlanVersion, {
    valid: { 'ab heute': { validFrom: today, days: standardWeekDays } },
    invalid: { 'ohne Tage': { validFrom: today }, 'mit Eigentümer': { validFrom: today, days: standardWeekDays, personId: philipp } },
  }),
  WeeklyPlanVersionRecord: fixtures(WeeklyPlanVersionRecord, {
    valid: { 'kanonisch': { validFrom: today, days: standardWeekDays, ...stored } },
    invalid: { 'ohne Eigentümer': { validFrom: today, days: standardWeekDays, createdAt: now, updatedAt: now } },
  }),
};
