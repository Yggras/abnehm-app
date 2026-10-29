import { inArray } from 'drizzle-orm';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { CreateGoalVersion, goalVersionId, GoalVersionRecord, planVersionOfKey } from '@abnehm/contracts/plan';

import { policies } from '../authorization/authorization.ts';
import { goalVersion } from '../db/schema/index.ts';
import { invalidatePartnerSummaries } from '../partner-projections/invalidations.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { planCommandTarget } from './plan-keys.ts';

// Zielversion auf dem Server (Spezifikation 1, Abschnitte 4 und 11). Sie entsteht nur über den
// Fachbefehl `createGoalVersion`; der Sync liest sie, kennt aber kein generisches Upsert oder Löschen.
// Wertebereiche und Stimmigkeit prüft schon das Vertragsschema über den Zielrechner. Die ID folgt aus
// Person und `valid_from`, sodass eine weitere Fassung desselben Tags dieselbe Zeile ersetzt
// (Last-Write-Wins in Server-Eingangsreihenfolge).

export const goalVersionEntity: ServerSyncEntity = {
  entityType: 'goal_version',
  resource: 'goal_version',
  upsert: null,
  deletable: false,
  async read(tx, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tx.select().from(goalVersion).where(inArray(goalVersion.id, [...ids]));
    return new Map(rows.map((row) => [row.id, { serverVersion: row.serverVersion, deletedAt: row.deletedAt, data: recordOf(row) }]));
  },
  async write() {
    throw new Error('Zielversionen entstehen nur im Fachbefehl createGoalVersion');
  },
  async remove() {
    throw new Error('Zielversionen werden nicht gelöscht');
  },
};

export const createGoalVersionCommand: ServerCommand<CreateGoalVersion> = {
  type: 'createGoalVersion',
  identity: 'none',
  policy: policies.resource('goal_version', 'befehl'),
  payload: CreateGoalVersion,
  target: (operation) => planCommandTarget('zielversion', operation.businessKey, goalVersionId),
  canonicalRequest: (operation) => CreateGoalVersion.parse(operation.payload),
  // Jede Änderung trägt einen eigenen Schlüssel; ein Duplikat ist nur der Retry derselben Änderung.
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    const key = planVersionOfKey('zielversion', businessKey);
    if (key === null || key.validFrom !== payload.validFrom) throw new CommandRejection('invalid_payload');
    const id = goalVersionId(actor.personId, payload.validFrom);
    const serverVersion = await nextServerVersion(tx);
    const fields = { ...payload, updatedAt: at, serverVersion };
    await tx
      .insert(goalVersion)
      .values({ ...fields, id, personId: actor.personId, createdAt: at })
      .onConflictDoUpdate({ target: goalVersion.id, set: fields });
    await recordChange(tx, { position: serverVersion, entityType: goalVersionEntity.entityType, entityId: id, operation: 'upsert',
      ownerPersonId: actor.personId, createdAt: at });
    // Wasser- und Sportziel wirken in die Partner-Zusammenfassungen; das Fundament verteilt auf alle Bereiche.
    await invalidatePartnerSummaries(tx, { type: 'plan', ownerPersonId: actor.personId, validFrom: payload.validFrom }, at);
    return { changes: [await canonicalAfterWrite(tx, goalVersionEntity, id)], idMappings: [] };
  },
};

function recordOf(row: typeof goalVersion.$inferSelect): GoalVersionRecord {
  return GoalVersionRecord.parse({
    validFrom: LocalDate.parse(row.validFrom),
    calorieBudgetMilliKcal: row.calorieBudgetMilliKcal,
    basalMetabolicRateMilliKcal: row.basalMetabolicRateMilliKcal,
    totalEnergyExpenditureMilliKcal: row.totalEnergyExpenditureMilliKcal,
    lowerBoundMilliKcal: row.lowerBoundMilliKcal,
    deficitMilliKcal: row.deficitMilliKcal,
    budgetSource: row.budgetSource,
    calculationSex: row.calculationSex,
    ageYears: row.ageYears,
    heightCm: row.heightCm,
    weightG: row.weightG,
    activityLevel: row.activityLevel,
    maintenanceReason: row.maintenanceReason,
    pace: row.pace,
    goalWeightG: row.goalWeightG,
    waterTargetMl: row.waterTargetMl,
    weeklySportTargetMinutes: row.weeklySportTargetMinutes,
    personId: EntityId.parse(row.personId),
    createdAt: Instant.parse(row.createdAt.toISOString()),
    updatedAt: Instant.parse(row.updatedAt.toISOString()),
  });
}
