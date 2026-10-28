import { entryTotals, roundKcal, type BaseUnit, type FoodRef, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { CatalogDatabase } from '../local-db/catalog';
import { createBlsCatalog } from './bls-catalog';
import { searchQuery, type SearchQuery } from './search-text';

// Lokale Lebensmittelsuche des Moduls „Ernährung“ (Spezifikation 2, Abschnitt 4). Sie läuft bei jeder
// Eingabe ab zwei Zeichen, ohne Netz. Die Treffer kommen in Gruppen in fester Rangfolge: Favoriten,
// „Zuletzt verwendet“, eigene Lebensmittel, gescannte Produkte, BLS. Bisher gibt es nur die Gruppe
// BLS; spätere Tickets (#157, #158, #160) ergänzen ihre Gruppe in `groups`, ohne die Schnittstelle zu
// ändern.

/** Quellenmarke eines Treffers: Favorit, Zuletzt, Eigen, Produkt oder BLS. */
export type SearchMark = 'favorit' | 'zuletzt' | 'eigen' | 'produkt' | 'bls';

export type FoodSearchHit = Readonly<{
  mark: SearchMark;
  ref: FoodRef;
  /** Aktuelle Fassung des Lebensmittels; daraus entsteht der Snapshot eines Eintrags. */
  snapshot: NutritionSnapshot;
  /** Ganze kcal je 100 g bzw. 100 ml, je nach Basiseinheit des Snapshots. */
  kcalPer100: number;
}>;

/** `zu_kurz` unter zwei Zeichen; dann zeigt der Hinzufügen-Bildschirm seine übrigen Plätze. */
export type FoodSearchResult = { type: 'zu_kurz' } | { type: 'treffer'; hits: readonly FoodSearchHit[] };

export type FoodSearch = {
  search(input: string): FoodSearchResult;
};

/** Höchstzahl der Treffer über alle Gruppen (Designwert, nicht belegt). */
const maxHits = 50;

/** Eine Gruppe liefert ihre Treffer in Rangfolge, höchstens `limit`. */
type SearchGroup = (query: SearchQuery, limit: number) => FoodSearchHit[];

export function createFoodSearch(sources: { catalog: CatalogDatabase }): FoodSearch {
  const bls = createBlsCatalog(sources.catalog);
  const groups: readonly SearchGroup[] = [
    (query, limit) => bls.search(query, limit).map(({ key, snapshot }) => hit('bls', { type: 'bls', key }, snapshot)),
  ];

  return {
    search(input) {
      const query = searchQuery(input);
      if (query === null) return { type: 'zu_kurz' };
      const hits: FoodSearchHit[] = [];
      for (const group of groups) {
        if (hits.length >= maxHits) break;
        hits.push(...group(query, maxHits - hits.length));
      }
      return { type: 'treffer', hits };
    },
  };
}

const per100: Readonly<Record<BaseUnit, number>> = { g: 100_000, ml: 100 };

function hit(mark: SearchMark, ref: FoodRef, snapshot: NutritionSnapshot): FoodSearchHit {
  const milliKcal = entryTotals(snapshot, {
    baseAmount: per100[snapshot.baseUnit],
    displayUnit: snapshot.baseUnit,
    displayAmountMilli: 100_000,
  }).milliKcal;
  return { mark, ref, snapshot, kcalPer100: roundKcal(milliKcal) };
}
