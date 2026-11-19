import type { EntityId, Instant } from '@abnehm/contracts/base';

import type { ReadContext, TransactionContext } from '../local-db';
import { pendingShownLevel, takeShownLevel } from './shown-level';

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
// nicht noch einmal, wie auf dem Server (`level-up.ts`). Das Merken teilt sie mit der Verwandlung (`shown-level.ts`).

/** Ob diese Installation ein Level feiern oder sich erstmals merken muss; nur lesend, für die Beobachtung. */
export function hasPendingLevel(tx: ReadContext, personId: EntityId): boolean {
  return pendingShownLevel(tx, 'momo_levelfeier', personId) !== null;
}

/**
 * Merkt das aktuelle Level der Insel als gefeiert und liefert es, wenn es höher ist als das bisher gefeierte;
 * sonst `null`. Ein zweiter Aufruf liefert für dasselbe Level nichts mehr, auch nach einem Neustart.
 */
export function claimLevel(tx: TransactionContext, personId: EntityId, at: Instant): number | null {
  const pending = takeShownLevel(tx, 'momo_levelfeier', personId, at);
  return pending === null || pending.previous === null ? null : pending.current.level;
}
