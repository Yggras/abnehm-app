import { and, desc, eq, inArray, lt } from 'drizzle-orm';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { CreateGoalVersion, goalVersionId, GoalVersionRecord } from '@abnehm/contracts/plan';

import { policies } from '../authorization/authorization.ts';
import type { DbExecutor } from '../database.ts';
import { goalVersion } from '../db/schema/index.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';
import { planCommandTarget, savePlanVersion } from './plan-versions.ts';

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
  target: (operation) => planCommandTarget('zielversion', operation.businessKey),
  canonicalRequest: (operation) => CreateGoalVersion.parse(operation.payload),
  // Jede Änderung trägt einen eigenen Schlüssel; ein Duplikat ist nur der Retry derselben Änderung.
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    // Ein Budget aus einem Budgetvorschlag entsteht nur mit `acceptBudgetSuggestion` (Spezifikation 1,
    // Abschnitt 7). „Ziele ändern“ darf es nur unverändert übernehmen; sonst umginge eine umbenannte
    // Herkunft das 10-kcal-Raster.
    if (payload.budgetSource === 'budgetvorschlag' && !(await carriesSuggestedBudget(tx, actor.personId, payload))) {
      throw new CommandRejection('invalid_payload');
    }
    return savePlanVersion(tx, { kind: 'zielversion', entity: goalVersionEntity, personId: actor.personId,
      validFrom: payload.validFrom, businessKey, at, async write(id, serverVersion) {
        const fields = { ...payload, updatedAt: at, serverVersion };
        await tx.insert(goalVersion).values({ ...fields, id, personId: actor.personId, createdAt: at }).onConflictDoUpdate({ target: goalVersion.id, set: fields });
      } });
  },
};

/**
 * Ob die Fassung das Budget eines angenommenen Budgetvorschlags unverändert übernimmt: Die Fassung, die
 * sie ersetzt, oder die vorige mit dem größten kleineren `valid_from` trägt dasselbe Budget mit derselben
 * Herkunft. Die Kette reicht so bis zur Fassung aus `acceptBudgetSuggestion` zurück.
 */
async function carriesSuggestedBudget(tx: DbExecutor, personId: EntityId, payload: CreateGoalVersion): Promise<boolean> {
  const columns = { budgetSource: goalVersion.budgetSource, calorieBudgetMilliKcal: goalVersion.calorieBudgetMilliKcal };
  const replaced = await tx.select(columns).from(goalVersion).where(eq(goalVersion.id, goalVersionId(personId, payload.validFrom)));
  const previous = await tx.select(columns).from(goalVersion)
    .where(and(eq(goalVersion.personId, personId), lt(goalVersion.validFrom, payload.validFrom)))
    .orderBy(desc(goalVersion.validFrom)).limit(1);
  return [...replaced, ...previous].some((version) =>
    version.budgetSource === 'budgetvorschlag' && version.calorieBudgetMilliKcal === payload.calorieBudgetMilliKcal);
}

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
