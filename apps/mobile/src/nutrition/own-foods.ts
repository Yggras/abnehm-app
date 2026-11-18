import { EntityId, Instant } from '@abnehm/contracts/base';
import { OwnFoodUpsert, ownFoodSnapshot, type FoodRef, type FoodValues, type OwnFoodOrigin } from '@abnehm/contracts/nutrition';

import type { TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { InvalidNutritionInputError } from './entries';
import type { NutritionDependencies } from './nutrition';
import { ownFoodEntity } from './own-food-entity';
import { readOwnFood, tombstoneOwnFood, writeOwnFood, type OwnFoodChoice } from './own-food-repository';

// Befehle der eigenen Lebensmittel (Spezifikation 2, Abschnitt 3). Sie laufen in der Transaktion des
// Aufrufers: Zeile, Suchindex und Outbox-Operation entstehen gemeinsam. Ein eigenes Lebensmittel
// betrifft keinen Tag, denn Einträge tragen ihren Snapshot. Deshalb melden die Befehle keine Tage an
// `reevaluateDailyGoals`.

/**
 * Was die Person ändert: `null` legt ein neues eigenes Lebensmittel an, ein eigenes ändert genau
 * dieses, ein BLS-Lebensmittel wird zum eigenen Lebensmittel mit dieser Herkunftsreferenz. Barcodes
 * mit ihrer deterministischen ID ergänzt der Barcode-Scan (#160).
 */
export type OwnFoodBase = Exclude<FoodRef, { type: 'off' }> | null;

type OwnFoodDependencies = Pick<NutritionDependencies, 'clock' | 'writer' | 'newId'>;

/**
 * Speichert die Werte als eigenes Lebensmittel und liefert Referenz und neue Fassung. Externe Daten
 * bleiben unverändert; gespeicherte Einträge behalten ihren Snapshot. Wirft
 * `InvalidNutritionInputError` bei ungültigen Werten oder einem fehlenden bzw. gelöschten eigenen
 * Lebensmittel, ohne etwas zu schreiben.
 */
export function saveOwnFood(tx: TransactionContext, { clock, writer, newId }: OwnFoodDependencies, base: OwnFoodBase, values: FoodValues): OwnFoodChoice {
  const target = targetOf(tx, base, newId);
  const parsed = OwnFoodUpsert.safeParse({ ...values, origin: target.origin });
  if (!parsed.success) throw new InvalidNutritionInputError(`Ungültiges eigenes Lebensmittel: ${parsed.error.message}`);
  const payload = parsed.data;
  writeOwnFood(tx, target.id, EntityId.parse(requireOwnPerson(tx).id), payload, Instant.parse(clock.read().instant));
  writer.upsert(tx, { entityType: ownFoodEntity.entityType, entityId: target.id, payload, knownServerVersion: target.knownServerVersion });
  return { ref: { type: 'eigen', key: target.id }, snapshot: ownFoodSnapshot(payload) };
}

/** Löscht ein eigenes Lebensmittel (Tombstone); ein schon gelöschtes bleibt, wie es ist. */
export function deleteOwnFood(tx: TransactionContext, { clock, writer }: OwnFoodDependencies, entityId: EntityId): void {
  const existing = readOwnFood(tx, entityId);
  if (existing === undefined || existing.deletedAt !== null) return;
  tombstoneOwnFood(tx, entityId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: ownFoodEntity.entityType, entityId, knownServerVersion: existing.serverVersion });
}

function targetOf(tx: TransactionContext, base: OwnFoodBase, newId: () => EntityId) {
  if (base === null) return { id: newId(), origin: null, knownServerVersion: null };
  if (base.type === 'bls') return { id: newId(), origin: base satisfies OwnFoodOrigin, knownServerVersion: null };
  const existing = readOwnFood(tx, base.key);
  if (existing === undefined || existing.deletedAt !== null) throw new InvalidNutritionInputError(`Eigenes Lebensmittel ${base.key} fehlt oder ist gelöscht`);
  return { id: base.key, origin: existing.origin, knownServerVersion: existing.serverVersion };
}
