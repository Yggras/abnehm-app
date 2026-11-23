import { entryAmount, entryTotals, foodRefKey, roundKcal, type FoodRef, type NutritionSnapshot, type OwnFoodOrigin } from '@abnehm/contracts/nutrition';

import type { CatalogDatabase } from '../local-db';
import type { AmountPrefill } from './amount-prefill';
import { createBlsCatalog } from './bls-catalog';
import type { OwnFoodChoice } from './own-food-repository';
import type { QuickFood, QuickFoods } from './quick-foods';
import { rankName } from './ranked-search';
import { searchQuery, type SearchQuery } from './search-text';

// Lokale Lebensmittelsuche des Moduls „Ernährung“ (Spezifikation 2, Abschnitt 4). Sie läuft bei jeder
// Eingabe ab zwei Buchstaben oder Ziffern, ohne Netz. Die Treffer kommen in Gruppen in fester Rangfolge: Favoriten
// und „Zuletzt verwendet“ der gewählten Mahlzeit (#158), eigene Lebensmittel (#157), gescannte Produkte aus dem
// OFF-Cache (#160) und BLS. Jedes Lebensmittel erscheint nur einmal, in der
// ersten Gruppe, die es trifft. Ein eigenes Lebensmittel mit Herkunftsreferenz überdeckt seine Quelle: Sie
// erscheint nur einmal, als eigenes Lebensmittel (Spezifikation 2, Abschnitt 3).

/** Quellenmarke eines Treffers: Favorit, Zuletzt, Eigen, Produkt oder BLS. */
export type SearchMark = 'favorit' | 'zuletzt' | 'eigen' | 'produkt' | 'bls';

export type FoodSearchHit = Readonly<{
  mark: SearchMark;
  ref: FoodRef;
  /** Aktuelle Fassung des Lebensmittels; daraus entsteht der Snapshot eines Eintrags. */
  snapshot: NutritionSnapshot;
  /** Ganze kcal je 100 g bzw. 100 ml, je nach Basiseinheit des Snapshots. */
  kcalPer100: number;
  /** Vorbelegte Menge eines Favoriten oder Zuletzt-Treffers; sonst entscheidet die Mengenprüfung. */
  prefill?: AmountPrefill;
  /** Ob die Referenz verfügbar ist; ein Favorit oder Zuletzt-Treffer ohne sie zeigt seine gespeicherte Fassung. */
  available: boolean;
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

/** Was die Suche aus der Kontodatenbank braucht: eigene Lebensmittel, Favoriten und „Zuletzt verwendet“. */
export type AccountFoods = Readonly<{
  /** Nicht gelöschte eigene Lebensmittel zur Anfrage, in Rangfolge, höchstens `limit`. */
  search(query: SearchQuery, limit: number): OwnFoodChoice[];
  /** Vollständige gescannte Produkte des OFF-Caches zur Anfrage, in Rangfolge, höchstens `limit`. */
  searchProducts(query: SearchQuery, limit: number): readonly { barcode: string; snapshot: NutritionSnapshot }[];
  /** Überdeckte Quellen: die Herkunftsreferenzen der nicht gelöschten eigenen Lebensmittel. */
  overlaidOrigins(): readonly OwnFoodOrigin[];
  /** Lebensmittelfavoriten und „Zuletzt verwendet“ der Mahlzeit, aufgelöst wie auf dem Hinzufügen-Bildschirm (#158). */
  quickFoods(): QuickFoods;
}>;

export function createFoodSearch(sources: { catalog: CatalogDatabase; account: AccountFoods }): FoodSearch {
  const bls = createBlsCatalog(sources.catalog);
  const { account } = sources;
  /** Die Treffer einer kurzen Liste in der Rangfolge aus `ranked-search.ts`, sonst in ihrer Reihenfolge. */
  const quickGroup = (mark: 'favorit' | 'zuletzt', foods: readonly QuickFood[], query: SearchQuery, limit: number) =>
    foods
      .flatMap((food) => {
        const tier = rankName(query, food.snapshot.name);
        return tier === null ? [] : [{ food, tier }];
      })
      .sort((a, b) => a.tier - b.tier)
      .slice(0, limit)
      .map(({ food }) => hit(mark, food.ref, food.snapshot, { prefill: food.prefill, available: food.available }));
  const groups = (quick: () => QuickFoods): readonly SearchGroup[] => [
    (query, limit) => quickGroup('favorit', quick().favorites, query, limit),
    (query, limit) => quickGroup('zuletzt', quick().recent, query, limit),
    (query, limit) => account.search(query, limit).map(({ ref, snapshot }) => hit('eigen', ref, snapshot)),
    (query, limit) => {
      const overlaid = overlaidKeys('off');
      return account
        .searchProducts(query, limit + overlaid.size)
        .filter(({ barcode }) => !overlaid.has(barcode))
        .slice(0, limit)
        .map(({ barcode, snapshot }) => hit('produkt', { type: 'off', key: barcode }, snapshot));
    },
    (query, limit) => {
      const overlaid = overlaidKeys('bls');
      return bls
        .search(query, limit + overlaid.size)
        .filter(({ key }) => !overlaid.has(key))
        .slice(0, limit)
        .map(({ key, snapshot }) => hit('bls', { type: 'bls', key }, snapshot));
    },
  ];
  /**
   * Schlüssel der überdeckten Quellen einer Art. Sie fallen aus ihrer Gruppe heraus; so viele mehr werden
   * gelesen, damit `limit` reicht.
   */
  const overlaidKeys = (type: OwnFoodOrigin['type']) => new Set(account.overlaidOrigins().flatMap((origin) => (origin.type === type ? [origin.key] : [])));

  return {
    search(input) {
      const query = searchQuery(input);
      if (query === null) return { type: 'zu_kurz' };
      // Favoriten und „Zuletzt verwendet“ einmal je Suche, erst wenn eine Gruppe sie braucht.
      let quick: QuickFoods | undefined;
      const hits: FoodSearchHit[] = [];
      // Jedes Lebensmittel erscheint einmal, in der ersten Gruppe, die es trifft.
      const shown = new Set<string>();
      for (const group of groups(() => (quick ??= account.quickFoods()))) {
        if (hits.length >= maxHits) break;
        const fresh = group(query, maxHits - hits.length + shown.size).filter((candidate) => !shown.has(foodRefKey(candidate.ref)));
        for (const candidate of fresh.slice(0, maxHits - hits.length)) {
          shown.add(foodRefKey(candidate.ref));
          hits.push(candidate);
        }
      }
      return { type: 'treffer', hits };
    },
  };
}

function hit(
  mark: SearchMark,
  ref: FoodRef,
  snapshot: NutritionSnapshot,
  quick: Readonly<{ prefill?: AmountPrefill; available: boolean }> = { available: true },
): FoodSearchHit {
  // 100 g bzw. 100 ml sind immer eine gültige Menge der Basiseinheit (höchstens 5 kg bzw. 5 l).
  const hundred = entryAmount(snapshot, snapshot.baseUnit, 100_000);
  if (hundred.type === 'problem') throw new Error(`100 ${snapshot.baseUnit} ergeben ${hundred.problem}`);
  return { mark, ref, snapshot, kcalPer100: roundKcal(entryTotals(snapshot, hundred.amount).milliKcal), ...quick };
}
