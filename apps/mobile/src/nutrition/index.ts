// App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1): der mitgelieferte BLS-Katalog und die lokale
// Lebensmittelsuche (#154), die Befehle „Eintrag hinzufügen“ und „Rückgängig“ sowie die Abfragen
// Tagesprotokoll und Vorbelegung (#155). Bildschirme sprechen nur mit dieser Schnittstelle, nie direkt
// mit Drizzle, SQLite oder Netzwerk. Kein anderer Bereich liest die Ernährungstabellen.
export { BlsCatalogProvider, useFoodSearch } from './BlsCatalogProvider';
export type { DayLog, DayLogEntry, DayLogMeal } from './day-log';
export { InvalidNutritionInputError, type NewEntry } from './entries';
export { nutritionEntryEntity } from './entry-entity';
export { createFoodSearch, type FoodSearch, type FoodSearchHit, type FoodSearchResult, type SearchMark } from './food-search';
export { createNutrition, type AmountPrefill, type Nutrition, type NutritionDependencies } from './nutrition';
