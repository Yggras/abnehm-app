import {
  BausteinEvaluation,
  CheckInEvaluation,
  CheckInMoment,
  CheckInReason,
  DailyGoalCause,
  DailyGoalCompletion,
  DailyGoalCompletionRecord,
  DailyGoalEvaluated,
  DailyGoalEvaluation,
  DailyGoalProgress,
  DailyGoalSlot,
  DailyGoalSnapshot,
  DailyGoalState,
} from '../src/daily-goals.ts';
import { fixtures } from './define.ts';
import { completion, now, philipp, timeZone, today, todayEndsAt, weeklyPlanVersion } from './ids.ts';

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

const waterReached = {
  ...waterHalf,
  currentState: 'erfuellt',
  progress: { type: 'wasserziel', countedMl: 1500, targetMl: 1500 },
  messageKey: 'tagesziel.wasserziel.erfuellt',
  values: { countedMl: 1500, targetMl: 1500 },
} as const;

const sportShort = {
  currentState: 'teilweise',
  dayClosed: false,
  progress: { type: 'sporteinheit', longestSessionMinutes: 19, minimumSingleSessionMinutes: 20 },
  messageKey: 'tagesziel.sporteinheit.teilweise',
  values: { longestSessionMinutes: 19, minimumSingleSessionMinutes: 20 },
} as const;

const sportDone = {
  ...sportShort,
  currentState: 'erfuellt',
  progress: { type: 'sporteinheit', longestSessionMinutes: 20, minimumSingleSessionMinutes: 20 },
  messageKey: 'tagesziel.sporteinheit.erfuellt',
  values: { longestSessionMinutes: 20, minimumSingleSessionMinutes: 20 },
} as const;

const notWeighed = {
  ...weighed,
  currentState: 'offen',
  progress: { type: 'gewogen', weightEntryCount: 0 },
  messageKey: 'tagesziel.gewogen.offen',
} as const;

const recorded = { type: 'festgehalten', firstCompletedAt: now } as const;

const completionRecord = {
  id: completion,
  // Irgendeine UUID; das Tagesziel selbst liefert Spezifikation 1.
  dailyGoalId: weeklyPlanVersion,
  personId: philipp,
  localDate: today,
  slot: 2,
  baustein: 'wasserziel',
  firstCompletedAt: now,
  completionKey: `tagesziel:${philipp}:${today}:2`,
  createdAt: now,
} as const;

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
    valid: {
      'Wasser teilweise': waterHalf,
      'Wasser genau auf dem Ziel erfüllt': waterReached,
      'Kalorienbudget vor Tagesende': budgetPending,
      'Sport: längste Einheit eine Minute unter der Mindestdauer': sportShort,
      'Sport: längste Einheit genau auf der Mindestdauer': sportDone,
      'Gewogen': weighed,
      'Gewogen ohne Eintrag offen': notWeighed,
    },
    invalid: {
      'Wasser ohne Menge teilweise': { ...waterHalf, progress: { type: 'wasserziel', countedMl: 0, targetMl: 1500 } },
      'Sport unter der Mindestdauer erfüllt': { ...sportShort, currentState: 'erfuellt' },
      'Sport ohne Einheit teilweise': { ...sportShort, progress: { ...sportShort.progress, longestSessionMinutes: 0 } },
      'Sport in Bruchteilen von Minuten': { ...sportDone, progress: { ...sportDone.progress, longestSessionMinutes: 20.5 } },
      'Gewogen ohne Eintrag erfüllt': { ...notWeighed, currentState: 'erfuellt' },
      'Gewogen mit Gewichtswert': { ...weighed, progress: { type: 'gewogen', weightEntryCount: 1, weightG: 81_400 } },
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
  DailyGoalCompletionRecord: fixtures(DailyGoalCompletionRecord, {
    valid: { 'Wasserziel auf Platz 2': completionRecord },
    invalid: {
      'Schlüssel eines anderen Platzes': { ...completionRecord, completionKey: `tagesziel:${philipp}:${today}:1` },
      'Platz 4': { ...completionRecord, slot: 4, completionKey: `tagesziel:${philipp}:${today}:4` },
      'unbekannter Baustein': { ...completionRecord, baustein: 'schritte' },
    },
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
      'Sport nach Löschen der Einheit offen, bereits gutgeschrieben': {
        type: 'evaluated',
        ...sportShort,
        currentState: 'offen',
        progress: { ...sportShort.progress, longestSessionMinutes: 0 },
        completion: recorded,
      },
      'Gewogen nach Ausblenden des Imports offen, bereits gutgeschrieben': { type: 'evaluated', ...notWeighed, completion: recorded },
      'Wasser erstmals erfüllt': { type: 'evaluated', ...waterReached, completion: recorded },
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
      'Wasser mittags knapp unter einem Drittel': {
        tracker: 'wasser',
        moment: 'mittag',
        behind: true,
        reason: { type: 'wasser', countedMl: 499, targetMl: 1500 },
      },
      'Wasser abends genau zwei Drittel': {
        tracker: 'wasser',
        moment: 'abend',
        behind: false,
        reason: { type: 'wasser', countedMl: 1000, targetMl: 1500 },
      },
      'Sport abends am Sporttag ohne Eintrag': {
        tracker: 'sport',
        moment: 'abend',
        behind: true,
        reason: { type: 'sport', sportDay: true, hasCountingEntry: false, messageKey: 'checkin.sport.schon_trainiert' },
      },
      'Sport abends ohne Sporttag': {
        tracker: 'sport',
        moment: 'abend',
        behind: false,
        reason: { type: 'sport', sportDay: false, hasCountingEntry: false, messageKey: 'checkin.sport.schon_trainiert' },
      },
      'Gewicht mittags am Wiegetag mit Eintrag': {
        tracker: 'gewicht',
        moment: 'mittag',
        behind: false,
        reason: { type: 'gewicht', weighDay: true, hasCountingEntry: true },
      },
      'Gewicht ohne Wiegetag': {
        tracker: 'gewicht',
        moment: 'abend',
        behind: false,
        reason: { type: 'gewicht', weighDay: false, hasCountingEntry: false },
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
      'Wasser mittags genau ein Drittel hinterher': {
        tracker: 'wasser',
        moment: 'mittag',
        behind: true,
        reason: { type: 'wasser', countedMl: 500, targetMl: 1500 },
      },
      'Wasser ohne Wasserziel': { tracker: 'wasser', moment: 'abend', behind: true, reason: { type: 'wasser', countedMl: 0 } },
      'Sport abends am Sporttag ohne Eintrag nicht hinterher': {
        tracker: 'sport',
        moment: 'abend',
        behind: false,
        reason: { type: 'sport', sportDay: true, hasCountingEntry: false, messageKey: 'checkin.sport.schon_trainiert' },
      },
      'Gewicht am Wiegetag mit Eintrag hinterher': {
        tracker: 'gewicht',
        moment: 'abend',
        behind: true,
        reason: { type: 'gewicht', weighDay: true, hasCountingEntry: true },
      },
      'Gewichtswert im Grund des Check-ins': {
        tracker: 'gewicht',
        moment: 'mittag',
        behind: false,
        reason: { type: 'gewicht', weighDay: true, hasCountingEntry: true, weightG: 81_400 },
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
