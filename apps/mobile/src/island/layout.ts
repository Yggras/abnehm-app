import { fieldPlacement } from '@abnehm/game-rules/areas';
import { fieldPlans, type GameCatalog } from '@abnehm/game-rules/catalog';
import type { IslandFieldOwner } from '@abnehm/game-rules/hatching';

import type { FogArea, IslandSceneInput, SceneField } from './scene-model';

// Felder und Nebel einer Insel (Spezifikation 4, Abschnitte 4 und 7): Die Inselfelder materialisiert der
// Server beim Schlüpfen und bei jeder Gebietsfreischaltung samt Besitzer (#184, #204); Lage und Feldart stehen
// im Spielkatalog, für endlose Gebiete in ihrer Landschaftsvorlage (`fieldPlacement`). Die festen Gebiete, die noch
// nicht freigeschaltet sind, liegen unter Nebel. Endlose Gebiete zeigt die Insel erst mit ihrer Freischaltung.

export type IslandLayoutRequest = Readonly<{
  /** Die materialisierten Inselfelder mit Besitzer; `null` bei Strand, Lichtung und Gemeinschaftsplatz. */
  fields: readonly IslandFieldOwner[];
  unlockedAreas: readonly string[];
}>;

export function islandLayout(catalog: GameCatalog, { fields, unlockedAreas }: IslandLayoutRequest): Pick<IslandSceneInput, 'fields' | 'fog'> {
  const placementOf = fieldPlacement(catalog);
  return {
    fields: fields.map(({ key, ownerPersonId }): SceneField => {
      const entry = placementOf(key);
      if (entry === undefined) throw new Error(`Inselfeld ${key} fehlt im Spielkatalog`);
      return { key, x: entry.x, y: entry.y, kind: entry.kind, ownerPersonId };
    }),
    fog: areaCells(catalog).filter(({ area }) => !unlockedAreas.includes(area)),
  };
}

/**
 * Die Rasterzellen der festen Gebiete. Nach der Freischaltung zieht der Nebel über ihnen ab (Verwandlungsszene,
 * #204); dafür braucht die Szene die Zellen des eben freigeschalteten Gebiets.
 */
export function areaCells(catalog: GameCatalog, areas?: readonly string[]): FogArea[] {
  return fieldPlans(catalog)
    .filter((plan) => plan.source === 'gebiet' && (areas === undefined || areas.includes(plan.area)))
    .map((plan) => ({ area: plan.area, cells: plan.fields.map(({ x, y }) => ({ x, y })) }));
}
