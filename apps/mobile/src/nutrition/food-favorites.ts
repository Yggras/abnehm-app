import { EntityId, Instant } from '@abnehm/contracts/base';
import { foodFavoriteId, FoodFavoriteUpsert, foodRefKey, foodValuesOf, type FoodRef, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { foodIdentity, type CurrentFoods } from './current-foods';
import { InvalidNutritionInputError } from './entries';
import { lastUseByRef, latestAmountOf } from './entry-repository';
import { foodFavoriteEntity } from './food-favorite-entity';
import { markedFoodFavorites, readFoodFavorite, writeFoodFavorite, type MarkedFoodFavorite } from './food-favorite-repository';
import type { NutritionDependencies } from './nutrition';
import { livingOwnFood, ownFoodWithValues } from './own-food-repository';
import { saveOwnFood } from './own-foods';
import { quickFood, resolveFood, uniqueFoods, type QuickFood } from './quick-foods';
import { searchNames } from './search-text';

// Lebensmittelfavoriten (Spezifikation 2, Abschnitt 7; #158): Markieren und Entfernen in Mengenprüfung
// und Eintragsdetails, die Liste des Hinzufügen-Bildschirms und „Folgen und Rückfall“. Befehle laufen in
// der Transaktion des Aufrufers: Zeile und Outbox-Operation entstehen gemeinsam. Ein Favorit betrifft
// keinen Tag; die Befehle melden deshalb nichts an `reevaluateDailyGoals`.
//
// Ein Favorit gilt für das Lebensmittel, für das seine Referenz heute steht (`foodIdentity`): Überdeckt ein
// eigenes Lebensmittel die Quelle, zeigt die Liste es an ihrer Stelle, und Markierung und Entfernen in der
// Mengenprüfung des eigenen Lebensmittels betreffen auch den Favoriten der Quelle.

type FavoriteDependencies = Pick<NutritionDependencies, 'clock' | 'writer' | 'newId'>;

/** Ein Lebensmittel, das die Person markiert: mit Referenz oder als KI-Schätzung ohne (`ref: null`). */
export type FavoriteFood = Readonly<{ ref: FoodRef | null; snapshot: NutritionSnapshot }>;

/** Wofür ein Favorit stehen kann: eine Referenz oder eine KI-Schätzung ohne, erkannt an ihrem Snapshot. */
export type FavoriteTarget = Readonly<{ ref: FoodRef }> | Readonly<{ ref: null; snapshot: NutritionSnapshot }>;

/**
 * Markiert ein Lebensmittel als Favorit und liefert die Referenz des Favoriten. Eine KI-Schätzung ohne
 * Referenz wird zuerst zu einem eigenen Lebensmittel aus ihrem Snapshot; hat ein früheres Markieren es schon
 * angelegt, gilt dieses. Ein schon markierter Favorit bleibt, wie er ist. Wirft `InvalidNutritionInputError`,
 * ohne zu schreiben, wenn Referenz und Fassung nicht zusammenpassen.
 */
export function markFoodFavorite(tx: TransactionContext, dependencies: FavoriteDependencies, food: FavoriteFood): FoodRef {
  const choice = food.ref === null
    ? (ownFoodWithValues(tx, foodValuesOf(food.snapshot)) ?? saveOwnFood(tx, dependencies, null, foodValuesOf(food.snapshot)))
    : // Ein verfügbares eigenes Lebensmittel speichert seine aktuelle Fassung, nicht den älteren Snapshot eines Eintrags.
      food.ref.type === 'eigen' ? (livingOwnFood(tx, food.ref.key) ?? { ref: food.ref, snapshot: food.snapshot }) : { ref: food.ref, snapshot: food.snapshot };
  const parsed = FoodFavoriteUpsert.safeParse({ foodRef: choice.ref, snapshot: choice.snapshot, removedAt: null });
  if (!parsed.success) throw new InvalidNutritionInputError(`Ungültiger Lebensmittelfavorit: ${parsed.error.message}`);
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const entityId = foodFavoriteId(personId, choice.ref);
  const existing = readFoodFavorite(tx, entityId);
  if (existing === undefined || existing.content.removedAt !== null) persist(tx, dependencies, entityId, personId, parsed.data);
  return choice.ref;
}

/** Entfernt die Markierung aller Favoriten, die für dieses Lebensmittel stehen; ohne Favorit bleibt alles, wie es ist. */
export function unmarkFoodFavorite(tx: TransactionContext, dependencies: FavoriteDependencies, food: FavoriteTarget): void {
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const removedAt = Instant.parse(dependencies.clock.read().instant);
  for (const favorite of favoritesOf(tx, personId, food)) persist(tx, dependencies, favorite.id, personId, { ...favorite.content, removedAt });
}

/** Ob ein markierter Favorit für dieses Lebensmittel steht. */
export function isFoodFavorite(tx: ReadContext, food: FavoriteTarget): boolean {
  const own = requireOwnPerson(tx);
  return favoritesOf(tx, EntityId.parse(own.id), food).length > 0;
}

/**
 * „Verwenden“ eines Favoriten (Spezifikation 2, Abschnitt 7): Ist seine Referenz verfügbar, wird die
 * gespeicherte Fassung auf ihre aktuellen Werte gebracht. Gespeichert wird nur die Fassung genau dieser
 * Referenz, damit der Rückfall zu ihr passt; eine Überdeckung wirkt erst beim Auflösen.
 */
export function refreshFoodFavorites(tx: TransactionContext, dependencies: FavoriteDependencies, foods: CurrentFoods, ref: FoodRef): void {
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  for (const favorite of favoritesOf(tx, personId, { ref })) {
    const snapshot = foods.exact(tx, favorite.content.foodRef);
    if (snapshot === null || sameSnapshot(snapshot, favorite.content.snapshot)) continue;
    persist(tx, dependencies, favorite.id, personId, { ...favorite.content, snapshot });
  }
}

/**
 * Die Lebensmittelfavoriten des Hinzufügen-Bildschirms: je Lebensmittel einmal, zuletzt verwendete zuerst,
 * nie verwendete danach nach Name. Ist die Referenz verfügbar, gelten die aktuellen Werte, sonst die letzte
 * Fassung. Vorbelegt ist die zuletzt verwendete Menge, sonst eine Portion, sonst 100 g bzw. ml.
 */
export function favoriteFoods(tx: ReadContext, foods: CurrentFoods, personId: EntityId): QuickFood[] {
  const lastUse = lastUseByRef(tx, personId);
  const resolved = markedFoodFavorites(tx, personId).map((favorite) => {
    const food = resolveFood(tx, foods, favorite.content.foodRef, favorite.content.snapshot);
    return { ...food, lastUse: lastUse.get(foodRefKey(food.choice.ref)) ?? null, sortName: searchNames(food.choice.snapshot.name).searchName };
  });
  resolved.sort((a, b) => {
    if (a.lastUse !== b.lastUse) return a.lastUse === null ? 1 : b.lastUse === null ? -1 : a.lastUse < b.lastUse ? 1 : -1;
    return a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0;
  });
  return uniqueFoods(resolved).map((food) => quickFood(food, latestAmountOf(tx, personId, food.choice.ref)));
}

/**
 * Die markierten Favoriten der Person, die für dasselbe Lebensmittel stehen. Eine KI-Schätzung ohne
 * Referenz (`snapshot` gegeben) steht für das eigene Lebensmittel, das ein früheres Markieren aus ihr
 * angelegt hat; ohne ein solches gibt es keinen Favoriten.
 */
function favoritesOf(tx: ReadContext, personId: EntityId, food: FavoriteTarget): MarkedFoodFavorite[] {
  const ref = food.ref ?? ownFoodWithValues(tx, foodValuesOf(food.snapshot))?.ref;
  if (ref === undefined) return [];
  const identity = foodRefKey(foodIdentity(tx, ref));
  return markedFoodFavorites(tx, personId).filter((favorite) => foodRefKey(foodIdentity(tx, favorite.content.foodRef)) === identity);
}

function persist(tx: TransactionContext, { clock, writer }: FavoriteDependencies, entityId: EntityId, personId: EntityId, payload: FoodFavoriteUpsert): void {
  const knownServerVersion = readFoodFavorite(tx, entityId)?.serverVersion ?? null;
  writeFoodFavorite(tx, entityId, personId, payload, Instant.parse(clock.read().instant));
  writer.upsert(tx, { entityType: foodFavoriteEntity.entityType, entityId, payload, knownServerVersion });
}

function sameSnapshot(a: NutritionSnapshot, b: NutritionSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
