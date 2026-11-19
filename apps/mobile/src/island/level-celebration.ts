import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { EntityId, type Instant } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { couplingMember, island, islandProgress } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Levelfeier je Installation (Spezifikation 4, Abschnitt 6 „Levelaufstieg erleben“; #200). Jede Installation
// merkt sich im Gerätezustand, ohne Sync, das zuletzt gefeierte Level ihrer Insel. Meldet die Projektion ein
// höheres, feiert Momo einmal, auch wenn der Partner den Aufstieg ausgelöst hat; mehrere übersprungene Level
// ergeben eine Feier mit dem neuesten.
//
// Ohne gemerktes Level für diese Insel übernimmt die Installation das aktuelle still, etwa direkt nach dem
// Schlüpfen, nach einer Neuanmeldung (der Gerätezustand gehört zur Kontodatenbank) oder auf einer neuen Insel.
// Sonst feierte eine frisch angemeldete Installation einen längst erreichten Stand. Wie bei den Reaktionen auf
// ältere Tageszielerfüllungen (#188) geht das still. Festlegung in #200, nicht belegt.
//
// Sinkt das Level nach einer Gegenbuchung, bleibt das gemerkte stehen: Ein erneut erreichtes Level feiert Momo
// nicht noch einmal, wie auf dem Server (`level-up.ts`).

const stateKey = 'momo_levelfeier';
const CelebratedLevel = z.strictObject({ islandId: EntityId, level: z.int().min(1) });
/** Insel und Level, gemerkt oder aus der Projektion. */
type IslandLevel = z.infer<typeof CelebratedLevel>;

/** Was beim nächsten Beanspruchen geschieht: still merken oder feiern; `null`, wenn nichts ansteht. */
type PendingLevel = Readonly<{ celebrate: boolean; next: IslandLevel }> | null;

/** Die geschlüpfte Insel der aktiven Kopplung mit dem Level ihrer Projektion; `null` ohne sie. */
function projectedLevel(tx: ReadContext, personId: EntityId): IslandLevel | null {
  const db = sqliteOf(tx);
  const found = db
    .select({ islandId: island.id, level: islandProgress.level })
    .from(couplingMember)
    .innerJoin(island, and(eq(island.couplingId, couplingMember.couplingId), eq(island.state, 'aktiv')))
    .innerJoin(islandProgress, eq(islandProgress.islandId, island.id))
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')))
    .get();
  return found === undefined ? null : { islandId: EntityId.parse(found.islandId), level: found.level };
}

function pendingLevel(tx: ReadContext, personId: EntityId): PendingLevel {
  const current = projectedLevel(tx, personId);
  if (current === null) return null;
  const stored = CelebratedLevel.safeParse(readDeviceState(tx, stateKey));
  if (!stored.success || stored.data.islandId !== current.islandId) return { celebrate: false, next: current };
  return current.level > stored.data.level ? { celebrate: true, next: current } : null;
}

/** Ob diese Installation ein Level feiern oder sich erstmals merken muss; nur lesend, für die Beobachtung. */
export function hasPendingLevel(tx: ReadContext, personId: EntityId): boolean {
  return pendingLevel(tx, personId) !== null;
}

/**
 * Merkt das aktuelle Level der Insel als gefeiert und liefert es, wenn es höher ist als das bisher gefeierte;
 * sonst `null`. Ein zweiter Aufruf liefert für dasselbe Level nichts mehr, auch nach einem Neustart.
 */
export function claimLevel(tx: TransactionContext, personId: EntityId, at: Instant): number | null {
  const pending = pendingLevel(tx, personId);
  if (pending === null) return null;
  writeDeviceState(tx, stateKey, pending.next, at);
  return pending.celebrate ? pending.next.level : null;
}
