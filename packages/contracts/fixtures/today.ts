import {
  HeaderReady,
  MomoCharacterEmptyReason,
  MomoCharacterReady,
  MomoCharacterState,
  MomoDailyGoalsReady,
  NutritionBudgetReady,
  NutritionLogReady,
  PartnerCardReady,
  QuickCommandKey,
  QuickCommandOutcome,
  TopNoticeReady,
  TrackerEmptyReason,
  TrackerQuickAction,
  TrackerSportReady,
  TrackerWaterReady,
  TrackerWeightReady,
  WaterQuickAddParams,
} from '../src/today.ts';
import { fixtures, without } from './define.ts';
import { goalVersion, now, suggestion, today } from './ids.ts';

const action = <const T extends object>(actionId: string, target: T) => ({ actionId, target });

const character = {
  appearance: { stage: 'geschluepft', formKey: 'huepfer', moodKey: 'zufrieden', accessories: { kopf: null, hals: null } },
  energy: 4,
  level: 6,
  ownHalfPercent: 100,
  partnerHalfPercent: 43,
  waitingForPartner: true,
  partnerDisplayName: 'Anna',
  islandNotice: { newEvents: 1, claimableWishes: 0 },
} as const;

const goalCard = (slot: 1 | 2 | 3) => ({
  slot,
  evaluation: {
    type: 'evaluated',
    currentState: 'teilweise',
    dayClosed: false,
    progress: { type: 'wasserziel', countedMl: 750, targetMl: 1500 },
    messageKey: 'tagesziel.wasserziel.teilweise',
    values: { countedMl: 750, targetMl: 1500 },
    completion: { type: 'nie' },
  },
  action: action('tagesziel.open_area', { type: 'capture.water' }),
}) as const;

const water = {
  key: 'wasser',
  countedMl: 750,
  targetMl: 1500,
  status: 'teil',
  detailAction: action('tracker.water.open', { type: 'capture.water' }),
  quickAction: { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } },
} as const;

const sport = {
  key: 'sport',
  weekMinutes: 165,
  weeklyTargetMinutes: 150,
  status: 'ueber_ziel',
  detailAction: action('tracker.sport.open', { type: 'capture.sport' }),
  quickAction: { type: 'navigate', intent: action('tracker.sport.add', { type: 'capture.sport', newEntry: true }) },
} as const;

const weight = {
  key: 'gewicht',
  value: { type: 'trend', weightG: 79_600 },
  status: { type: 'kein_wiegetag', nextWeighDay: '2026-10-19' },
  detailAction: action('tracker.weight.open', { type: 'capture.weight' }),
  quickAction: { type: 'navigate', intent: action('tracker.weight.add', { type: 'capture.weight', newEntry: true }) },
} as const;

const budget = {
  budgetKcal: 1620,
  maintenanceReason: null,
  notice: {
    type: 'budget_suggestion',
    suggestionId: suggestion,
    suggestedBudgetKcal: 1470,
    action: action('plan.open_budget_suggestion', { type: 'plan.budget_suggestion', suggestionId: suggestion }),
  },
} as const;

export const todayFixtures = {
  HeaderReady: fixtures(HeaderReady, {
    valid: {
      'Mittwoch': {
        displayName: 'Philipp',
        localDate: today,
        weekday: 'mittwoch',
        settingsAction: action('header.open_settings', { type: 'settings' }),
      },
    },
    invalid: {
      'falscher Wochentag': {
        displayName: 'Philipp',
        localDate: today,
        weekday: 'montag',
        settingsAction: action('header.open_settings', { type: 'settings' }),
      },
      'Aktion zu einer anderen Route': {
        displayName: 'Philipp',
        localDate: today,
        weekday: 'mittwoch',
        settingsAction: action('header.open_settings', { type: 'today' }),
      },
    },
  }),
  TopNoticeReady: fixtures(TopNoticeReady, {
    valid: {
      'Anfeuerung': {
        senderDisplayName: 'Anna',
        encouragementKey: 'stark_heute',
        action: action('top_notice.open', { type: 'partner', focus: 'received_encouragement' }),
      },
    },
    invalid: {
      'Aktion ohne Fokus auf die Anfeuerung': {
        senderDisplayName: 'Anna',
        encouragementKey: 'stark_heute',
        action: action('top_notice.open', { type: 'partner' }),
      },
      'Freitext': {
        senderDisplayName: 'Anna',
        message: 'Stark heute! 🎉',
        action: action('top_notice.open', { type: 'partner' }),
      },
    },
  }),
  MomoCharacterReady: fixtures(MomoCharacterReady, {
    valid: { 'wartet auf den Partner': character, 'ohne Inselhinweis': { ...without(character, 'islandNotice'), waitingForPartner: false } },
    invalid: {
      'negative Energie': { ...character, energy: -2 },
      'wartet mit halber Hälfte': { ...character, ownHalfPercent: 50 },
      'Energie des Partners': { ...character, partnerEnergy: 12 },
      'ohne Partnername': without(character, 'partnerDisplayName'),
    },
  }),
  MomoCharacterEmptyReason: fixtures(MomoCharacterEmptyReason, {
    valid: {
      'ohne Kopplung': 'momo_wartet_im_ei',
      'vor der Rollenwahl': 'rollenwahl_offen',
      'eigener Vorschlag gesendet': 'rollenwahl_gesendet',
    },
    invalid: { 'beliebiger Grund': 'kein_level' },
  }),
  MomoCharacterState: fixtures(MomoCharacterState, {
    valid: {
      'bereit': { type: 'ready', data: character },
      'wartet im Ei': {
        type: 'empty',
        reasonKey: 'momo_wartet_im_ei',
        action: action('momo.invite_partner', { type: 'partner.invite' }),
      },
      'Rollenwahl offen': {
        type: 'empty',
        reasonKey: 'rollenwahl_offen',
        action: action('momo.open_role_choice', { type: 'momo', view: 'rollenwahl' }),
      },
      'eigener Vorschlag gesendet': {
        type: 'empty',
        reasonKey: 'rollenwahl_gesendet',
        action: action('momo.open_role_choice', { type: 'momo', view: 'rollenwahl' }),
      },
    },
    invalid: {
      'unbekannter Leer-Grund': { type: 'empty', reasonKey: 'keine_insel' },
      'wartet im Ei ohne Einladen': { type: 'empty', reasonKey: 'momo_wartet_im_ei' },
      'Rollenwahl offen mit Aktion zur Insel': {
        type: 'empty',
        reasonKey: 'rollenwahl_offen',
        action: action('momo.open', { type: 'momo', view: 'insel' }),
      },
      'Vorschlag gesendet ohne Aktion': { type: 'empty', reasonKey: 'rollenwahl_gesendet' },
    },
  }),
  MomoDailyGoalsReady: fixtures(MomoDailyGoalsReady, {
    valid: { 'drei Plätze': [goalCard(1), goalCard(2), goalCard(3)] },
    invalid: {
      'nur zwei': [goalCard(1), goalCard(2)],
      'falsche Reihenfolge': [goalCard(2), goalCard(1), goalCard(3)],
      'Vertragsfehler als Tagesziel': [
        { ...goalCard(1), evaluation: { type: 'contract_error', error: { code: 'invalid_snapshot', retryable: false } } },
        goalCard(2),
        goalCard(3),
      ],
    },
  }),
  NutritionBudgetReady: fixtures(NutritionBudgetReady, {
    valid: {
      'mit Budgetvorschlag': budget,
      'Zielgewicht erreicht': {
        ...budget,
        notice: { type: 'goal_weight_reached', action: action('plan.open_goal_reached', { type: 'plan.goal_reached' }) },
      },
      'Haltemodus ohne Hinweis': { budgetKcal: 2120, maintenanceReason: 'gewaehlt' },
    },
    invalid: {
      'Aktion zu einem anderen Vorschlag': {
        ...budget,
        notice: {
          ...budget.notice,
          action: action('plan.open_budget_suggestion', { type: 'plan.budget_suggestion', suggestionId: goalVersion }),
        },
      },
      'zwei Hinweise': { ...budget, notice: [budget.notice, { type: 'goal_weight_reached' }] },
      'Budget als Bruchteil': { ...budget, budgetKcal: 1_620_000.5 },
    },
  }),
  NutritionLogReady: fixtures(NutritionLogReady, {
    valid: { 'ohne Aufnahme': { intakeKcal: 0, logAction: action('nutrition.open_log', { type: 'log' }) } },
    invalid: { 'negativ': { intakeKcal: -1, logAction: action('nutrition.open_log', { type: 'log' }) } },
  }),
  QuickCommandKey: fixtures(QuickCommandKey, {
    valid: { '+250 ml Wasser': 'water.quick_add' },
    invalid: { 'unbekannt': 'weight.quick_add' },
  }),
  TrackerQuickAction: fixtures(TrackerQuickAction, {
    valid: { 'Quick-Command': water.quickAction, 'Navigation': weight.quickAction },
    invalid: {
      'andere Menge': { type: 'command', commandKey: 'water.quick_add', params: { ml: 500 } },
      'unbekannter Befehl': { type: 'command', commandKey: 'weight.quick_add', params: {} },
    },
  }),
  QuickCommandOutcome: fixtures(QuickCommandOutcome, {
    valid: {
      'Wasser hinzugefügt': { messageKey: 'wasser.hinzugefuegt', values: { ml: 250 }, undoToken: 'undo-7f3a' },
    },
    invalid: {
      'ohne Rückgängig': { messageKey: 'wasser.hinzugefuegt', values: { ml: 250 } },
      'fertiger Text': { message: '+250 ml Wasser · Rückgängig', values: {}, undoToken: 'undo-7f3a' },
    },
  }),
  WaterQuickAddParams: fixtures(WaterQuickAddParams, {
    valid: { 'ein Glas': { ml: 250 } },
    invalid: { 'Flasche': { ml: 500 }, 'ohne Menge': {}, 'mit Zeitpunkt': { ml: 250, loggedAt: now } },
  }),
  TrackerEmptyReason: fixtures(TrackerEmptyReason, {
    valid: { 'ohne gültige Zielversion': 'ohne_zielversion' },
    invalid: { 'beliebiger Grund': 'noch_keine_eintraege' },
  }),
  TrackerWaterReady: fixtures(TrackerWaterReady, {
    valid: {
      'halb voll': water,
      'leer': { ...water, countedMl: 0, status: 'leer' },
      'genau erreicht': { ...water, countedMl: 1500, status: 'erreicht' },
      'über dem Ziel': { ...water, countedMl: 1750, status: 'ueber_ziel' },
    },
    invalid: {
      'Status im Ton problem': { ...water, status: 'problem' },
      'Detailaktion zur falschen Route': { ...water, detailAction: action('tracker.water.open', { type: 'capture.sport' }) },
      'Status passt nicht zum Wert': { ...water, countedMl: 1500, status: 'teil' },
      'erreicht schon unter dem Ziel': { ...water, countedMl: 1499, status: 'erreicht' },
      'Knopf navigiert statt zu buchen': { ...water, quickAction: { type: 'navigate', intent: action('tracker.water.open', { type: 'capture.water' }) } },
    },
  }),
  TrackerSportReady: fixtures(TrackerSportReady, {
    valid: {
      'über Ziel': sport,
      'leer': { ...sport, weekMinutes: 0, status: 'leer' },
      'unterwegs': { ...sport, weekMinutes: 75, status: 'teil' },
      'genau erreicht': { ...sport, weekMinutes: 150, status: 'erreicht' },
    },
    invalid: {
      'Minuten als Text': { ...sport, weekMinutes: '165' },
      'Status im Ton problem': { ...sport, status: 'problem' },
      'Status passt nicht zum Wert': { ...sport, weekMinutes: 150, status: 'teil' },
      'Knopf öffnet nicht das Formular': { ...sport, quickAction: { type: 'navigate', intent: action('tracker.sport.add', { type: 'capture.sport' }) } },
      'Knopf öffnet den falschen Bereich': {
        ...sport,
        quickAction: { type: 'navigate', intent: action('tracker.sport.add', { type: 'capture.weight', newEntry: true }) },
      },
      'Knopf bucht statt zu navigieren': { ...sport, quickAction: { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } } },
      'Detailaktion zur falschen Route': { ...sport, detailAction: action('tracker.sport.open', { type: 'capture.water' }) },
    },
  }),
  TrackerWeightReady: fixtures(TrackerWeightReady, {
    valid: {
      'Trend ohne Wiegetag': weight,
      'noch nie gewogen, Plan ohne Wiegetag': { ...weight, value: null, status: { type: 'kein_wiegetag', nextWeighDay: null } },
      'Wiegetag offen': { ...weight, status: { type: 'wiegetag_offen' } },
      'gewogen, unter drei Tagesgewichten': { ...weight, value: { type: 'tagesgewicht', weightG: 79_400 }, status: { type: 'gewogen' } },
    },
    invalid: {
      'Gewicht in kg': { ...weight, value: { type: 'trend', weightG: 79.6 } },
      'Wiegetag als Text': { ...weight, status: 'wiegetag_offen' },
      'Status im Ton problem': { ...weight, status: { type: 'problem' } },
      'Knopf öffnet die Details statt des Formulars': {
        ...weight,
        quickAction: { type: 'navigate', intent: action('tracker.weight.add', { type: 'capture.weight' }) },
      },
      'Knopf navigiert zu einem anderen Tracker': {
        ...weight,
        quickAction: { type: 'navigate', intent: action('tracker.weight.add', { type: 'capture.sport', newEntry: true }) },
      },
      'Knopf bucht statt zu navigieren': { ...weight, quickAction: { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } } },
    },
  }),
  PartnerCardReady: fixtures(PartnerCardReady, {
    valid: {
      'solo': {
        type: 'solo',
        inviteAction: action('partner.invite', { type: 'partner.invite' }),
        redeemAction: action('partner.redeem', { type: 'partner.redeem' }),
      },
      'gekoppelt': {
        type: 'coupled',
        partnerDisplayName: 'Anna',
        dailyGoalStage: 'fast_geschafft',
        dataAsOf: now,
        encourageAction: action('partner.encourage', { type: 'partner.encourage' }),
      },
    },
    invalid: {
      'Zusammenfassung auf Heute': {
        type: 'coupled',
        partnerDisplayName: 'Anna',
        dailyGoalStage: 'fast_geschafft',
        dataAsOf: now,
        encourageAction: action('partner.encourage', { type: 'partner.encourage' }),
        sportMinutes: 45,
      },
      'exakte Zahl der Tagesziele': {
        type: 'coupled',
        partnerDisplayName: 'Anna',
        dailyGoalStage: 2,
        dataAsOf: now,
        encourageAction: action('partner.encourage', { type: 'partner.encourage' }),
      },
    },
  }),
};
