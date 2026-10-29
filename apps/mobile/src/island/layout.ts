import { fieldKey, fieldPlans, type FieldSide, type GameCatalog } from '@abnehm/game-rules/catalog';

import type { IslandSceneInput, SceneField } from './scene-model';

// Felder und Nebel einer Insel aus dem Spielkatalog (Spezifikation 4, Abschnitte 4 und 7): Die
// Grundinsel und freigeschaltete feste Gebiete sind Felder, die übrigen festen Gebiete liegen unter
// Nebel. Feldart und Seite stehen im Katalog, die Seite gehört einer Person (docs/entwicklung.md,
// „Spielregeln und Spielkatalog“). Endlose Gebiete fehlen hier: Ihre Feldpläne sind relativ, und wo
// sie auf dem Raster liegen, legt erst das Ticket zu den Gebieten fest (#204).

export type IslandLayoutRequest = Readonly<{
  /** Welche Person welche Seite hat; legt das Schlüpfen fest (#184). */
  sides: Readonly<Record<FieldSide, string>>;
  unlockedAreas: readonly string[];
}>;

export function islandLayout(catalog: GameCatalog, { sides, unlockedAreas }: IslandLayoutRequest): Pick<IslandSceneInput, 'fields' | 'fog'> {
  const open = (area: string, source: string) => source === 'grundinsel' || unlockedAreas.includes(area);
  const plans = fieldPlans(catalog).filter((plan) => plan.onIslandGrid);
  return {
    fields: plans
      .filter((plan) => open(plan.area, plan.source))
      .flatMap((plan) =>
        plan.fields.map(
          (entry): SceneField => ({
            key: fieldKey(plan.area, entry),
            x: entry.x,
            y: entry.y,
            kind: entry.kind,
            ownerPersonId: 'side' in entry ? sides[entry.side] : null,
          }),
        ),
      ),
    fog: plans
      .filter((plan) => !open(plan.area, plan.source))
      .map((plan) => ({ area: plan.area, cells: plan.fields.map(({ x, y }) => ({ x, y })) })),
  };
}
