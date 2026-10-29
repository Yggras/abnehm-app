import { EntityId } from '@abnehm/contracts/base';
import { gameCatalog } from '@abnehm/game-rules/content';
import { testCatalog } from '@abnehm/game-rules/fixtures';

import { islandLayout } from './layout';

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const sides = { a: philipp, b: anna };

test('die Grundinsel des ausgelieferten Katalogs: Seite a gehört der einen, Seite b der anderen Person', () => {
  const { fields, fog } = islandLayout(gameCatalog, { sides, unlockedAreas: [] });
  const field = (key: string) => fields.find((candidate) => candidate.key === key);

  expect(fields).toHaveLength(16 * 12);
  expect(field('grundinsel:0:0')).toEqual({ key: 'grundinsel:0:0', x: 0, y: 0, kind: 'ecke', ownerPersonId: philipp });
  expect(field('grundinsel:10:5')).toEqual({ key: 'grundinsel:10:5', x: 10, y: 5, kind: 'rollenbereich', ownerPersonId: anna });
  expect(field('grundinsel:7:7')).toEqual({ key: 'grundinsel:7:7', x: 7, y: 7, kind: 'lichtung', ownerPersonId: null });
  expect(fog).toEqual([]);
});

test('gesperrte Gebiete liegen mit ihren Rasterzellen unter Nebel', () => {
  const { fields, fog } = islandLayout(testCatalog(), { sides, unlockedAreas: [] });

  expect(fields).toHaveLength(16 * 12);
  expect(fog.map(({ area, cells }) => [area, cells.length])).toEqual([
    ['t_gebiet_1', 80],
    ['t_gebiet_2', 80],
  ]);
  expect(fog[0]!.cells[0]).toEqual({ x: 0, y: -5 });
});

test('ein freigeschaltetes Gebiet bringt Felder für beide Seiten und verlässt den Nebel', () => {
  const { fields, fog } = islandLayout(testCatalog(), { sides, unlockedAreas: ['t_gebiet_1'] });

  expect(fields).toHaveLength(16 * 12 + 80);
  expect(fields.find((field) => field.key === 't_gebiet_1:0:-5')).toEqual({ key: 't_gebiet_1:0:-5', x: 0, y: -5, kind: 'ecke', ownerPersonId: philipp });
  expect(fields.find((field) => field.key === 't_gebiet_1:15:-1')).toMatchObject({ kind: 'ecke', ownerPersonId: anna });
  expect(fog.map(({ area }) => area)).toEqual(['t_gebiet_2']);
});
