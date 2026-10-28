import { EnergyBooking } from '@abnehm/contracts/energy';

import { baseIsland } from '../content/base-island.ts';
import { rect } from '../content/layout.ts';
import type { Area, Blueprint, Deko, GameCatalog, LandscapeTemplate } from '../src/catalog.ts';

// Fixtures der Spielregeln; nur in Tests verwenden.
//
// Tracer (#179): Dieselben Buchungsfakten rechnen App (Jest) und Server (Vitest) mit dem ausgelieferten
// Katalog und müssen dieselben Werte erhalten. Die erwarteten Werte sind von Hand gerechnet.

const philipp = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const anna = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02';
const project = '7a2e4c6b-1d3f-4b5a-8c9e-0f1a2b3c4d02';
const objects = Array.from({ length: 4 }, (_, i) => `3e5f7a9b-2c4d-4e6f-8a1b-3c5d7e9f1b0${i + 1}`);
const commands = Array.from({ length: 9 }, (_, i) => `4f6a8b0c-3d5e-4f7a-9b2c-4d6e8f0a2c0${i + 1}`);

const at = { localDate: '2026-10-14', createdAt: '2026-10-14T12:00:00.000Z' };
const spend = (personId: string, command: string, amount: number, trigger: Record<string, unknown>, type: string) =>
  EnergyBooking.parse({ type, id: command, personId, ...at, amount, bookingKey: command, trigger: { commandId: command, ...trigger } });
const build = (personId: string, command: string, amount: number, islandObjectId: string) =>
  spend(personId, command, amount, { islandObjectId }, 'build_debit');
const credit = (personId: string, completion: string, slot: 1 | 2 | 3) =>
  EnergyBooking.parse({
    type: 'daily_goal_credit', id: completion, personId, ...at, amount: 1, bookingKey: `tagesziel:${personId}:${at.localDate}:${slot}`,
    trigger: { dailyGoalCompletionId: completion, slot },
  });

export const tracer = {
  island: { objectIds: new Set(objects), projectIds: new Set([project]) },
  bookings: {
    // 1 + 3 + 6 + 5 = 15 verbaut; die Gutschrift zählt nicht.
    philipp: [
      credit(philipp, commands[0]!, 1),
      build(philipp, commands[1]!, -1, objects[0]!), // Holzweg
      build(philipp, commands[2]!, -3, objects[1]!), // Laterne
      spend(philipp, commands[3]!, -6, { islandObjectId: objects[1], toLevel: 2 }, 'upgrade_debit'),
      spend(philipp, commands[4]!, -5, { projectId: project }, 'project_contribution_debit'),
    ],
    // 2 + 3 + 7 = 12 verbaut.
    anna: [
      build(anna, commands[5]!, -2, objects[2]!), // Beerenstrauch
      build(anna, commands[6]!, -3, objects[3]!), // Apfelbaum
      spend(anna, commands[7]!, -7, { projectId: project }, 'project_contribution_debit'),
    ],
  },
  startBlueprint: 'laterne',
  /** Beide ≥ Schwelle(2) = 11, < Schwelle(3) = 23; Bedarf(2) = 12: 4/12 → 33 %, 1/12 → 8 %. */
  expected: {
    spent: [15, 12],
    progress: { level: 2, levelNeed: 12, halves: [{ percent: 33, full: false }, { percent: 8, full: false }] },
    startPrice: 3,
  },
} as const;

// Test-Katalog für Regeln, die der ausgelieferte Katalog noch nicht abdeckt: Level-Freischaltungen,
// Gebiete, Landschaftsvorlagen und Deko. Er ist für sich gültig (`checkCatalog`) und unabhängig von
// späteren Inhalten.

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
