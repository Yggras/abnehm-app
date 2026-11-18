// App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1): die lokale Lebensmittelsuche (#154), die
// Befehle „Eintrag hinzufügen“ und „Rückgängig“ sowie die Abfragen Tagesprotokoll und Vorbelegung
// (#155), die Fotomahlzeit (#162) und die eigenen Lebensmittel samt Suchindex (#157). Bildschirme sprechen nur mit dieser Schnittstelle, nie direkt mit Drizzle, SQLite oder
// Netzwerk. Kein anderer Bereich liest die Ernährungstabellen.
//
// Dieser Einstieg lädt weder React Native noch expo-sqlite, damit Node-Integrationstests das Modul
// laden. Den mitgelieferten BLS-Katalog öffnet `BlsCatalogProvider` mit eigenem Einstieg
// (`./BlsCatalogProvider`), wie `CatalogProvider` neben `local-db/index.ts`.
export { appNutrition, useNutrition } from './app-nutrition';
export type { DayLog, DayLogEntry, DayLogMeal } from './day-log';
export { InvalidNutritionInputError, type NewEntry } from './entries';
export { nutritionEntryEntity } from './entry-entity';
export type { FoodSearch, FoodSearchHit, FoodSearchResult, SearchMark } from './food-search';
export { mealPhotoEntity, confirmPhotoDraftCommand, type PhotoDraftConfirmation, type PhotoMealComponent } from './meal-photos';
export { ownFoodEntity } from './own-food-entity';
export { rebuildOwnFoodIndex, type OwnFoodChoice } from './own-food-repository';
export type { OwnFoodBase, OwnFoodValues } from './own-foods';
export { createNutrition, type AmountPrefill, type Nutrition, type NutritionDependencies } from './nutrition';
