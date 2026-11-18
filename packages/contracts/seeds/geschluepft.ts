import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import type { SeedEntity, SeedPart } from './build.ts';
import { seedIds } from './ids.ts';
import { buildEntities, progressOf, type SeedBuild } from './spielverlauf.ts';

// Spiel (#184): was das Schlüpfen für die Insel von Philipp und Anna materialisiert hat, mit denselben
// Regeln wie der Server (`@abnehm/game-rules/hatching`). Anna hat Natur vorgeschlagen, Philipp hat
// angenommen und Bauen bekommen; Seite a gehört damit Philipp. Dazu die Start-Baupläne, Projekt 1, das
// Ereignis „Momo ist geschlüpft“, die gebauten Objekte samt `build_debit` (#191) und der Inselfortschritt
// aus diesen Bauten. Ohne Bauten steht die Insel auf Level 1 ohne verbaute Energie.

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;
const islandId = seedIds.island.philippAnna;

export function geschluepftePart(hatchedAt: string, builds: readonly SeedBuild[] = []): SeedPart {
  const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
  const owned = { island_id: islandId, coupling_id: couplingId };
  const entity = (table: string, row: SeedEntity['row']): SeedEntity => ({ table, entityType: table, couplingId, row });
  const projectId = seedIds.communityProject.gartenhaeuschen;
  const progress = progressOf(builds);
  // Der Projector schreibt den Fortschritt zuletzt beim jüngsten Bau neu.
  const projectedAt = builds.at(-1)?.at ?? hatchedAt;
  return {
    area: 'spiel',
    entities: [
      ...plan.fields.map((field, index) =>
        entity('island_field', { id: seedIds.islandField(index + 1), ...owned, field_key: field.key, owner_person_id: field.ownerPersonId, created_at: hatchedAt }),
      ),
      ...plan.blueprints.map((blueprint, index) =>
        entity('blueprint_unlock', {
          id: seedIds.blueprintUnlock(index + 1), ...owned, catalog_key: blueprint.key, reason: blueprint.reason, unlocked_at: hatchedAt, created_at: hatchedAt,
        }),
      ),
      entity('community_project', {
        id: projectId,
        ...owned,
        sequence_number: plan.project.sequenceNumber,
        template_key: plan.project.templateKey,
        build_need: plan.project.buildNeed,
        nature_need: plan.project.natureNeed,
        status: 'aktiv',
        completed_at: null,
        created_at: hatchedAt,
        updated_at: hatchedAt,
        deleted_at: null,
      }),
      entity('island_event', {
        id: seedIds.islandEvent.geschluepft,
        ...owned,
        type: plan.event.type,
        template_key: null,
        responsible_person_id: null,
        occasion_key: plan.event.occasionKey,
        status: 'abgeschlossen',
        reward: null,
        occurred_at: hatchedAt,
        created_at: hatchedAt,
        updated_at: hatchedAt,
        deleted_at: null,
      }),
      ...builds.flatMap((build, index) => buildEntities(build, index + 1)),
      // Wie in der App: angelegt und geändert zum Datenstand der Projektion.
      entity('island_progress', {
        id: seedIds.islandProgress.philippAnna,
        ...owned,
        level: progress.level,
        level_need: progress.levelNeed,
        content: {
          members: progress.members,
          activeProject: { projectId, templateKey: plan.project.templateKey, sequenceNumber: 1, stage: 'gestartet' },
        },
        data_as_of: projectedAt,
        created_at: projectedAt,
        updated_at: projectedAt,
        deleted_at: null,
      }),
    ],
  };
}
