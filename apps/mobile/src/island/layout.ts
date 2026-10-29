import { baseIslandKey, fieldKey, type FieldPlanEntry, type FieldSide, type GameCatalog } from '@abnehm/game-rules/catalog';

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
  const unlocked = new Set(unlockedAreas);
  const fieldsOf = (area: string, entries: readonly FieldPlanEntry[]): SceneField[] =>
    entries.map((entry) => ({
      key: fieldKey(area, entry),
      x: entry.x,
      y: entry.y,
      kind: entry.kind,
      ownerPersonId: 'side' in entry ? sides[entry.side] : null,
    }));
  return {
    fields: [
      ...fieldsOf(baseIslandKey, catalog.baseIsland.fields),
      ...catalog.areas.filter((area) => unlocked.has(area.key)).flatMap((area) => fieldsOf(area.key, area.fields)),
    ],
    fog: catalog.areas
      .filter((area) => !unlocked.has(area.key))
      .map((area) => ({ area: area.key, cells: area.fields.map(({ x, y }) => ({ x, y })) })),
  };
}
