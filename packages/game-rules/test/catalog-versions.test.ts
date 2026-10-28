import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { gameCatalog } from '../content/index.ts';
import { testCatalog } from '../fixtures/index.ts';
import { catalogChanges, catalogDedications, type CatalogSnapshot } from '../src/catalog-check.ts';

// Nachweis für #179: Der Katalog ist versioniert und additiv (Abschnitt 4 von #83). Jede Version hat
// einen Schnappschuss ihrer Schlüssel samt Widmung; gegenüber der vorigen Version darf kein Schlüssel
// fehlen oder anders gewidmet sein.

const directory = new URL('../catalog-versions/', import.meta.url);
const snapshots: CatalogSnapshot[] = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as CatalogSnapshot)
  .sort((a, b) => a.version - b.version);

describe('Widmung der Schlüssel', () => {
  const dedications = catalogDedications(testCatalog());

  it('hält je Schlüssel fest, wofür er steht', () => {
    expect(dedications).toMatchObject({
      t_weg: 'bauplan:bauen',
      t_ent_deko_1: 'deko:entdeckung',
      t_gebiet_1: 'gebiet:4',
      't_gebiet_1:0:-5': 'feld:ecke:a',
      'grundinsel:7:11': 'feld:strand',
      t_vorlage_erste: 'landschaftsvorlage',
      't_vorlage_erste:2:0': 'feld:rollenbereich:a',
      t_projekt: 'gemeinschaftsprojekt:1',
      'level:2:bauen': 't_bauen_2',
    });
  });

  it('erkennt entfernte und umgewidmete Schlüssel, Ergänzungen sind erlaubt', () => {
    const previous = { version: 1, keys: { a: 'bauplan:bauen', b: 'deko:besucher', c: 'feld:ecke:a' } };
    const current = { version: 2, keys: { a: 'bauplan:natur', c: 'feld:ecke:a', d: 'deko:challenge' } };
    expect(catalogChanges(previous, current)).toEqual({ removed: ['b'], rededicated: ['a'] });
    expect(catalogChanges(previous, { version: 2, keys: { ...previous.keys, d: 'deko:challenge' } })).toEqual({ removed: [], rededicated: [] });
  });
});

describe('Katalogversionen', () => {
  it('haben je Version von 1 an einen Schnappschuss', () => {
    expect(snapshots.map((snapshot) => snapshot.version)).toEqual(Array.from({ length: gameCatalog.version }, (_, i) => i + 1));
  });

  it('entsprechen in der aktuellen Version genau dem ausgelieferten Katalog', () => {
    // Schlägt fehl, wenn der Katalog geändert wurde, ohne `version` zu erhöhen und den Schnappschuss
    // mit `npm run catalog:snapshot --workspace @abnehm/game-rules` anzulegen.
    expect(snapshots.at(-1)).toEqual({ version: gameCatalog.version, keys: catalogDedications(gameCatalog) });
  });

  it.each(snapshots.slice(1).map((snapshot, index) => [snapshots[index]!, snapshot] as const))(
    'entfernen und widmen keinen Schlüssel um: %#',
    (previous, current) => {
      expect(catalogChanges(previous, current)).toEqual({ removed: [], rededicated: [] });
    },
  );
});
