import type { GameCatalog } from '../src/catalog.ts';
import { accessories } from './accessories.ts';
import { areaBlueprints, areaDeko, areas } from './areas.ts';
import { baseIsland } from './base-island.ts';
import { challengeDeko, challengeTemplates } from './challenges.ts';
import { firstProject, startBlueprints } from './start.ts';
import { visitorBlueprints, visitorDeko, visitorTemplates } from './visitors.ts';

// Der ausgelieferte Spielkatalog (Spezifikation 4, Abschnitt 4). Jede Änderung erhöht `version` und
// legt mit `npm run catalog:snapshot --workspace @abnehm/game-rules` den Schnappschuss dazu an.

export const gameCatalog: GameCatalog = {
  version: 5,
  blueprints: [...startBlueprints, ...visitorBlueprints, ...areaBlueprints],
  levelUnlocks: [],
  baseIsland,
  areas: [...areas],
  landscapeTemplates: [],
  deko: [...visitorDeko, ...challengeDeko, ...areaDeko],
  visitorTemplates: [...visitorTemplates],
  accessories: [...accessories],
  projects: [firstProject],
  challengeTemplates: [...challengeTemplates],
};
