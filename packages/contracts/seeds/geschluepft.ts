import { gameCatalog } from '@abnehm/game-rules/content';
import { hatching } from '@abnehm/game-rules/hatching';

import type { SeedEntity, SeedPart } from './build.ts';
import { seedIds } from './ids.ts';

// Spiel (#184): was das Schlüpfen für die Insel von Philipp und Anna materialisiert hat, mit denselben
// Regeln wie der Server (`@abnehm/game-rules/hatching`). Anna hat Natur vorgeschlagen, Philipp hat
// angenommen und Bauen bekommen; Seite a gehört damit Philipp. Dazu die Start-Baupläne, Projekt 1, das
// Ereignis „Momo ist geschlüpft“ und der Inselfortschritt auf Level 1 ohne verbaute Energie. Den
// Spielverlauf auf Level 6 aus Spezifikation 4, Abschnitt 13 liefern spätere Tickets.

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;
const islandId = seedIds.island.philippAnna;

export function geschluepftePart(hatchedAt: string): SeedPart {
  const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
  const owned = { island_id: islandId, coupling_id: couplingId };
  const entity = (table: string, row: SeedEntity['row']): SeedEntity => ({ table, entityType: table, couplingId, row });
  const projectId = seedIds.communityProject.gartenhaeuschen;
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
      // Wie in der App: angelegt und geändert zum Datenstand der Projektion.
      entity('island_progress', {
        id: seedIds.islandProgress.philippAnna,
        ...owned,
        level: plan.progress.level,
        level_need: plan.progress.levelNeed,
        content: {
          // Mitglieder nach Person sortiert wie im Projector; die Hälften der Spielregel stehen in der Reihenfolge Bauen, Natur.
          members: [philipp, anna].sort().map((personId) => ({ personId, ...plan.progress.halves[personId === plan.roles.bauen ? 0 : 1]! })),
          activeProject: { projectId, templateKey: plan.project.templateKey, sequenceNumber: 1, stage: 'gestartet' },
        },
        data_as_of: hatchedAt,
        created_at: hatchedAt,
        updated_at: hatchedAt,
        deleted_at: null,
      }),
    ],
  };
}
