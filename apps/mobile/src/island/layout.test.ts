import { gameCatalog } from '@abnehm/game-rules/content';
import { testCatalog } from '@abnehm/game-rules/fixtures';
import { hatching } from '@abnehm/game-rules/hatching';

import { islandLayout } from './layout';
import { anna, philipp } from './testing/persons';

// Nachweis für #182 und #184: Lage und Feldart kommen aus dem Spielkatalog, der Besitzer aus dem
// materialisierten Inselfeld. Die Felder der Grundinsel materialisiert das Schlüpfen; Philipp hat Bauen
// (Seite a), Anna Natur (Seite b).

const hatched = (catalog = gameCatalog) => hatching(catalog, { proposerPersonId: philipp, proposerRole: 'bauen', partnerPersonId: anna }).fields;

test('die Grundinsel des ausgelieferten Katalogs mit den Besitzern der Inselfelder', () => {
  const { fields, fog } = islandLayout(gameCatalog, { fields: hatched(), unlockedAreas: [] });
  const field = (key: string) => fields.find((candidate) => candidate.key === key);

  expect(fields).toHaveLength(16 * 12);
  expect(field('grundinsel:0:0')).toEqual({ key: 'grundinsel:0:0', x: 0, y: 0, kind: 'ecke', ownerPersonId: philipp });
  expect(field('grundinsel:10:5')).toEqual({ key: 'grundinsel:10:5', x: 10, y: 5, kind: 'rollenbereich', ownerPersonId: anna });
  expect(field('grundinsel:7:7')).toEqual({ key: 'grundinsel:7:7', x: 7, y: 7, kind: 'lichtung', ownerPersonId: null });
  // Gebiet 1 liegt bis Level 4 unter Nebel (#204).
  expect(fog.map(({ area, cells }) => [area, cells.length])).toEqual([['schilfwiese', 80]]);
});

test('gesperrte Gebiete liegen mit ihren Rasterzellen unter Nebel', () => {
  const { fields, fog } = islandLayout(testCatalog(), { fields: hatched(testCatalog()), unlockedAreas: [] });

  expect(fields).toHaveLength(16 * 12);
  expect(fog.map(({ area, cells }) => [area, cells.length])).toEqual([
    ['t_gebiet_1', 80],
    ['t_gebiet_2', 80],
  ]);
  expect(fog[0]!.cells[0]).toEqual({ x: 0, y: -5 });
});

test('ein freigeschaltetes Gebiet verlässt den Nebel; seine Felder kommen mit Besitzer als Inselfelder', () => {
  const unlocked = [
    { key: 't_gebiet_1:0:-5', ownerPersonId: philipp },
    { key: 't_gebiet_1:15:-1', ownerPersonId: anna },
  ];
  const { fields, fog } = islandLayout(testCatalog(), { fields: [...hatched(testCatalog()), ...unlocked], unlockedAreas: ['t_gebiet_1'] });

  expect(fields).toHaveLength(16 * 12 + 2);
  expect(fields.find((field) => field.key === 't_gebiet_1:0:-5')).toEqual({ key: 't_gebiet_1:0:-5', x: 0, y: -5, kind: 'ecke', ownerPersonId: philipp });
  expect(fields.find((field) => field.key === 't_gebiet_1:15:-1')).toMatchObject({ kind: 'ecke', ownerPersonId: anna });
  expect(fog.map(({ area }) => area)).toEqual(['t_gebiet_2']);
});

test('Felder endloser Gebiete liegen in ihrem Band über den festen Gebieten (#204)', () => {
  const endless = [{ key: 'endlos_1_t_vorlage_erste:0:0', ownerPersonId: philipp }];
  const { fields } = islandLayout(testCatalog(), { fields: [...hatched(testCatalog()), ...endless], unlockedAreas: ['t_gebiet_1', 't_gebiet_2', 'endlos_1_t_vorlage_erste'] });

  expect(fields.find((field) => field.key === 'endlos_1_t_vorlage_erste:0:0')).toEqual({ key: 'endlos_1_t_vorlage_erste:0:0', x: 0, y: -15, kind: 'ecke', ownerPersonId: philipp });
});

test('ein Inselfeld, das der Katalog nicht kennt, ist ein Integrationsfehler', () => {
  expect(() => islandLayout(gameCatalog, { fields: [{ key: 'grundinsel:99:99', ownerPersonId: null }], unlockedAreas: [] })).toThrow('grundinsel:99:99');
});
