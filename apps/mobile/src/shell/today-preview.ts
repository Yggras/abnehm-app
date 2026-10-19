import type { Clock } from '@abnehm/clock';
import type { TodayOwner, TodaySlot, TodayState } from './today-registry';
import { headerFor } from './TodayScreen';
import { createTodayRegistry } from './today-registry';

/** Explizite synthetische Vorschau für Development Builds; nie als Fachdatenquelle in Release. */
export function createTodayPreview(clock: Clock) {
  const registry = createTodayRegistry();
  const sampleDay = clock.read().localDate;
  const intent = (actionId: string, target: object) => ({ actionId, target });
  const goal = (slot: number, currentState: string, progress: object, messageKey: string, target: object) => ({
    slot, evaluation: { type: 'evaluated', currentState, dayClosed: false, progress, completion: { type: 'nie' }, messageKey, values: {} },
    action: intent('tagesziel.open_area', target),
  });
  const goals = [
    goal(1, 'teilweise', { type: 'ernaehrung_erfasst', recordedMealCategories: 1, minimumMealCategories: 2 }, 'tagesziel.ernaehrung.teilweise', { type: 'log' }),
    goal(2, 'teilweise', { type: 'wasserziel', countedMl: 750, targetMl: 1500 }, 'tagesziel.wasserziel.teilweise', { type: 'capture.water' }),
    goal(3, 'offen', { type: 'sporteinheit', longestSessionMinutes: 0, minimumSingleSessionMinutes: 30 }, 'tagesziel.sporteinheit.offen', { type: 'capture.sport' }),
  ];
  const quick = { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } };
  const data: Record<TodaySlot, unknown> = {
    header: headerFor('Philipp', sampleDay),
    top_notice: { senderDisplayName: 'Anna', encouragementKey: 'stark_heute', action: intent('top_notice.open', { type: 'partner', focus: 'received_encouragement' }) },
    'momo.character': {
      appearance: { stage: 'geschluepft', formKey: 'huepfer', moodKey: 'zufrieden', accessories: { kopf: null, hals: null } },
      energy: 4, level: 6, ownHalfPercent: 100, partnerHalfPercent: 43, waitingForPartner: true,
      islandNotice: { newEvents: 1, claimableWishes: 0 },
    },
    'momo.daily_goals': goals,
    'nutrition.budget': { budgetKcal: 1620, maintenanceReason: null, notice: { type: 'goal_weight_reached', action: intent('plan.open_goal_reached', { type: 'plan.goal_reached' }) } },
    'nutrition.log': { intakeKcal: 840, logAction: intent('nutrition.open_log', { type: 'log' }) },
    'trackers.water': { key: 'wasser', countedMl: 750, targetMl: 1500, status: 'teil', detailAction: intent('tracker.water.open', { type: 'capture.water' }), quickAction: quick },
    'trackers.sport': { key: 'sport', weekMinutes: 65, weeklyTargetMinutes: 150, status: 'teil', detailAction: intent('tracker.sport.open', { type: 'capture.sport' }), quickAction: { type: 'navigate', intent: intent('tracker.sport.add', { type: 'capture.sport', newEntry: true }) } },
    'trackers.weight': { key: 'gewicht', value: { type: 'trend', weightG: 79_600 }, status: { type: 'gewogen' }, detailAction: intent('tracker.weight.open', { type: 'capture.weight' }), quickAction: { type: 'navigate', intent: intent('tracker.weight.add', { type: 'capture.weight', newEntry: true }) } },
    partner: { type: 'coupled', partnerDisplayName: 'Anna', dailyGoalStage: 'fast_geschafft', dataAsOf: clock.read().instant, encourageAction: intent('partner.encourage', { type: 'partner.encourage' }) },
  };
  const owners: Record<TodaySlot, TodayOwner> = {
    header: 'fundament', top_notice: 'partner', 'momo.character': 'momo', 'momo.daily_goals': 'ziele',
    'nutrition.budget': 'ziele', 'nutrition.log': 'ernaehrung', 'trackers.water': 'tracker',
    'trackers.sport': 'tracker', 'trackers.weight': 'tracker', partner: 'partner',
  };
  for (const key of Object.keys(data) as TodaySlot[]) {
    registry.register(owners[key], key, { subscribe(listener) { listener({ type: 'ready', data: data[key] } as TodayState<typeof key>); return () => {}; } });
  }
  return registry;
}
