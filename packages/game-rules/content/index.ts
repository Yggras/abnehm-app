import type { GameCatalog } from '../src/catalog.ts';
import { baseIsland } from './base-island.ts';
import { firstProject, startBlueprints } from './start.ts';

// Der ausgelieferte Spielkatalog (Spezifikation 4, Abschnitt 4). Jede Änderung erhöht `version` und
// legt mit `npm run catalog:snapshot --workspace @abnehm/game-rules` den Schnappschuss dazu an.

export const gameCatalog: GameCatalog = {
  version: 1,
  blueprints: [...startBlueprints],
  levelUnlocks: [],
  baseIsland,
  areas: [],
  landscapeTemplates: [],
  deko: [],
  visitorTemplates: [],
  accessories: [],
  projects: [firstProject],
  challengeTemplates: [],
};
