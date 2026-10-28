import type { MomoForm } from '@abnehm/contracts/island';

import { endlessAreaKey, type GameCatalog } from './catalog.ts';

// Freischaltungen und Entwicklungsformen (Spezifikation 4, Abschnitt 5; Formlevel aus #69). Was ein
// Level freischaltet, steht im Katalog; fehlt dort ein Eintrag, zählt das Level trotzdem.

/** Die acht Entwicklungsformen mit ihrer Formschwelle; ab Level 4 schaltet jede ein Gebiet frei. */
const forms: readonly (readonly [level: number, form: MomoForm])[] = [
  [1, 'kaulquappe'],
  [4, 'huepfer'],
  [8, 'krabbler'],
  [13, 'aufrechter'],
  [19, 'springer'],
  [26, 'spirale'],
  [34, 'fluegling'],
  [43, 'lagunendrache'],
];

/** Formlevel ab 4: an ihnen schaltet ein festes Gebiet frei. */
export const areaLevels: readonly number[] = forms.slice(1).map(([level]) => level);

/** Nach dem siebten Gebiet folgt alle 6 Level ein endloses Gebiet: `43 + 6k`, k ≥ 1. */
const lastFormLevel = 43;
const endlessEvery = 6;

export type UnlockedBlueprint = Readonly<{ key: string; reason: 'start' | 'level' | 'entdeckung' }>;

export type UnlockedArea =
  | Readonly<{ type: 'gebiet'; key: string }>
  | Readonly<{ type: 'endlos'; key: string; template: string; k: number }>;

export type LevelUnlocks = Readonly<{
  level: number;
  blueprints: readonly UnlockedBlueprint[];
  /** Neue Entwicklungsform an diesem Level; beim Schlüpfen Form 1. */
  form: MomoForm | null;
  area: UnlockedArea | null;
}>;

/** Die Form mit der höchsten Formschwelle ≤ Level. */
export function formAt(level: number): MomoForm {
  assertLevel(level);
  return forms.findLast(([from]) => from <= level)![1];
}

/**
 * Was Level L freischaltet. Level 1 ist das Schlüpfen mit den Start-Bauplänen beider Rollen. Ab Level 2
 * kommt die Level-Freischaltung je Rolle, an Formlevels dazu Form, Gebiet und dessen zwei
 * Entdeckungs-Baupläne je Rolle, ab Level 49 alle 6 Level ein endloses Gebiet aus der nächsten
 * Landschaftsvorlage mit deren wiederverwendetem Entdeckungs-Bauplan je Rolle.
 */
export function unlocksAt(catalog: GameCatalog, level: number): LevelUnlocks {
  assertLevel(level);
  if (level === 1) {
    return {
      level,
      blueprints: catalog.blueprints.filter((b) => b.origin === 'start').map((b) => ({ key: b.key, reason: 'start' })),
      form: formAt(1),
      area: null,
    };
  }

  const blueprints: UnlockedBlueprint[] = catalog.levelUnlocks
    .filter((unlock) => unlock.level === level)
    .map((unlock) => ({ key: unlock.blueprint, reason: 'level' }));
  const discovered = (keys: readonly string[]) => keys.forEach((key) => blueprints.push({ key, reason: 'entdeckung' }));

  const formLevel = forms.some(([from]) => from === level);
  const fixedArea = formLevel ? catalog.areas.find((area) => area.unlockLevel === level) : undefined;
  if (fixedArea !== undefined) {
    discovered([...fixedArea.discoveryBlueprints.bauen, ...fixedArea.discoveryBlueprints.natur]);
    return { level, blueprints, form: formAt(level), area: { type: 'gebiet', key: fixedArea.key } };
  }

  const k = (level - lastFormLevel) / endlessEvery;
  const template = Number.isInteger(k) && k >= 1 ? catalog.landscapeTemplates[(k - 1) % catalog.landscapeTemplates.length] : undefined;
  if (template !== undefined) {
    discovered([template.discoveryBlueprints.bauen, template.discoveryBlueprints.natur]);
    return { level, blueprints, form: null, area: { type: 'endlos', key: endlessAreaKey(k, template.key), template: template.key, k } };
  }

  return { level, blueprints, form: formLevel ? formAt(level) : null, area: null };
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`Level muss eine ganze Zahl ab 1 sein: ${level}`);
}
