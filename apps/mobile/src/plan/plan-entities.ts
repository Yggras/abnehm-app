import { eq } from 'drizzle-orm';

import type { EntityId } from '@abnehm/contracts/base';
import {
  CreateGoalVersion,
  CreateWeeklyPlanVersion,
  goalVersionId,
  GoalVersionRecord,
  planVersionOfKey,
  weeklyPlanVersionId,
  WeeklyPlanVersionRecord,
} from '@abnehm/contracts/plan';
import type { EntityData } from '@abnehm/contracts/sync';

import type { ReadContext, TransactionContext } from '../local-db';
import { goalVersion, weeklyPlanVersion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sqliteEntity, type AffectedDay, type CanonicalEntity, type EntityTombstone, type LocalCommand, type SyncEntityAdapter } from '../sync';
import {
  planVersionValidity,
  removeUnconfirmedGoalVersion,
  removeUnconfirmedWeeklyPlan,
  writeWeeklyPlanRecord,
} from './plan-repository';

// Ziel- und Wochenplanversion im App-Sync (Spezifikation 0, Abschnitt 10; Spezifikation 1, Abschnitt
// 11). Beide entstehen nur über die Fachbefehle `createGoalVersion` und `createWeeklyPlanVersion`, ohne
// generisches Upsert oder Löschen. Nach jeder Übernahme meldet die Engine ihre Gültigkeit an den
// Persistenzdienst; der meldet die Tage bis heute + 13 mit `planaenderung`.

const validityOf = (table: 'zielversion' | 'wochenplan') => (tx: ReadContext, entityId: EntityId): readonly AffectedDay[] => {
  const validity = planVersionValidity(tx, table, entityId);
  return validity === undefined ? [] : [{ type: 'plan', ...validity }];
};

export const goalVersionEntity: SyncEntityAdapter = {
  ...sqliteEntity({
    entityType: 'goal_version',
    ownerField: 'personId',
    upsert: null,
    deletable: false,
    record: GoalVersionRecord,
    table: goalVersion,
    row: (entityId, data) => ({ ...data, id: entityId }),
    // Ohne generisches Upsert gibt es keine offene Operation dieser Entität, die erneut anzuwenden wäre.
    replay: () => {},
  }),
  affectedDays: validityOf('zielversion'),
};

/** Eine Wochenplanversion ist eine Zeile samt ihren sieben Tagen; übernommen wird beides gemeinsam. */
export const weeklyPlanVersionEntity: SyncEntityAdapter<EntityData, WeeklyPlanVersionRecord> = {
  entityType: 'weekly_plan_version',
  ownerField: 'personId',
  upsert: null,
  deletable: false,
  record: WeeklyPlanVersionRecord,
  applyCanonical: applyWeeklyPlan,
  applyTombstone: tombstoneWeeklyPlan,
  affectedDays: validityOf('wochenplan'),
  reconcileRejected(tx, { entityId, canonical }) {
    if (canonical === null) removeUnconfirmedWeeklyPlan(tx, entityId);
    else if (canonical.type === 'record') applyWeeklyPlan(tx, canonical);
    else tombstoneWeeklyPlan(tx, canonical);
  },
};

/** Wie `sqliteEntity`: Ist die lokale Serverversion schon neuer, bleibt alles unverändert. */
function applyWeeklyPlan(tx: TransactionContext, record: CanonicalEntity<WeeklyPlanVersionRecord>) {
  const local = sqliteOf(tx).select({ serverVersion: weeklyPlanVersion.serverVersion }).from(weeklyPlanVersion)
    .where(eq(weeklyPlanVersion.id, record.entityId)).get();
  if (local?.serverVersion != null && BigInt(local.serverVersion) > BigInt(record.serverVersion)) return;
  writeWeeklyPlanRecord(tx, record.entityId, record.data, record.serverVersion);
}

function tombstoneWeeklyPlan(tx: TransactionContext, tombstone: EntityTombstone) {
  sqliteOf(tx)
    .update(weeklyPlanVersion)
    .set({ deletedAt: tombstone.deletedAt, serverVersion: tombstone.serverVersion })
    .where(eq(weeklyPlanVersion.id, tombstone.entityId))
    .run();
}

/**
 * Die Fachbefehle für die lokale Befehls-Registry. Erzeugen darf sie nur das Plan-Modul, zusammen mit
 * Person und Tagesmeldung in einer Transaktion. Lehnt der Server eine Fassung dauerhaft ab, verschwindet
 * sie lokal, sofern er sie nie bestätigt hat.
 */
export const planCommands: readonly LocalCommand[] = [
  {
    type: 'createGoalVersion',
    payload: CreateGoalVersion,
    referencePaths: [],
    apply: onlyThePlanModule('createGoalVersion'),
    reconcileRejected(tx, operation) {
      const version = planVersionOfKey('zielversion', operation.businessKey);
      if (version !== null) removeUnconfirmedGoalVersion(tx, goalVersionId(version.personId, version.validFrom));
    },
  },
  {
    type: 'createWeeklyPlanVersion',
    payload: CreateWeeklyPlanVersion,
    referencePaths: [],
    apply: onlyThePlanModule('createWeeklyPlanVersion'),
    reconcileRejected(tx, operation) {
      const version = planVersionOfKey('wochenplan', operation.businessKey);
      if (version !== null) removeUnconfirmedWeeklyPlan(tx, weeklyPlanVersionId(version.personId, version.validFrom));
    },
  },
];

function onlyThePlanModule(type: string): () => never {
  return () => {
    throw new Error(`${type} erzeugt nur das Plan-Modul`);
  };
}

