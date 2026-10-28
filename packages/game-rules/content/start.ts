import type { Blueprint, ProjectTemplate } from '../src/catalog.ts';

// Inhalt zum Schlüpfen (Spezifikation 4, Abschnitt 5): je Rolle drei Start-Baupläne zu 1, 2 und 3
// Energie und Gemeinschaftsprojekt 1. Motive beim Schneiden von #179 gewählt (Designwerte, nicht
// belegt); die Grafiken je Stufe kommen mit dem Bau-Modus (#192), das Wahrzeichen mit #209.

const stages = (key: string) => [`${key}_1`, `${key}_2`, `${key}_3`] as const;

export const startBlueprints: readonly Blueprint[] = [
  { key: 'holzweg', name: 'Holzweg', role: 'bauen', origin: 'start', startPrice: 1, art: stages('holzweg') },
  { key: 'sitzbank', name: 'Sitzbank', role: 'bauen', origin: 'start', startPrice: 2, art: stages('sitzbank') },
  { key: 'laterne', name: 'Laterne', role: 'bauen', origin: 'start', startPrice: 3, art: stages('laterne') },
  { key: 'blumenwiese', name: 'Blumenwiese', role: 'natur', origin: 'start', startPrice: 1, art: stages('blumenwiese') },
  { key: 'beerenstrauch', name: 'Beerenstrauch', role: 'natur', origin: 'start', startPrice: 2, art: stages('beerenstrauch') },
  { key: 'apfelbaum', name: 'Apfelbaum', role: 'natur', origin: 'start', startPrice: 3, art: stages('apfelbaum') },
];

/** Gemeinschaftsprojekt 1, wie im Prototyp von #28 ein Gartenhäuschen. */
export const firstProject: ProjectTemplate = {
  key: 'gartenhaeuschen',
  name: 'Gartenhäuschen',
  landmark: 'gartenhaeuschen',
  site: 'grundinsel:7:2',
};
