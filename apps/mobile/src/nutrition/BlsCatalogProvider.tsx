import type { MealKey } from '@abnehm/contracts/base';
import type { FoodRef } from '@abnehm/contracts/nutrition';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { BundledCatalog } from '../local-db';
import { CatalogProvider, useCatalogDatabase } from '../local-db/CatalogProvider';
import { blsCatalogVersion } from './bls-catalog-version';
import type { FoodSearch } from './food-search';
import type { Nutrition } from './nutrition';
import type { QuickFoods } from './quick-foods';

// Der mitgelieferte BLS-Katalog (Spezifikation 2, Abschnitt 3). Bildschirme, die Lebensmittel suchen,
// liegen innerhalb von `BlsCatalogProvider`, suchen mit `useFoodSearch` und zeigen „Zuletzt verwendet“ und
// die Lebensmittelfavoriten mit `useQuickFoods`.

const blsCatalog: BundledCatalog = {
  databaseName: 'bls-katalog.db',
  version: blsCatalogVersion,
  // Metro bündelt `.db` als Asset (Standard-`assetExts` von expo/metro-config).
  assetId: require('../../assets/catalog/bls-katalog.db'),
};

export function BlsCatalogProvider({ children }: { children: ReactNode }) {
  return <CatalogProvider catalog={blsCatalog}>{children}</CatalogProvider>;
}

/** Die lokale Lebensmittelsuche des Ernährungsmoduls über diesem Katalog; nur innerhalb von `BlsCatalogProvider`. */
export function useFoodSearch(nutrition: Nutrition, meal: MealKey): FoodSearch {
  const catalog = useCatalogDatabase();
  return useMemo(() => nutrition.foodSearch(catalog, meal), [nutrition, catalog, meal]);
}

/** „Zuletzt verwendet“ der Mahlzeit und die Lebensmittelfavoriten; `null`, bis die erste Abfrage gelaufen ist. */
export function useQuickFoods(nutrition: Nutrition, meal: MealKey): QuickFoods | null {
  const catalog = useCatalogDatabase();
  const [foods, setFoods] = useState<QuickFoods | null>(null);
  useEffect(() => nutrition.observeQuickFoods(catalog, meal, setFoods), [nutrition, catalog, meal]);
  return foods;
}

/** „Verwenden“ eines Favoriten: bringt seine gespeicherte Fassung auf die aktuellen Werte (Spezifikation 2, Abschnitt 7). */
export function useRecordFavoriteUse(nutrition: Nutrition): (ref: FoodRef) => void {
  const catalog = useCatalogDatabase();
  return useCallback((ref: FoodRef) => nutrition.recordFavoriteUse(catalog, ref), [nutrition, catalog]);
}
