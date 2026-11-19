import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import type { GameCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import type { DbExecutor } from '../database.ts';
import { islandProgress } from '../db/schema/index.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { islandProgressEntity } from './island-entities.ts';
import { areaUnlockChanges } from './area-unlock.ts';
import { levelUpChanges } from './level-up.ts';
import { projectIslandProgress } from './progress-projector.ts';

// Inselfortschritt als Ergebnis eines Fachbefehls (#191): Bauen, Aufwerten und Gegenbuchung berechnen ihn in
// ihrer Transaktion neu und liefern ihn mit ihren übrigen kanonischen Änderungen aus. Steigt dabei das Level,
// folgen im selben Befehl Freischaltungen, Ereignisse und Intents (#200, `level-up.ts`), dazu fehlende Gebiete
// samt Entdeckung (#204, `area-unlock.ts`). Ein eigenes Modul, weil der Projector die Sync-Entität nicht kennt
// (`island-entities.ts` nutzt umgekehrt seinen Datensatz).

/**
 * Berechnet den Inselfortschritt neu und liefert ihn als erste kanonische Änderung, gefolgt von denen eines
 * Levelaufstiegs. Der Katalog ist nur in Tests ein anderer als der ausgelieferte.
 */
export async function progressChanges(tx: DbExecutor, islandId: EntityId, at: Date, catalog: GameCatalog = gameCatalog): Promise<CanonicalChange[]> {
  const [before] = await tx.select({ level: islandProgress.level }).from(islandProgress).where(eq(islandProgress.islandId, islandId));
  const progress = await projectIslandProgress(tx, { islandId, at });
  const [row] = await tx.select({ id: islandProgress.id }).from(islandProgress).where(eq(islandProgress.islandId, islandId));
  const changes = [await canonicalAfterWrite(tx, islandProgressEntity, EntityId.parse(row!.id))];
  // Ohne bisherigen Fortschritt ist das Schlüpfen gerade erst geschehen; dort gibt es keinen Aufstieg.
  if (before === undefined) return changes;
  const levelUp = { islandId, couplingId: progress.couplingId, fromLevel: before.level, toLevel: progress.level, at, catalog };
  const levelChanges = await levelUpChanges(tx, levelUp);
  // Gebiete bis zum aktuellen Level, auch solche, die ein Katalog-Update für frühere Level nachliefert (#204).
  const areaChanges = await areaUnlockChanges(tx, { islandId, couplingId: progress.couplingId, level: progress.level, at, catalog });
  return [...changes, ...levelChanges, ...areaChanges];
}
