import { and, eq, gte } from 'drizzle-orm';

import type { EntityId, LocalDate } from '@abnehm/contracts/base';
import { planVersionId, planVersionOfKey, type PlanVersionKind } from '@abnehm/contracts/plan';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import type { ResourceTarget } from '../authorization/authorization.ts';
import type { DbExecutor } from '../database.ts';
import { dailyGoal } from '../db/schema/index.ts';
import { invalidatePartnerSummaries } from '../partner-projections/invalidations.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection } from '../sync/commands.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';
import { canonicalAfterWrite, canonicalOf } from '../sync/sync.ts';

// Gemeinsamer Ablauf der Fachbefehle `createGoalVersion` und `createWeeklyPlanVersion` (Spezifikation 1,
// Abschnitte 4 und 11). Beide unterscheiden sich nur in Tabelle und Nutzlast.

/**
 * Ziel eines Fachbefehls für eine Fassung: ihre ID aus Person und `valid_from` des Schlüssels. Die Person
 * im Schlüssel ist nur ein Anspruch; weicht sie von der Sitzung ab, verweigert die Autorisierung. Einen
 * Schlüssel ohne diese Form verweigert sie ebenso, weil er keine Ressource nennt.
 */
export function planCommandTarget(kind: PlanVersionKind, businessKey: string): ResourceTarget {
  const version = planVersionOfKey(kind, businessKey);
  return version === null ? {} : { id: version.id, claimedOwnerPersonId: version.personId };
}

/** Der Schlüssel eines Befehls dieser Art muss das `valid_from` der Nutzlast nennen, sonst `invalid_payload`. */
export function requireVersionKey(kind: PlanVersionKind, businessKey: string, validFrom: LocalDate): void {
  const key = planVersionOfKey(kind, businessKey);
  if (key === null || key.validFrom !== validFrom) throw new CommandRejection('invalid_payload');
}

/**
 * Schreibt eine Fassung der handelnden Person: Zeilen über `write` mit neuer Serverversion schreiben,
 * Änderungsprotokoll, Invalidierung der Partner-Zusammenfassungen und kanonische Antwort. Die ID folgt
 * aus Person und `valid_from`, sodass eine weitere Fassung desselben Tags dieselbe Zeile ersetzt
 * (Last-Write-Wins in Server-Eingangsreihenfolge).
 *
 * Wirksam ist eine Fassung, sobald für die Person ein Tagesziel mit lokalem Tag ≥ `valid_from`
 * existiert (Spezifikation 1, Abschnitt 4). Ihr Ersetzen lehnt der Befehl dann dauerhaft mit
 * `conflict` ab und nennt die kanonische Fassung, die die App übernimmt. Eine neue Fassung legt er an.
 */
export async function savePlanVersion(
  tx: DbExecutor,
  options: Readonly<{
    kind: PlanVersionKind;
    entity: ServerSyncEntity;
    personId: EntityId;
    validFrom: LocalDate;
    at: Date;
    write: (id: EntityId, serverVersion: bigint) => Promise<void>;
  }>,
): Promise<{ changes: CanonicalChange[]; idMappings: [] }> {
  const { kind, entity, personId, validFrom, at } = options;
  const id = planVersionId(kind, personId, validFrom);
  const stored = (await entity.read(tx, [id])).get(id);
  if (stored !== undefined && (await hasDailyGoalFrom(tx, personId, validFrom))) {
    throw new CommandRejection('conflict', canonicalOf(entity, id, stored));
  }
  const serverVersion = await nextServerVersion(tx);
  await options.write(id, serverVersion);
  await recordChange(tx, { position: serverVersion, entityType: entity.entityType, entityId: id, operation: 'upsert', ownerPersonId: personId, createdAt: at });
  // Ziele und Wochenplan wirken in die Zusammenfassungen aller Bereiche, etwa über Wasser- und Sportziel.
  await invalidatePartnerSummaries(tx, { type: 'plan', ownerPersonId: personId, validFrom }, at);
  return { changes: [await canonicalAfterWrite(tx, entity, id)], idMappings: [] };
}

async function hasDailyGoalFrom(tx: DbExecutor, personId: EntityId, validFrom: LocalDate): Promise<boolean> {
  const [goal] = await tx.select({ id: dailyGoal.id }).from(dailyGoal)
    .where(and(eq(dailyGoal.personId, personId), gte(dailyGoal.localDate, validFrom))).limit(1);
  return goal !== undefined;
}
