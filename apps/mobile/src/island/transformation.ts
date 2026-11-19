import { and, asc, eq, gt, lte } from 'drizzle-orm';

import type { EntityId, Instant } from '@abnehm/contracts/base';
import type { MomoForm } from '@abnehm/contracts/island';
import { formAt } from '@abnehm/game-rules/unlocks';

import type { TransactionContext } from '../local-db';
import { areaUnlock } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { takeShownLevel } from './shown-level';

// Verwandlungsszene je Installation (Spezifikation 4, Abschnitt 6 „Levelaufstieg erleben“; #204). Hat Momo seit dem
// letzten Öffnen des Tabs „Momo“ eine neue Form erreicht, zeigt der Tab beim nächsten Öffnen die Verwandlung von
// der alten zur neuen Form; danach zieht der Nebel von den neuen Gebieten ab. Jede Installation merkt sich dafür im
// Gerätezustand, ohne Sync, das Level, bei dem sie Momo zuletzt gezeigt hat (`shown-level.ts`). Die Levelfeier auf „Heute“
// (`level-celebration.ts`) merkt sich ihr Level getrennt: Sie kommt beim nächsten sichtbaren Moment, die
// Verwandlung erst im Tab „Momo“.
//
// Wie bei der Levelfeier übernimmt eine Installation ohne gemerktes Level für diese Insel das aktuelle still, und
// ein nach einer Gegenbuchung erneut erreichtes Level verwandelt Momo nicht noch einmal.

/** Die alte Form, aus der Momo sich verwandelt, und die Gebiete, von denen danach der Nebel abzieht. */
export type Transformation = Readonly<{ from: MomoForm; areas: readonly string[] }>;

/**
 * Merkt das aktuelle Level der Insel als gezeigt und liefert die Verwandlung, wenn Momo seit dem zuletzt gezeigten
 * Level eine neue Form hat; sonst `null`. Ein zweiter Aufruf liefert für dasselbe Level nichts mehr.
 */
export function takeTransformation(tx: TransactionContext, personId: EntityId, at: Instant): Transformation | null {
  const pending = takeShownLevel(tx, 'momo_verwandlung', personId, at);
  if (pending === null || pending.previous === null) return null;
  const { previous, current } = pending;
  const from = formAt(previous);
  if (from === formAt(current.level)) return null;
  const areas = sqliteOf(tx)
    .select({ key: areaUnlock.areaKey })
    .from(areaUnlock)
    .where(and(eq(areaUnlock.islandId, current.islandId), gt(areaUnlock.level, previous), lte(areaUnlock.level, current.level)))
    .orderBy(asc(areaUnlock.level))
    .all()
    .map((row) => row.key);
  return { from, areas };
}
