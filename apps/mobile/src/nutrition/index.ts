// App-Modul „Ernährung“ (Spezifikation 2, Abschnitt 1): die lokale Lebensmittelsuche (#154), die
// Befehle „Eintrag hinzufügen“ und „Rückgängig“ sowie die Abfragen Tagesprotokoll und Vorbelegung
// (#155), die Fotomahlzeit (#162), die eigenen Lebensmittel samt Suchindex (#157), Lebensmittelfavoriten
// und „Zuletzt verwendet“ (#158) sowie die Beiträge
// zu Tagesziel-Registry und Tages-Check-in und der Lese-Port `IntakeReader` (#166). Bildschirme sprechen
// nur mit dieser Schnittstelle, nie direkt mit Drizzle, SQLite oder Netzwerk. Kein anderer Bereich liest
// die Ernährungstabellen.
//
// Dieser Einstieg lädt weder React Native noch expo-sqlite, damit Node-Integrationstests das Modul
// laden. Den mitgelieferten BLS-Katalog öffnet `BlsCatalogProvider` mit eigenem Einstieg
// (`./BlsCatalogProvider`), wie `CatalogProvider` neben `local-db/index.ts`.
export { appNutrition, useNutrition } from './app-nutrition';
export { nutritionDailyGoals, readNutritionDayFacts, type NutritionDayFacts } from './daily-goal-evaluators';
export type { DayLog, DayLogEntry, DayLogMeal, EntryDetail } from './day-log';
export type { FoodChoice } from './current-foods';
export type { FavoriteFood } from './food-favorites';
export { foodFavoriteEntity } from './food-favorite-entity';
export { intakeReaderOf } from './intake-reader';
export { InvalidNutritionInputError, type EntryChange, type NewEntry } from './entries';
export { nutritionEntryEntity } from './entry-entity';
export type { FoodSearch, FoodSearchHit, FoodSearchResult, SearchMark } from './food-search';
export { mealPhotoEntity, confirmPhotoDraftCommand, type MealPhotoDetail, type PhotoDraftConfirmation, type PhotoMealComponent } from './meal-photos';
export { createHttpMealPhotoImages, type MealPhotoImage, type MealPhotoImages } from './photo-images';
export { ownFoodEntity } from './own-food-entity';
export { rebuildOwnFoodIndex, type OwnFoodChoice } from './own-food-repository';
export type { OwnFoodBase } from './own-foods';
export type { QuickFood, QuickFoods } from './quick-foods';
export { createNutrition, type AmountPrefill, type Nutrition, type NutritionDependencies } from './nutrition';
