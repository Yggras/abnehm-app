// App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1): die lokale Lebensmittelsuche (#154), die
// Befehle „Eintrag hinzufügen“ und „Rückgängig“ sowie die Abfragen Tagesprotokoll und Vorbelegung
// (#155). Bildschirme sprechen nur mit dieser Schnittstelle, nie direkt mit Drizzle, SQLite oder
// Netzwerk. Kein anderer Bereich liest die Ernährungstabellen.
//
// Dieser Einstieg lädt weder React Native noch expo-sqlite, damit Node-Integrationstests das Modul
// laden. Den mitgelieferten BLS-Katalog öffnet `BlsCatalogProvider` mit eigenem Einstieg
// (`./BlsCatalogProvider`), wie `CatalogProvider` neben `local-db/index.ts`.
export { appNutrition, useNutrition } from './app-nutrition';
export type { DayLog, DayLogEntry, DayLogMeal } from './day-log';
export { InvalidNutritionInputError, type NewEntry } from './entries';
export { nutritionEntryEntity } from './entry-entity';
export { createFoodSearch, type FoodSearch, type FoodSearchHit, type FoodSearchResult, type SearchMark } from './food-search';
export { mealPhotoEntity, confirmPhotoDraftCommand, type PhotoDraftConfirmation, type PhotoMealComponent } from './meal-photos';
export { createNutrition, type AmountPrefill, type Nutrition, type NutritionDependencies } from './nutrition';
