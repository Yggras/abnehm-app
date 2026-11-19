import { EntityId, LocalDate } from '../src/base.ts';
import { dailyGoalId } from '../src/daily-goals.ts';
import {
  BudgetSource,
  BudgetSuggestionDirection,
  BudgetSuggestionRecord,
  BudgetSuggestionStatus,
  BudgetSuggestionUpsert,
  CreateGoalVersion,
  CreateWeeklyPlanVersion,
  GoalVersionRecord,
  MaterializeDailyGoals,
  WeeklyPlanDays,
  WeeklyPlanVersionRecord,
} from '../src/plan.ts';
import { fixtures, without } from './define.ts';
import { anna, now, philipp, timeZone, today, todayEndsAt } from './ids.ts';

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

/** Budgetvorschlag zum Referenzfall: 21 Tage bis gestern, 150 kcal weniger. */
const budgetSuggestion = {
  periodFrom: '2026-09-23',
  periodTo: '2026-10-13',
  previousBudgetMilliKcal: 1_620_000,
  suggestedBudgetMilliKcal: 1_520_000,
  direction: 'senken',
  status: 'offen',
} as const;

const goalIdOf = (slot: 1 | 2 | 3) => dailyGoalId(EntityId.parse(philipp), LocalDate.parse(today), slot);
const snapshotBase = { personId: philipp, localDate: today, timeZone, dayEndsAt: todayEndsAt } as const;

/** Mittwoch im Standard-Wochenplan mit dem Referenzfall: Ernährung erfasst, Wasserziel, Im Kalorienbudget. */
const wednesdayGoals = [
  { id: goalIdOf(1), snapshot: { type: 'ernaehrung_erfasst', ...snapshotBase, slot: 1, minimumMealCategories: 2 } },
  { id: goalIdOf(2), snapshot: { type: 'wasserziel', ...snapshotBase, slot: 2, targetMl: 1_500 } },
  { id: goalIdOf(3), snapshot: { type: 'im_kalorienbudget', ...snapshotBase, slot: 3, budgetKcal: 1_620, lowerBoundKcal: 1_514 } },
] as const;

export const planFixtures = {
  BudgetSource: fixtures(BudgetSource, {
    valid: { 'berechnet': 'berechnet', 'manuell': 'manuell', 'aus Budgetvorschlag': 'budgetvorschlag' },
    invalid: { 'geschätzt': 'geschaetzt' },
  }),
  BudgetSuggestionDirection: fixtures(BudgetSuggestionDirection, {
    valid: { 'senken': 'senken', 'anheben': 'anheben' },
    invalid: { 'halten': 'halten' },
  }),
  BudgetSuggestionStatus: fixtures(BudgetSuggestionStatus, {
    valid: { 'offen': 'offen', 'angenommen': 'angenommen', 'abgelehnt': 'abgelehnt', 'überholt': 'ueberholt' },
    invalid: { 'Umlaut': 'überholt' },
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
  BudgetSuggestionUpsert: fixtures(BudgetSuggestionUpsert, {
    valid: {
      'offen, senken': budgetSuggestion,
      'abgelehnt, anheben': { ...budgetSuggestion, suggestedBudgetMilliKcal: 1_770_000, direction: 'anheben', status: 'abgelehnt' },
      'bis zur Untergrenze gesenkt': { ...budgetSuggestion, suggestedBudgetMilliKcal: 1_514_000 },
    },
    invalid: {
      'Richtung passt nicht zum Betrag': { ...budgetSuggestion, direction: 'anheben' },
      'unverändertes Budget': { ...budgetSuggestion, suggestedBudgetMilliKcal: 1_620_000 },
      'Zeitraum rückwärts': { ...budgetSuggestion, periodFrom: today, periodTo: '2026-09-23' },
      'unbekannter Status': { ...budgetSuggestion, status: 'erledigt' },
      'mit Eigentümer': { ...budgetSuggestion, personId: philipp },
    },
  }),
  BudgetSuggestionRecord: fixtures(BudgetSuggestionRecord, {
    valid: { 'kanonisch': { ...budgetSuggestion, ...stored }, 'angenommen': { ...budgetSuggestion, ...stored, status: 'angenommen' } },
    invalid: {
      'ohne Eigentümer': { ...budgetSuggestion, createdAt: now, updatedAt: now },
      'Richtung passt nicht zum Betrag': { ...budgetSuggestion, ...stored, direction: 'anheben' },
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
  MaterializeDailyGoals: fixtures(MaterializeDailyGoals, {
    valid: { 'drei Tagesziele eines Tags': { localDate: today, goals: wednesdayGoals } },
    invalid: {
      'nur zwei Tagesziele': { localDate: today, goals: wednesdayGoals.slice(0, 2) },
      'Plätze vertauscht': { localDate: today, goals: [wednesdayGoals[1], wednesdayGoals[0], wednesdayGoals[2]] },
      'Snapshot eines anderen Tags': { localDate: '2026-10-15', goals: wednesdayGoals },
      'zufällige ID': { localDate: today, goals: [{ ...wednesdayGoals[0], id: philipp }, wednesdayGoals[1], wednesdayGoals[2]] },
      'zwei Personen': {
        localDate: today,
        goals: [wednesdayGoals[0], wednesdayGoals[1], { ...wednesdayGoals[2], snapshot: { ...wednesdayGoals[2].snapshot, personId: anna } }],
      },
      'Baustein doppelt': {
        localDate: today,
        goals: [wednesdayGoals[0], wednesdayGoals[1], { id: goalIdOf(3), snapshot: { ...wednesdayGoals[1].snapshot, slot: 3 } }],
      },
    },
  }),
  WeeklyPlanVersionRecord: fixtures(WeeklyPlanVersionRecord, {
    valid: { 'kanonisch': { validFrom: today, days: standardWeekDays, ...stored } },
    invalid: { 'ohne Eigentümer': { validFrom: today, days: standardWeekDays, createdAt: now, updatedAt: now } },
  }),
};
