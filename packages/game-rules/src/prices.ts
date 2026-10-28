import type { Blueprint, Stage } from './catalog.ts';
import { assertWholeNumber } from './whole-number.ts';

// Preise (Spezifikation 4, Abschnitt 3; Werte aus #18, nicht belegt). Ein Preis hängt nur vom
// Bauplan ab, nicht vom aktuellen Level.

const priceCap = 24;

/**
 * Grundpreis: `min(round(3 + 0,6 × P), 24)`, kaufmännisch gerundet; Start-Baupläne kosten fest 1, 2
 * oder 3. In Zehnteln gerechnet, damit kein Gleitkommafehler die Rundung kippt.
 */
export function basePrice(blueprint: Blueprint): number {
  if (blueprint.origin === 'start') return blueprint.startPrice;
  const level = assertWholeNumber(blueprint.priceLevel, 1, 'Preislevel');
  return Math.min(Math.floor((30 + 6 * level + 5) / 10), priceCap);
}

/** Aufwerten auf Stufe 2 kostet das 2-Fache, auf Stufe 3 das 3-Fache des Grundpreises. */
export function upgradePrice(blueprint: Blueprint, toStage: Exclude<Stage, 1>): number {
  return toStage * basePrice(blueprint);
}
