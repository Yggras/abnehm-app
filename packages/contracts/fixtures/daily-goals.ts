import {
  BausteinEvaluation,
  CheckInEvaluation,
  CheckInMoment,
  CheckInReason,
  DailyGoalCause,
  DailyGoalCompletion,
  DailyGoalEvaluated,
  DailyGoalEvaluation,
  DailyGoalProgress,
  DailyGoalSlot,
  DailyGoalSnapshot,
  DailyGoalState,
} from '../src/daily-goals.ts';
import { fixtures } from './define.ts';
import { now, philipp, timeZone, today, todayEndsAt } from './ids.ts';

const snapshotBase = { personId: philipp, localDate: today, slot: 1, timeZone, dayEndsAt: todayEndsAt } as const;

const waterHalf = {
  currentState: 'teilweise',
  dayClosed: false,
  progress: { type: 'wasserziel', countedMl: 750, targetMl: 1500 },
  messageKey: 'tagesziel.wasserziel.teilweise',
  values: { countedMl: 750, targetMl: 1500 },
} as const;

const budgetPending = {
  currentState: 'tagesende',
  dayClosed: false,
  progress: { type: 'im_kalorienbudget', intakeKcal: 1200, budgetKcal: 1620, lowerBoundKcal: 1514 },
  messageKey: 'tagesziel.im_kalorienbudget.tagesende',
  values: {},
} as const;

const budgetMissed = {
  ...budgetPending,
  currentState: 'offen',
  dayClosed: true,
  progress: { ...budgetPending.progress, intakeKcal: 1700 },
  messageKey: 'tagesziel.im_kalorienbudget.offen',
} as const;

const weighed = {
  currentState: 'erfuellt',
  dayClosed: false,
  progress: { type: 'gewogen', weightEntryCount: 1 },
  messageKey: 'tagesziel.gewogen.erfuellt',
  values: {},
} as const;

const recorded = { type: 'festgehalten', firstCompletedAt: now } as const;

export const dailyGoalFixtures = {
  DailyGoalSlot: fixtures(DailyGoalSlot, {
    valid: { 'Platz 1': 1, 'Platz 3': 3 },
    invalid: { 'Platz 0': 0, 'Platz 4': 4, 'als Text': '1' },
  }),
  DailyGoalSnapshot: fixtures(DailyGoalSnapshot, {
    valid: {
      'Ernährung erfasst': { type: 'ernaehrung_erfasst', ...snapshotBase, minimumMealCategories: 2 },
      'Im Kalorienbudget': { type: 'im_kalorienbudget', ...snapshotBase, slot: 3, budgetKcal: 1620, lowerBoundKcal: 1514 },
      'Wasserziel': { type: 'wasserziel', ...snapshotBase, slot: 2, targetMl: 1500 },
      'Sporteinheit': { type: 'sporteinheit', ...snapshotBase, slot: 3, minimumSingleSessionMinutes: 50 },
      'Gewogen': { type: 'gewogen', ...snapshotBase, slot: 3 },
    },
    invalid: {
      'Budget unter der Untergrenze': { type: 'im_kalorienbudget', ...snapshotBase, budgetKcal: 1400, lowerBoundKcal: 1514 },
      'Schwelle eines anderen Bausteins': { type: 'gewogen', ...snapshotBase, targetMl: 1500 },
      'ohne Tagesende': { type: 'wasserziel', personId: philipp, localDate: today, slot: 2, timeZone, targetMl: 1500 },
      'Kalorien als Bruchteil': {
        type: 'im_kalorienbudget',
        ...snapshotBase,
        budgetKcal: 1620.5,
        lowerBoundKcal: 1514,
      },
    },
  }),
  DailyGoalState: fixtures(DailyGoalState, {
    valid: { 'offen': 'offen', 'Tagesende': 'tagesende' },
    invalid: { 'verfehlt': 'verfehlt' },
  }),
  DailyGoalProgress: fixtures(DailyGoalProgress, {
    valid: {
      'Ernährung': { type: 'ernaehrung_erfasst', recordedMealCategories: 1, minimumMealCategories: 2 },
      'Wasser': waterHalf.progress,
      'Sport': { type: 'sporteinheit', longestSessionMinutes: 45, minimumSingleSessionMinutes: 50 },
    },
    invalid: {
      'fünf Mahlzeitenkategorien': { type: 'ernaehrung_erfasst', recordedMealCategories: 5, minimumMealCategories: 2 },
      'negative Menge': { type: 'wasserziel', countedMl: -250, targetMl: 1500 },
    },
  }),
  BausteinEvaluation: fixtures(BausteinEvaluation, {
    valid: { 'Wasser teilweise': waterHalf, 'Kalorienbudget vor Tagesende': budgetPending, 'Gewogen': weighed },
    invalid: {
      'Gewicht teilweise': { ...weighed, currentState: 'teilweise' },
      'Kalorienbudget vor Tagesende erfüllt': { ...budgetPending, currentState: 'erfuellt' },
      'Kalorienbudget nach Tagesende über Budget erfüllt': { ...budgetMissed, currentState: 'erfuellt' },
      'Wasser ab Ziel nur teilweise': {
        ...waterHalf,
        progress: { type: 'wasserziel', countedMl: 1500, targetMl: 1500 },
      },
      'mit Erfüllung': { ...weighed, completion: recorded },
    },
  }),
  DailyGoalCompletion: fixtures(DailyGoalCompletion, {
    valid: { 'nie': { type: 'nie' }, 'festgehalten': recorded },
    invalid: { 'festgehalten ohne Zeitpunkt': { type: 'festgehalten' } },
  }),
  DailyGoalEvaluated: fixtures(DailyGoalEvaluated, {
    valid: {
      'erstmals erfüllt': { type: 'evaluated', ...weighed, completion: recorded },
      'nach Korrektur offen, bereits gutgeschrieben': {
        type: 'evaluated',
        ...waterHalf,
        currentState: 'offen',
        progress: { type: 'wasserziel', countedMl: 0, targetMl: 1500 },
        completion: recorded,
      },
      'Kalorienbudget nach Tagesende verfehlt': { type: 'evaluated', ...budgetMissed, completion: { type: 'nie' } },
    },
    invalid: {
      'Kalorienbudget vor Tagesende festgehalten': { type: 'evaluated', ...budgetPending, completion: recorded },
      'ohne Erfüllung': { type: 'evaluated', ...weighed },
    },
  }),
  DailyGoalEvaluation: fixtures(DailyGoalEvaluation, {
    valid: {
      'ausgewertet': { type: 'evaluated', ...waterHalf, completion: { type: 'nie' } },
      'Vertragsfehler': { type: 'contract_error', error: { code: 'invalid_snapshot', retryable: false } },
    },
    invalid: {
      'Fehler ohne Code': { type: 'contract_error', error: { retryable: false } },
      'ohne type': { ...waterHalf, completion: { type: 'nie' } },
    },
  }),
  DailyGoalCause: fixtures(DailyGoalCause, {
    valid: { 'Eingabe': 'eingabe', 'Planänderung': 'planaenderung' },
    invalid: { 'Hintergrund-Sync': 'background_sync' },
  }),
  CheckInMoment: fixtures(CheckInMoment, {
    valid: { 'mittags': 'mittag', 'abends': 'abend' },
    invalid: { 'morgens': 'morgen' },
  }),
  CheckInReason: fixtures(CheckInReason, {
    valid: {
      'Ernährung': { type: 'ernaehrung', recordedMealCategories: 0 },
      'Gewicht ohne Werte': { type: 'gewicht', weighDay: true, hasCountingEntry: false },
      'Sport mit weichem Textschlüssel': {
        type: 'sport',
        sportDay: true,
        hasCountingEntry: false,
        messageKey: 'checkin.sport.schon_trainiert',
      },
    },
    invalid: {
      'Gewichtswert im Grund': { type: 'gewicht', weighDay: true, hasCountingEntry: true, weightG: 80_000 },
      'Kalorienbudget als Tracker': { type: 'kalorienbudget', intakeKcal: 1200 },
      'Sport ohne weichen Textschlüssel': { type: 'sport', sportDay: true, hasCountingEntry: false },
    },
  }),
  CheckInEvaluation: fixtures(CheckInEvaluation, {
    valid: {
      'Ernährung mittags ohne Mahlzeit': {
        tracker: 'ernaehrung',
        moment: 'mittag',
        behind: true,
        reason: { type: 'ernaehrung', recordedMealCategories: 0 },
      },
      'Ernährung abends mit zwei Mahlzeiten': {
        tracker: 'ernaehrung',
        moment: 'abend',
        behind: false,
        reason: { type: 'ernaehrung', recordedMealCategories: 2 },
      },
      'Wasser mittags genau ein Drittel': {
        tracker: 'wasser',
        moment: 'mittag',
        behind: false,
        reason: { type: 'wasser', countedMl: 500, targetMl: 1500 },
      },
      'Wasser abends knapp unter zwei Dritteln': {
        tracker: 'wasser',
        moment: 'abend',
        behind: true,
        reason: { type: 'wasser', countedMl: 999, targetMl: 1500 },
      },
      'Sport mittags nie': {
        tracker: 'sport',
        moment: 'mittag',
        behind: false,
        reason: { type: 'sport', sportDay: true, hasCountingEntry: false, messageKey: 'checkin.sport.schon_trainiert' },
      },
      'Gewicht am Wiegetag ohne Eintrag': {
        tracker: 'gewicht',
        moment: 'abend',
        behind: true,
        reason: { type: 'gewicht', weighDay: true, hasCountingEntry: false },
      },
    },
    invalid: {
      'Sport mittags hinterher': {
        tracker: 'sport',
        moment: 'mittag',
        behind: true,
        reason: { type: 'sport', sportDay: true, hasCountingEntry: false, messageKey: 'checkin.sport.schon_trainiert' },
      },
      'Gewicht ohne Wiegetag hinterher': {
        tracker: 'gewicht',
        moment: 'mittag',
        behind: true,
        reason: { type: 'gewicht', weighDay: false, hasCountingEntry: false },
      },
      'Grund eines anderen Trackers': {
        tracker: 'wasser',
        moment: 'abend',
        behind: false,
        reason: { type: 'ernaehrung', recordedMealCategories: 2 },
      },
      'Ernährung abends mit einer Mahlzeit nicht hinterher': {
        tracker: 'ernaehrung',
        moment: 'abend',
        behind: false,
        reason: { type: 'ernaehrung', recordedMealCategories: 1 },
      },
    },
  }),
};
