// App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1). Bisher: der mitgelieferte BLS-Katalog und die
// lokale Lebensmittelsuche (#154). Bildschirme sprechen nur mit dieser Schnittstelle, nie direkt mit
// SQLite.
export { BlsCatalogProvider, useFoodSearch } from './BlsCatalogProvider';
export { createFoodSearch, type FoodSearch, type FoodSearchHit, type FoodSearchResult, type SearchMark } from './food-search';
