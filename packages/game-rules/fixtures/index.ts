import { baseIsland } from '../content/base-island.ts';
import { rect } from '../content/layout.ts';
import type { Area, Blueprint, Deko, GameCatalog, LandscapeTemplate } from '../src/catalog.ts';

// Test-Katalog für Regeln, die der ausgelieferte Katalog noch nicht abdeckt: Level-Freischaltungen,
// Gebiete, Landschaftsvorlagen und Deko. Er ist für sich gültig (`checkCatalog`) und unabhängig von
// späteren Inhalten; nur in Tests verwenden.

const stages = (key: string) => [`${key}_1`, `${key}_2`, `${key}_3`] as const;
const blueprint = (key: string, role: Blueprint['role'], origin: 'level' | 'entdeckung' | 'besucher', priceLevel: number): Blueprint => ({
  key, name: key, role, origin, priceLevel, art: stages(key),
});
const deko = (key: string): Deko => ({ key, name: key, origin: 'entdeckung', art: key });

/** Feldplan eines Gebiets: je Seite 10 Felder Ecke und 30 Rollenbereich, 16 × 5 ab (x, y). */
export function areaFields(x: number, y: number) {
  return [
    ...rect(x, y, 2, 5, { kind: 'ecke', side: 'a' } as const),
    ...rect(x + 2, y, 6, 5, { kind: 'rollenbereich', side: 'a' } as const),
    ...rect(x + 8, y, 6, 5, { kind: 'rollenbereich', side: 'b' } as const),
    ...rect(x + 14, y, 2, 5, { kind: 'ecke', side: 'b' } as const),
  ];
}

const area = (number: number, unlockLevel: number, y: number): Area => ({
  key: `t_gebiet_${number}`,
  name: `Testgebiet ${number}`,
  unlockLevel,
  fields: areaFields(0, y),
  discoveryBlueprints: {
    bauen: [`t_ent_bauen_${number}a`, `t_ent_bauen_${number}b`],
    natur: [`t_ent_natur_${number}a`, `t_ent_natur_${number}b`],
  },
  discoveryDeko: [`t_ent_deko_${number}`],
});

const template = (name: string, reuse: number): LandscapeTemplate => ({
  key: `t_vorlage_${name}`,
  name: `Testvorlage ${name}`,
  fields: areaFields(0, 0),
  discoveryBlueprints: { bauen: `t_ent_bauen_${reuse}a`, natur: `t_ent_natur_${reuse}a` },
});

const areas = [area(1, 4, -5), area(2, 8, -10)];

export function testCatalog(): GameCatalog {
  return {
    version: 1,
    blueprints: [
      { key: 't_weg', name: 'Weg', role: 'bauen', origin: 'start', startPrice: 1, art: stages('t_weg') },
      { key: 't_bank', name: 'Bank', role: 'bauen', origin: 'start', startPrice: 2, art: stages('t_bank') },
      { key: 't_laterne', name: 'Laterne', role: 'bauen', origin: 'start', startPrice: 3, art: stages('t_laterne') },
      { key: 't_blumen', name: 'Blumen', role: 'natur', origin: 'start', startPrice: 1, art: stages('t_blumen') },
      { key: 't_busch', name: 'Busch', role: 'natur', origin: 'start', startPrice: 2, art: stages('t_busch') },
      { key: 't_baum', name: 'Baum', role: 'natur', origin: 'start', startPrice: 3, art: stages('t_baum') },
      blueprint('t_bauen_2', 'bauen', 'level', 2),
      blueprint('t_natur_2', 'natur', 'level', 2),
      blueprint('t_bauen_4', 'bauen', 'level', 4),
      blueprint('t_natur_4', 'natur', 'level', 4),
      ...areas.flatMap((a) => [
        ...a.discoveryBlueprints.bauen.map((key) => blueprint(key, 'bauen', 'entdeckung', a.unlockLevel)),
        ...a.discoveryBlueprints.natur.map((key) => blueprint(key, 'natur', 'entdeckung', a.unlockLevel)),
      ]),
    ],
    levelUnlocks: [
      { level: 2, role: 'bauen', blueprint: 't_bauen_2' },
      { level: 2, role: 'natur', blueprint: 't_natur_2' },
      { level: 4, role: 'bauen', blueprint: 't_bauen_4' },
      { level: 4, role: 'natur', blueprint: 't_natur_4' },
    ],
    baseIsland,
    areas,
    landscapeTemplates: [template('erste', 1), template('zweite', 2)],
    deko: areas.flatMap((a) => a.discoveryDeko.map(deko)),
    visitorTemplates: [],
    accessories: [],
    projects: [{ key: 't_projekt', name: 'Testprojekt', landmark: 't_projekt', site: 'grundinsel:7:2' }],
    challengeTemplates: [],
  };
}
