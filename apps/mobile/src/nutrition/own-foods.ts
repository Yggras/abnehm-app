import { EntityId, Instant } from '@abnehm/contracts/base';
import { ownFoodBarcodeId, OwnFoodUpsert, ownFoodSnapshot, type FoodRef, type FoodValues, type OwnFoodOrigin } from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { InvalidNutritionInputError } from './entries';
import type { NutritionDependencies } from './nutrition';
import { ownFoodEntity } from './own-food-entity';
import { readOwnFood, tombstoneOwnFood, writeOwnFood, type OwnFoodChoice } from './own-food-repository';

// Befehle der eigenen Lebensmittel (Spezifikation 2, Abschnitt 3). Sie laufen in der Transaktion des
// Aufrufers: Zeile, Suchindex und Outbox-Operation entstehen gemeinsam. Ein eigenes Lebensmittel
// betrifft keinen Tag, denn Einträge tragen ihren Snapshot. Deshalb melden die Befehle keine Tage an
// `reevaluateDailyGoals`.
//
// Ein eigenes Lebensmittel mit Barcode-Herkunft hat die deterministische ID aus Person und Barcode
// (`ownFoodBarcodeId`, Spezifikation 2, Abschnitt 11; #160). Es lässt sich ändern, aber nicht löschen: Ein
// Tombstone wäre für Clientoperationen endgültig (Spezifikation 0, Abschnitt 10), und der Barcode ließe sich
// danach nie wieder korrigieren (Nutzerentscheidung vom 23.11.2026, #160).

/**
 * Was die Person ändert: `null` legt ein neues eigenes Lebensmittel an, ein eigenes ändert genau
 * dieses, ein BLS-Lebensmittel bzw. ein Barcode-Produkt wird zum eigenen Lebensmittel mit dieser
 * Herkunftsreferenz.
 */
export type OwnFoodBase = FoodRef | null;

type OwnFoodDependencies = Pick<NutritionDependencies, 'clock' | 'writer' | 'newId'>;

/**
 * Speichert die Werte als eigenes Lebensmittel und liefert Referenz und neue Fassung. Externe Daten
 * bleiben unverändert; gespeicherte Einträge behalten ihren Snapshot. Wirft
 * `InvalidNutritionInputError` bei ungültigen Werten oder einem fehlenden bzw. gelöschten eigenen
 * Lebensmittel, ohne etwas zu schreiben.
 */
export function saveOwnFood(tx: TransactionContext, { clock, writer, newId }: OwnFoodDependencies, base: OwnFoodBase, values: FoodValues): OwnFoodChoice {
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const target = targetOf(tx, personId, base, newId);
  const parsed = OwnFoodUpsert.safeParse({ ...values, origin: target.origin });
  if (!parsed.success) throw new InvalidNutritionInputError(`Ungültiges eigenes Lebensmittel: ${parsed.error.message}`);
  const payload = parsed.data;
  writeOwnFood(tx, target.id, personId, payload, Instant.parse(clock.read().instant));
  writer.upsert(tx, { entityType: ownFoodEntity.entityType, entityId: target.id, payload, knownServerVersion: target.knownServerVersion });
  return { ref: { type: 'eigen', key: target.id }, snapshot: ownFoodSnapshot(payload) };
}

/** Ob sich das eigene Lebensmittel löschen lässt: nicht gelöscht und ohne Barcode-Herkunft. */
export function isOwnFoodDeletable(tx: ReadContext, entityId: EntityId): boolean {
  const existing = readOwnFood(tx, entityId);
  return existing !== undefined && existing.deletedAt === null && existing.origin?.type !== 'off';
}

/**
 * Löscht ein eigenes Lebensmittel (Tombstone); ein schon gelöschtes bleibt, wie es ist. Wirft
 * `InvalidNutritionInputError` für eines mit Barcode-Herkunft, ohne etwas zu schreiben.
 */
export function deleteOwnFood(tx: TransactionContext, { clock, writer }: OwnFoodDependencies, entityId: EntityId): void {
  const existing = readOwnFood(tx, entityId);
  if (existing === undefined || existing.deletedAt !== null) return;
  if (existing.origin?.type === 'off') throw new InvalidNutritionInputError(`Eigenes Lebensmittel ${entityId} hat eine Barcode-Herkunft und lässt sich nicht löschen`);
  tombstoneOwnFood(tx, entityId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: ownFoodEntity.entityType, entityId, knownServerVersion: existing.serverVersion });
}

function targetOf(tx: TransactionContext, personId: EntityId, base: OwnFoodBase, newId: () => EntityId) {
  if (base === null) return { id: newId(), origin: null, knownServerVersion: null };
  if (base.type === 'bls') return { id: newId(), origin: base satisfies OwnFoodOrigin, knownServerVersion: null };
  // Barcode: dieselbe ID auf jedem Gerät; ein zweites Korrigieren ändert das vorhandene eigene Lebensmittel.
  const id = base.type === 'off' ? ownFoodBarcodeId(personId, base.key) : base.key;
  const existing = readOwnFood(tx, id);
  if (base.type === 'off' && existing === undefined) return { id, origin: base satisfies OwnFoodOrigin, knownServerVersion: null };
  if (existing === undefined || existing.deletedAt !== null) throw new InvalidNutritionInputError(`Eigenes Lebensmittel ${id} fehlt oder ist gelöscht`);
  return { id, origin: existing.origin, knownServerVersion: existing.serverVersion };
}
