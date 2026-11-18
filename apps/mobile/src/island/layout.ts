import { fieldKey, fieldPlans, type FieldPlanEntry, type GameCatalog } from '@abnehm/game-rules/catalog';
import type { IslandFieldOwner } from '@abnehm/game-rules/hatching';

import type { IslandSceneInput, SceneField } from './scene-model';

// Felder und Nebel einer Insel (Spezifikation 4, Abschnitte 4 und 7): Die Inselfelder materialisiert der
// Server beim Schlüpfen und bei jeder Gebietsfreischaltung samt Besitzer (#184); Lage und Feldart stehen
// im Spielkatalog. Die festen Gebiete, die noch nicht freigeschaltet sind, liegen unter Nebel. Endlose
// Gebiete fehlen hier: Ihre Feldpläne sind relativ, und wo sie auf dem Raster liegen, legt erst das
// Ticket zu den Gebieten fest (#204).

export type IslandLayoutRequest = Readonly<{
  /** Die materialisierten Inselfelder mit Besitzer; `null` bei Strand, Lichtung und Gemeinschaftsplatz. */
  fields: readonly IslandFieldOwner[];
  unlockedAreas: readonly string[];
}>;

export function islandLayout(catalog: GameCatalog, { fields, unlockedAreas }: IslandLayoutRequest): Pick<IslandSceneInput, 'fields' | 'fog'> {
  const plans = fieldPlans(catalog).filter((plan) => plan.onIslandGrid);
  const entries = new Map<string, FieldPlanEntry>(plans.flatMap((plan) => plan.fields.map((entry) => [fieldKey(plan.area, entry), entry] as const)));
  return {
    fields: fields.map(({ key, ownerPersonId }): SceneField => {
      const entry = entries.get(key);
      if (entry === undefined) throw new Error(`Inselfeld ${key} fehlt im Spielkatalog`);
      return { key, x: entry.x, y: entry.y, kind: entry.kind, ownerPersonId };
    }),
    fog: plans
      .filter((plan) => plan.source !== 'grundinsel' && !unlockedAreas.includes(plan.area))
      .map((plan) => ({ area: plan.area, cells: plan.fields.map(({ x, y }) => ({ x, y })) })),
  };
}
