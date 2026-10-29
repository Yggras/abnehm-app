import type { Season } from '@abnehm/game-rules/catalog';

import type { Daytime } from './scene-model';

/** Texte der Inselansicht (nur Deutsch). */
export const islandTexts = {
  season: { fruehling: 'Frühling', sommer: 'Sommer', herbst: 'Herbst', winter: 'Winter' } satisfies Record<Season, string>,
  daytime: { tag: 'Tag', abend: 'Abend' } satisfies Record<Daytime, string>,
  energy: (energy: number) => `${energy} Energie`,
  energyUnit: 'Energie',
  areas: 'Bereiche',
  entries: { lager: 'Lager', projekt: 'Projekt', bauen: 'Bauen', ereignisse: 'Ereignisse' },
  newEvents: (count: number) => `Ereignisse, ${count} neu`,
};
