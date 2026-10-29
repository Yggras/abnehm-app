import { EntityId } from '@abnehm/contracts/base';
import { IslandProgress, MomoAppearance } from '@abnehm/contracts/island';
import { seedClock, seedIds } from '@abnehm/contracts/seeds';
import { gameCatalog } from '@abnehm/game-rules/content';

import type { IslandViewProps } from '../island/IslandView';
import { islandLayout } from '../island/layout';

// Fixture-Insel der Test-Artefakte (#182). Bis „Schlüpfen“ (#184) die echte Insel aus den lokalen Daten
// anschließt, zeigt der Tab „Momo“ im Development- und im E2E-Build diese Insel: die Grundinsel des
// ausgelieferten Spielkatalogs mit Philipp auf Seite a und Anna auf Seite b (Personen aus den
// Seed-Manifesten), Objekte der Start-Baupläne, Level 6 mit 23 Energie wie das Szenario „gekoppelt“
// (Spezifikation 4, Abschnitt 13) und eine Vorschau eines gesperrten Gebiets unter Nebel. Alle Werte
// sind synthetisch; Objekte, Hälften und das Gebiet sind Designwerte für die Sichtprüfung.

export type FixtureIsland = Omit<IslandViewProps, 'onOpen' | 'onFieldPress' | 'bottomInset'>;

const philipp = EntityId.parse(seedIds.person.philipp);
const anna = EntityId.parse(seedIds.person.anna);
const fixtureId = (n: number) => EntityId.parse(`f15e0182-0000-4000-8000-${n.toString().padStart(12, '0')}`);

/** Start-Baupläne auf eigenen Feldern: Philipp baut (Seite a), Anna pflegt die Natur (Seite b). */
const placed: readonly [string, string, string][] = [
  ['grundinsel:4:1', 'holzweg_1', philipp],
  ['grundinsel:4:2', 'holzweg_1', philipp],
  ['grundinsel:4:3', 'holzweg_1', philipp],
  ['grundinsel:5:4', 'laterne_2', philipp],
  ['grundinsel:2:6', 'sitzbank_1', philipp],
  ['grundinsel:1:2', 'laterne_1', philipp],
  ['grundinsel:12:6', 'apfelbaum_1', anna],
  ['grundinsel:14:7', 'apfelbaum_2', anna],
  ['grundinsel:11:8', 'beerenstrauch_1', anna],
  ['grundinsel:13:2', 'blumenwiese_1', anna],
  ['grundinsel:10:3', 'blumenwiese_1', anna],
];

/** Vorschau eines gesperrten Gebiets nördlich der Grundinsel; die echten Gebiete kommen mit #204 und #205. */
const lockedPreview = {
  area: 'fixture_insel_nebel',
  cells: Array.from({ length: 16 * 3 }, (_, index) => ({ x: index % 16, y: -3 + Math.floor(index / 16) })),
};

export function fixtureIsland(): FixtureIsland {
  return {
    island: {
      ...islandLayout(gameCatalog, { sides: { a: philipp, b: anna }, unlockedAreas: [] }),
      fog: [lockedPreview],
      objects: placed.map(([fieldKey, art, ownerPersonId], index) => ({ id: fixtureId(index + 1), fieldKey, art, ownerPersonId })),
      momo: MomoAppearance.parse({ stage: 'geschluepft', formKey: 'huepfer', moodKey: 'zufrieden', accessories: { kopf: null, hals: null } }),
    },
    // Level 6: Bedarf min(10 + 6, 30) = 16; Philipp 9 von 16 (56 %), Anna 13 von 16 (81 %).
    progress: IslandProgress.parse({
      islandId: seedIds.island.philippAnna,
      couplingId: seedIds.coupling.philippAnna,
      level: 6,
      levelNeed: 16,
      members: [
        { personId: philipp, halfPercent: 56, halfFull: false },
        { personId: anna, halfPercent: 81, halfFull: false },
      ],
      activeProject: { projectId: fixtureId(100), templateKey: gameCatalog.projects[0]!.key, sequenceNumber: 1, stage: 'gut_unterwegs' },
      dataAsOf: seedClock.instant,
      serverVersion: '1',
    }),
    viewerPersonId: philipp,
    partnerName: 'Anna',
    energy: 23,
  };
}
