import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readSnapshots, snapshotOf } from '../catalog-versions/snapshots.ts';
import { gameCatalog } from '../content/index.ts';
import { testCatalog } from '../fixtures/index.ts';
import { catalogChanges, catalogDedications } from '../src/catalog-check.ts';

// Nachweis für #179: Der Katalog ist versioniert und additiv (Abschnitt 4 von #83). Jede Version hat
// einen Schnappschuss mit Digest und den Schlüsseln samt Widmung. Gegenüber der vorigen Version darf
// kein Schlüssel fehlen oder anders gewidmet sein, und Schnappschüsse auf `main` ändern sich nie.

const snapshots = readSnapshots();

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

  it('ändert den Digest mit jedem Inhalt, auch ohne neuen Schlüssel', () => {
    const renamed = { ...testCatalog(), projects: [{ ...testCatalog().projects[0]!, name: 'Umbenannt' }] };
    expect(snapshotOf(renamed).keys).toEqual(snapshotOf(testCatalog()).keys);
    expect(snapshotOf(renamed).digest).not.toBe(snapshotOf(testCatalog()).digest);
  });
});

describe('Katalogversionen', () => {
  it('haben je Version von 1 an einen Schnappschuss', () => {
    expect(snapshots.map((snapshot) => snapshot.version)).toEqual(Array.from({ length: gameCatalog.version }, (_, i) => i + 1));
  });

  it('entsprechen in der aktuellen Version genau dem ausgelieferten Katalog', () => {
    // Schlägt fehl, wenn der Katalog geändert wurde, ohne `version` zu erhöhen und den Schnappschuss
    // mit `npm run catalog:snapshot --workspace @abnehm/game-rules` anzulegen.
    expect(snapshots.at(-1)).toEqual(snapshotOf(gameCatalog));
  });

  it.each(snapshots.slice(1).map((snapshot, index) => [snapshots[index]!, snapshot] as const))(
    'entfernen und widmen keinen Schlüssel um: %#',
    (previous, current) => {
      expect(catalogChanges(previous, current)).toEqual({ removed: [], rededicated: [] });
    },
  );

  it('lassen die Schnappschüsse auf main unverändert bestehen', () => {
    // Die CI holt `main` dafür nach (.github/workflows/ci.yml). Ein gelöschter oder geänderter
    // Schnappschuss würde sonst die Prüfung gegen die vorige Version umgehen.
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
    const root = git('rev-parse', '--show-toplevel').trim();
    let onMain: string[];
    try {
      onMain = git('ls-tree', '-r', '--name-only', '--full-tree', 'origin/main', '--', 'packages/game-rules/catalog-versions/').split('\n');
    } catch (error) {
      throw new Error('origin/main fehlt; zuerst `git fetch origin main` ausführen', { cause: error });
    }
    for (const path of onMain.filter((file) => file.endsWith('.json'))) {
      expect(readFileSync(join(root, path), 'utf8'), path).toBe(git('show', `origin/main:${path}`));
    }
  });
});
