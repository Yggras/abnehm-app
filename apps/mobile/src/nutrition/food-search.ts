import { entryAmount, entryTotals, roundKcal, type FoodRef, type NutritionSnapshot, type OwnFoodOrigin } from '@abnehm/contracts/nutrition';

import type { CatalogDatabase } from '../local-db';
import { createBlsCatalog } from './bls-catalog';
import type { OwnFoodChoice } from './own-food-repository';
import { searchQuery, type SearchQuery } from './search-text';

// Lokale Lebensmittelsuche des Moduls „Ernährung“ (Spezifikation 2, Abschnitt 4). Sie läuft bei jeder
// Eingabe ab zwei Buchstaben oder Ziffern, ohne Netz. Die Treffer kommen in Gruppen in fester Rangfolge: Favoriten,
// „Zuletzt verwendet“, eigene Lebensmittel, gescannte Produkte, BLS. Bisher gibt es die Gruppen eigene
// Lebensmittel (#157) und BLS; spätere Tickets (#158, #160) ergänzen ihre Gruppe in `groups`, ohne die
// Schnittstelle zu ändern. Ein eigenes Lebensmittel mit Herkunftsreferenz überdeckt seine Quelle: Sie erscheint
// nur einmal, als eigenes Lebensmittel (Spezifikation 2, Abschnitt 3).

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

/** Die eigenen Lebensmittel der Kontodatenbank, wie die Suche sie braucht. */
export type OwnFoodLookup = Readonly<{
  /** Nicht gelöschte eigene Lebensmittel zur Anfrage, in Rangfolge, höchstens `limit`. */
  search(query: SearchQuery, limit: number): OwnFoodChoice[];
  /** Überdeckte Quellen: die Herkunftsreferenzen der nicht gelöschten eigenen Lebensmittel. */
  overlaidOrigins(): readonly OwnFoodOrigin[];
}>;

export function createFoodSearch(sources: { catalog: CatalogDatabase; ownFoods: OwnFoodLookup }): FoodSearch {
  const bls = createBlsCatalog(sources.catalog);
  const { ownFoods } = sources;
  const groups: readonly SearchGroup[] = [
    (query, limit) => ownFoods.search(query, limit).map(({ ref, snapshot }) => hit('eigen', ref, snapshot)),
    (query, limit) => {
      // Überdeckte BLS-Lebensmittel fallen heraus; so viele mehr werden gelesen, damit `limit` reicht.
      const overlaid = new Set(ownFoods.overlaidOrigins().flatMap((origin) => (origin.type === 'bls' ? [origin.key] : [])));
      return bls
        .search(query, limit + overlaid.size)
        .filter(({ key }) => !overlaid.has(key))
        .slice(0, limit)
        .map(({ key, snapshot }) => hit('bls', { type: 'bls', key }, snapshot));
    },
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

function hit(mark: SearchMark, ref: FoodRef, snapshot: NutritionSnapshot): FoodSearchHit {
  // 100 g bzw. 100 ml sind immer eine gültige Menge der Basiseinheit (höchstens 5 kg bzw. 5 l).
  const hundred = entryAmount(snapshot, snapshot.baseUnit, 100_000);
  if (hundred.type === 'problem') throw new Error(`100 ${snapshot.baseUnit} ergeben ${hundred.problem}`);
  return { mark, ref, snapshot, kcalPer100: roundKcal(entryTotals(snapshot, hundred.amount).milliKcal) };
}
