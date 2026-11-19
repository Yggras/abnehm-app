import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { z } from 'zod';

import { EntityId, type Instant } from '@abnehm/contracts/base';
import type { MomoForm } from '@abnehm/contracts/island';
import { formAt } from '@abnehm/game-rules/unlocks';

import type { TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { areaUnlock } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { projectedLevel } from './level-celebration';

// Verwandlungsszene je Installation (Spezifikation 4, Abschnitt 6 „Levelaufstieg erleben“; #204). Hat Momo seit dem
// letzten Öffnen des Tabs „Momo“ eine neue Form erreicht, zeigt der Tab beim nächsten Öffnen die Verwandlung von
// der alten zur neuen Form; danach zieht der Nebel von den neuen Gebieten ab. Jede Installation merkt sich dafür im
// Gerätezustand, ohne Sync, das Level, bei dem sie Momo zuletzt gezeigt hat. Die Levelfeier auf „Heute“
// (`level-celebration.ts`) merkt sich ihr Level getrennt: Sie kommt beim nächsten sichtbaren Moment, die
// Verwandlung erst im Tab „Momo“.
//
// Wie bei der Levelfeier übernimmt eine Installation ohne gemerktes Level für diese Insel das aktuelle still, und
// ein nach einer Gegenbuchung erneut erreichtes Level verwandelt Momo nicht noch einmal.

const stateKey = 'momo_verwandlung';
const ShownLevel = z.strictObject({ islandId: EntityId, level: z.int().min(1) });

/** Die Verwandlung von `from` zu `to` und die Gebiete, von denen danach der Nebel abzieht. */
export type Transformation = Readonly<{ from: MomoForm; to: MomoForm; areas: readonly string[] }>;

/**
 * Merkt das aktuelle Level der Insel als gezeigt und liefert die Verwandlung, wenn Momo seit dem zuletzt gezeigten
 * Level eine neue Form hat; sonst `null`. Ein zweiter Aufruf liefert für dasselbe Level nichts mehr.
 */
export function takeTransformation(tx: TransactionContext, personId: EntityId, at: Instant): Transformation | null {
  const current = projectedLevel(tx, personId);
  if (current === null) return null;
  const stored = ShownLevel.safeParse(readDeviceState(tx, stateKey));
  if (stored.success && stored.data.islandId === current.islandId && current.level <= stored.data.level) return null;
  writeDeviceState(tx, stateKey, current, at);
  if (!stored.success || stored.data.islandId !== current.islandId) return null;

  const from = formAt(stored.data.level);
  const to = formAt(current.level);
  if (from === to) return null;
  const areas = sqliteOf(tx)
    .select({ key: areaUnlock.areaKey })
    .from(areaUnlock)
    .where(and(eq(areaUnlock.islandId, current.islandId), gt(areaUnlock.level, stored.data.level), lte(areaUnlock.level, current.level)))
    .orderBy(asc(areaUnlock.level))
    .all()
    .map((row) => row.key);
  return { from, to, areas };
}
