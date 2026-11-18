import { and, eq, isNull, ne } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { islandObject } from '../db/schema/index.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { islandObjectEntity } from './island-entities.ts';

// Feldbelegung auf dem Server (Spezifikation 0, Abschnitt 10; Spezifikation 4, Abschnitt 11): Ein Feld
// trägt höchstens ein Objekt. Belegt ein Befehl ein Feld, auf dem schon ein Objekt steht, gilt die
// Server-Eingangsreihenfolge: Das ältere Objekt wechselt atomar ins Lager seines Besitzers (`field_id`
// leer). Keine Energie geht verloren, und Ausgaben werden nie zurückgedreht. `placeObject` (#194) und
// `buildObject` (#191, Festlegung im Nachtrag an #71) nutzen dieselbe Regel.

/**
 * Räumt das Feld für das Objekt `incoming`: Ein anderes Objekt darauf wechselt ins Lager. Liefert dessen
 * kanonische Änderung, sonst nichts. Läuft in der Transaktion des Befehls, vor dem Schreiben von `incoming`.
 */
export async function vacateField(
  tx: DbExecutor,
  { fieldId, couplingId, incoming, at }: Readonly<{ fieldId: EntityId; couplingId: EntityId; incoming: EntityId; at: Date }>,
): Promise<CanonicalChange[]> {
  const [occupant] = await tx
    .select({ id: islandObject.id })
    .from(islandObject)
    .where(and(eq(islandObject.fieldId, fieldId), isNull(islandObject.deletedAt), ne(islandObject.id, incoming)));
  if (occupant === undefined) return [];
  await changeWriter(tx, at)({ entityType: 'island_object', couplingId }, async (stamp) => {
    await tx.update(islandObject).set({ fieldId: null, ...updated(stamp) }).where(eq(islandObject.id, occupant.id));
    return occupant.id;
  });
  return [await canonicalAfterWrite(tx, islandObjectEntity, EntityId.parse(occupant.id))];
}
