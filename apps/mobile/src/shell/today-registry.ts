import type { z } from 'zod';

import { contributionState } from '@abnehm/contracts/contribution';
import {
  HeaderReady, MomoCharacterState, MomoDailyGoalsReady, NutritionBudgetReady, NutritionLogReady,
  PartnerCardReady, TopNoticeReady, TrackerEmptyReason, TrackerSportReady, TrackerWaterReady, TrackerWeightReady,
} from '@abnehm/contracts/today';

/** Die Reihenfolge gehört der Shell, nicht der Reihenfolge der Registrierung. */
export const todaySlots = [
  { key: 'header', owner: 'fundament', schema: contributionState(HeaderReady) },
  { key: 'top_notice', owner: 'partner', schema: contributionState(TopNoticeReady) },
  { key: 'momo.character', owner: 'momo', schema: MomoCharacterState },
  { key: 'momo.daily_goals', owner: 'ziele', schema: contributionState(MomoDailyGoalsReady) },
  { key: 'nutrition.budget', owner: 'ziele', schema: contributionState(NutritionBudgetReady) },
  { key: 'nutrition.log', owner: 'ernaehrung', schema: contributionState(NutritionLogReady) },
  { key: 'trackers.water', owner: 'tracker', schema: contributionState(TrackerWaterReady, TrackerEmptyReason) },
  { key: 'trackers.sport', owner: 'tracker', schema: contributionState(TrackerSportReady) },
  { key: 'trackers.weight', owner: 'tracker', schema: contributionState(TrackerWeightReady) },
  { key: 'partner', owner: 'partner', schema: contributionState(PartnerCardReady) },
] as const;

export type TodaySlot = (typeof todaySlots)[number]['key'];
export type TodayOwner = (typeof todaySlots)[number]['owner'];
export type TodayState<K extends TodaySlot> = z.infer<Extract<(typeof todaySlots)[number], { key: K }>['schema']>;
export type TodaySource<K extends TodaySlot> = {
  /** Sofort den aktuellen Stand melden und danach jeden Wechsel; Abmelden beendet die Beobachtung. */
  subscribe(listener: (state: TodayState<K>) => void): () => void;
};

export class MissingTodayContributionError extends Error {
  constructor(key: TodaySlot) {
    super(`Integrationsfehler: Pflichtbeitrag „${key}“ für Heute fehlt.`);
    this.name = 'MissingTodayContributionError';
  }
}

/** Pro Slot genau eine fachliche Quelle; die Shell prüft ihre Daten am Vertragsrand. */
export function createTodayRegistry() {
  const sources = new Map<TodaySlot, TodaySource<any>>();
  return {
    register<K extends TodaySlot>(owner: TodayOwner, key: K, source: TodaySource<K>) {
      const slot = todaySlots.find((entry) => entry.key === key);
      if (slot?.owner !== owner) throw new Error(`Beitrag „${key}“ gehört nicht „${owner}“.`);
      if (sources.has(key)) throw new Error(`Beitrag „${key}“ ist bereits registriert.`);
      sources.set(key, source);
      return () => { if (sources.get(key) === source) sources.delete(key); };
    },
    read(key: TodaySlot) {
      const source = sources.get(key);
      if (!source) throw new MissingTodayContributionError(key);
      return source;
    },
    subscribe<K extends TodaySlot>(key: K, listener: (state: TodayState<K>) => void) {
      const source = sources.get(key);
      if (!source) throw new MissingTodayContributionError(key);
      const schema = todaySlots.find((entry) => entry.key === key)!.schema;
      return source.subscribe((state) => listener(schema.parse(state) as TodayState<K>));
    },
  };
}

export type TodayRegistry = ReturnType<typeof createTodayRegistry>;
