import { EntityId } from '../src/base.ts';
import { islandEventId, islandEventStateId, VisitorEventDetails } from '../src/island-records.ts';
import type { SeedEntity } from './build.ts';
import { seedIds } from './ids.ts';

// Besucher mit Wunsch in Seeds (#202; Spezifikation 4, Abschnitt 9): je Besuch das Ereignis der Insel und
// der Ereignisstand der zuständigen Person, wie der Ereignisgenerator sie anlegt. IDs leiten sich wie auf
// dem Server aus Insel, Anlassschlüssel und Person ab. Alle Werte sind erfunden.

const couplingId = seedIds.coupling.philippAnna;
const islandId = EntityId.parse(seedIds.island.philippAnna);

export type SeedVisit = Readonly<{
  personId: string;
  /** Inseltag des Anlassschlüssels `tag:‹datum›:‹n›`. */
  date: string;
  n: number;
  templateKey: string;
  details: VisitorEventDetails;
  at: string;
}>;

/** Ereignis und Ereignisstand eines offenen, noch nicht gesehenen Besuchs. */
export function visitEntities(visit: SeedVisit): SeedEntity[] {
  const occasionKey = `tag:${visit.date}:${visit.n}`;
  const eventId = islandEventId(islandId, occasionKey);
  return [
    {
      table: 'island_event',
      entityType: 'island_event',
      couplingId,
      row: {
        id: eventId,
        island_id: islandId,
        coupling_id: couplingId,
        type: 'besuch',
        template_key: visit.templateKey,
        responsible_person_id: visit.personId,
        occasion_key: occasionKey,
        status: 'offen',
        reward: VisitorEventDetails.parse(visit.details),
        occurred_at: visit.at,
        created_at: visit.at,
        updated_at: visit.at,
        deleted_at: null,
      },
    },
    {
      table: 'island_event_state',
      entityType: 'island_event_state',
      ownerPersonId: visit.personId,
      row: {
        id: islandEventStateId(eventId, EntityId.parse(visit.personId)),
        island_event_id: eventId,
        person_id: visit.personId,
        seen_at: null,
        claimed_at: null,
        created_at: visit.at,
        updated_at: visit.at,
        deleted_at: null,
      },
    },
  ];
}

const wish = (blueprintKey: string, reward: VisitorEventDetails['reward']): VisitorEventDetails => ({ wish: { type: 'bauplan_bauen', blueprintKey }, reward });

/**
 * Die Besucher von heute in `gekoppelt`: Beim ersten Pull am Morgen hat der Generator den Tagesdeckel mit
 * je einem Besuch für Philipp und Anna gefüllt. Keiner der Wünsche ist erfüllt.
 */
export const gekoppeltBesuche: readonly SeedVisit[] = [
  { personId: seedIds.person.philipp, date: '2026-10-14', n: 1, templateKey: 'igel_ilse', details: wish('sitzbank', { type: 'bauplan', key: 'brunnen' }), at: '2026-10-14T05:30:00.000Z' },
  { personId: seedIds.person.anna, date: '2026-10-14', n: 2, templateKey: 'eule_otto', details: wish('blumenwiese', { type: 'bauplan', key: 'sonnenblumen' }), at: '2026-10-14T05:30:00.000Z' },
];
