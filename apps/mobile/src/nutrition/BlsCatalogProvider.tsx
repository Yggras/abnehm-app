import { useMemo, type ReactNode } from 'react';

import type { BundledCatalog } from '../local-db';
import { CatalogProvider, useCatalogDatabase } from '../local-db/CatalogProvider';
import { blsCatalogVersion } from './bls-catalog-version';
import { createFoodSearch, type FoodSearch } from './food-search';

// Der mitgelieferte BLS-Katalog (Spezifikation 2, Abschnitt 3). Bildschirme, die Lebensmittel suchen,
// liegen innerhalb von `BlsCatalogProvider` und suchen mit `useFoodSearch`.

const blsCatalog: BundledCatalog = {
  databaseName: 'bls-katalog.db',
  version: blsCatalogVersion,
  // Metro bündelt `.db` als Asset (Standard-`assetExts` von expo/metro-config).
  assetId: require('../../assets/catalog/bls-katalog.db'),
};

export function BlsCatalogProvider({ children }: { children: ReactNode }) {
  return <CatalogProvider catalog={blsCatalog}>{children}</CatalogProvider>;
}

/** Die lokale Lebensmittelsuche; nur innerhalb von `BlsCatalogProvider`. */
export function useFoodSearch(): FoodSearch {
  const catalog = useCatalogDatabase();
  return useMemo(() => createFoodSearch({ catalog }), [catalog]);
}
