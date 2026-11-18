import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import type { DbExecutor } from '../database.ts';
import { islandProgress } from '../db/schema/index.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { islandProgressEntity } from './island-entities.ts';
import { projectIslandProgress } from './progress-projector.ts';

// Inselfortschritt als Ergebnis eines Fachbefehls (#191): Bauen und Gegenbuchung berechnen ihn in ihrer
// Transaktion neu und liefern ihn mit ihren übrigen kanonischen Änderungen aus. Ein eigenes Modul, weil
// der Projector die Sync-Entität nicht kennt (`island-entities.ts` nutzt umgekehrt seinen Datensatz).

/** Berechnet den Inselfortschritt neu und liefert ihn als kanonische Änderung. */
export async function progressChange(tx: DbExecutor, islandId: EntityId, at: Date): Promise<CanonicalChange> {
  await projectIslandProgress(tx, { islandId, at });
  const [row] = await tx.select({ id: islandProgress.id }).from(islandProgress).where(eq(islandProgress.islandId, islandId));
  return canonicalAfterWrite(tx, islandProgressEntity, EntityId.parse(row!.id));
}
