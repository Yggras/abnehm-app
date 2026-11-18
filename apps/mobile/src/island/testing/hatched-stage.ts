import { EntityId, Instant } from '@abnehm/contracts/base';
import { IslandProgress } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import { halvesFor } from '../halves';
import { appearanceAt } from '../hatched-island';
import type { IslandStage } from '../role-choice';
import { anna, philipp } from './persons';

// Stufe „geschlüpft“ für Tests anderer Bereiche, etwa der App-Shell (#184): Philipp hat Bauen, Anna Natur,
// die Grundinsel ist materialisiert, Momo steht als Kaulquappe auf Level 1. Alle Werte sind synthetisch.

const islandId = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c02');
const at = Instant.parse('2026-10-14T12:00:00.000Z');

export function hatchedStage(): Extract<IslandStage, { type: 'geschluepft' }> {
  const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
  const progress = IslandProgress.parse({
    islandId,
    couplingId: '5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c01',
    level: plan.progress.level,
    levelNeed: plan.progress.levelNeed,
    members: plan.progress.members,
    activeProject: { projectId: '5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c03', templateKey: plan.project.templateKey, sequenceNumber: 1, stage: 'gestartet' },
    dataAsOf: at,
    serverVersion: '1',
  });
  return {
    type: 'geschluepft',
    island: {
      islandId,
      viewerPersonId: EntityId.parse(philipp),
      partnerPersonId: EntityId.parse(anna),
      partnerDisplayName: 'Anna',
      ownRole: 'bauen',
      energy: 0,
      progress,
      halves: halvesFor(progress, philipp, 0),
      fields: plan.fields.map((field, index) => ({ ...field, id: EntityId.parse(`5d1c7e3a-2b4f-4a8e-b6c1-${String(index).padStart(12, '0')}`) })),
      objects: [],
      storage: [],
      unlockedAreas: [],
      unlockedBlueprints: plan.blueprints.map((blueprint) => blueprint.key),
      appearance: appearanceAt(plan.progress.level),
      sharedEvents: [{ eventId: EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c04'), type: plan.event.type, occurredAt: at }],
    },
  };
}
