import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { EntityId, type Instant } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { couplingMember, island, islandProgress } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Zuletzt gezeigtes Level je Installation (#200, #204): Levelfeier (`momo_levelfeier`) und Verwandlungsszene
// (`momo_verwandlung`) merken sich im Gerätezustand, ohne Sync, Insel und Level, bei dem sie zuletzt etwas gezeigt
// haben. Meldet die Projektion ein höheres, steht etwas an. Ohne gemerktes Level für diese Insel übernimmt die
// Installation das aktuelle still, etwa direkt nach dem Schlüpfen, nach einer Neuanmeldung (der Gerätezustand gehört
// zur Kontodatenbank) oder auf einer neuen Insel. Sinkt das Level nach einer Gegenbuchung, bleibt das gemerkte stehen.

/** Schlüssel im Gerätezustand. */
export type ShownLevelKey = 'momo_levelfeier' | 'momo_verwandlung';

const StoredLevel = z.strictObject({ islandId: EntityId, level: z.int().min(1) });
/** Insel und Level, gemerkt oder aus der Projektion. */
export type IslandLevel = z.infer<typeof StoredLevel>;

/** Was ansteht: das gemerkte Level (`null`: still übernehmen) und das aktuelle der Projektion. */
export type PendingShownLevel = Readonly<{ previous: number | null; current: IslandLevel }>;

/** Die geschlüpfte Insel der aktiven Kopplung mit dem Level ihrer Projektion; `null` ohne sie. */
function projectedLevel(tx: ReadContext, personId: EntityId): IslandLevel | null {
  const found = sqliteOf(tx)
    .select({ islandId: island.id, level: islandProgress.level })
    .from(couplingMember)
    .innerJoin(island, and(eq(island.couplingId, couplingMember.couplingId), eq(island.state, 'aktiv')))
    .innerJoin(islandProgress, eq(islandProgress.islandId, island.id))
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')))
    .get();
  return found === undefined ? null : { islandId: EntityId.parse(found.islandId), level: found.level };
}

/** Ob und was ansteht; nur lesend. `null`, wenn nichts ansteht. */
export function pendingShownLevel(tx: ReadContext, key: ShownLevelKey, personId: EntityId): PendingShownLevel | null {
  const current = projectedLevel(tx, personId);
  if (current === null) return null;
  const stored = StoredLevel.safeParse(readDeviceState(tx, key));
  if (!stored.success || stored.data.islandId !== current.islandId) return { previous: null, current };
  return current.level > stored.data.level ? { previous: stored.data.level, current } : null;
}

/**
 * Merkt das aktuelle Level als gezeigt und liefert, was anstand; ein zweiter Aufruf liefert für dasselbe Level
 * `null`, auch nach einem Neustart.
 */
export function takeShownLevel(tx: TransactionContext, key: ShownLevelKey, personId: EntityId, at: Instant): PendingShownLevel | null {
  const pending = pendingShownLevel(tx, key, personId);
  if (pending !== null) writeDeviceState(tx, key, pending.current, at);
  return pending;
}
