import {
  DailyIntakeSeries,
  EffectivePlan,
  IslandCheckInHint,
  LatestWeight,
  MaintenanceReason,
  RecordManualWeight,
  RecordManualWeightResult,
  WeightTrendSeries,
} from '../src/ports.ts';
import { fixtures } from './define.ts';
import { goalVersion, now, philipp, today, weeklyPlanVersion, weightEntry } from './ids.ts';

const goal = {
  id: goalVersion,
  validFrom: '2026-09-01',
  calorieBudgetMilliKcal: 1_620_000,
  lowerBoundMilliKcal: 1_514_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 76_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
} as const;

const plan = {
  type: 'gueltig',
  localDate: today,
  goal,
  weeklyPlanDay: {
    weeklyPlanVersionId: weeklyPlanVersion,
    validFrom: '2026-09-01',
    bausteine: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  },
} as const;

const latest = {
  lastDayWeight: { localDate: today, dayWeightG: 79_400 },
  dayWeightCount: 12,
  trend: { type: 'verfuegbar', trendG: 79_612 },
} as const;

const manualWeight = { entryId: weightEntry, personId: philipp, weightG: 79_400, measuredAt: now } as const;

export const portFixtures = {
  MaintenanceReason: fixtures(MaintenanceReason, {
    valid: { 'Sicherheits-Check': 'sicherheits_check', 'gewählt': 'gewaehlt' },
    invalid: { 'Haltemodus ohne Grund': true },
  }),
  EffectivePlan: fixtures(EffectivePlan, {
    valid: {
      'gültige Fassungen': plan,
      'Haltemodus ohne Tempo': { ...plan, goal: { ...goal, maintenanceReason: 'sicherheits_check', pace: null } },
      'noch keine Fassung': { type: 'leer', localDate: today },
    },
    invalid: {
      'Kalorien in kcal statt milli_kcal unter der Untergrenze': {
        ...plan,
        goal: { ...goal, calorieBudgetMilliKcal: 1620 },
      },
      'Haltemodus mit Tempo': { ...plan, goal: { ...goal, maintenanceReason: 'gewaehlt' } },
      'zweimal derselbe Baustein': {
        ...plan,
        weeklyPlanDay: { ...plan.weeklyPlanDay, bausteine: ['wasserziel', 'wasserziel', 'gewogen'] },
      },
      'vier Bausteine': {
        ...plan,
        weeklyPlanDay: { ...plan.weeklyPlanDay, bausteine: ['wasserziel', 'gewogen', 'sporteinheit', 'ernaehrung_erfasst'] },
      },
      'Fassung gilt erst morgen': { ...plan, goal: { ...goal, validFrom: '2026-10-15' } },
      'Wasserziel in Litern': { ...plan, goal: { ...goal, waterTargetMl: 1.5 } },
    },
  }),
  WeightTrendSeries: fixtures(WeightTrendSeries, {
    valid: {
      'leer': [],
      'zwei Tage': [
        { localDate: '2026-10-12', dayWeightG: 79_800, trendG: 79_800 },
        { localDate: today, dayWeightG: 79_400, trendG: 79_724 },
      ],
    },
    invalid: {
      'absteigend': [
        { localDate: today, dayWeightG: 79_400, trendG: 79_724 },
        { localDate: '2026-10-12', dayWeightG: 79_800, trendG: 79_800 },
      ],
      'Gewicht in kg': [{ localDate: today, dayWeightG: 79.4, trendG: 79.7 }],
    },
  }),
  LatestWeight: fixtures(LatestWeight, {
    valid: {
      'mit Trend': latest,
      'zwei Tagesgewichte': { ...latest, dayWeightCount: 2, trend: { type: 'noch_nicht_verfuegbar' } },
      'noch nie gewogen': { lastDayWeight: null, dayWeightCount: 0, trend: { type: 'noch_nicht_verfuegbar' } },
    },
    invalid: {
      'Trend unter drei Tagesgewichten': { ...latest, dayWeightCount: 2 },
      'ohne letztes Tagesgewicht trotz Einträgen': { ...latest, lastDayWeight: null },
    },
  }),
  DailyIntakeSeries: fixtures(DailyIntakeSeries, {
    valid: {
      'zwei Tage, einer ohne Einträge': [
        { localDate: '2026-10-13', intakeMilliKcal: 0, recordedMealCategories: 0 },
        { localDate: today, intakeMilliKcal: 1_204_500, recordedMealCategories: 2 },
      ],
    },
    invalid: {
      'Lücke': [
        { localDate: '2026-10-12', intakeMilliKcal: 1_800_000, recordedMealCategories: 4 },
        { localDate: today, intakeMilliKcal: 1_204_500, recordedMealCategories: 2 },
      ],
      'fünf Mahlzeiten': [{ localDate: today, intakeMilliKcal: 1_204_500, recordedMealCategories: 5 }],
    },
  }),
  RecordManualWeight: fixtures(RecordManualWeight, {
    valid: { 'Startgewicht': manualWeight },
    invalid: {
      'nicht in 100-g-Schritten': { ...manualWeight, weightG: 79_450 },
      'unter 20 kg': { ...manualWeight, weightG: 19_900 },
      'mit lokalem Tag statt Zeitpunkt': { ...manualWeight, measuredAt: today },
    },
  }),
  RecordManualWeightResult: fixtures(RecordManualWeightResult, {
    valid: {
      'gespeichert': { type: 'recorded', entryId: weightEntry, localDate: today },
      'abgelehnt': { type: 'contract_error', error: { code: 'invalid_payload', retryable: false } },
    },
    invalid: { 'ohne type': { entryId: weightEntry, localDate: today } },
  }),
  IslandCheckInHint: fixtures(IslandCheckInHint, {
    valid: { 'kein Hinweis': null, 'Besuch': { type: 'neues_insel_ereignis', eventKind: 'besuch' } },
    invalid: { 'unbekannte Art': { type: 'neues_insel_ereignis', eventKind: 'levelaufstieg' } },
  }),
};
