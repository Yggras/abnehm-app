import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { BausteinKey, EntityId, LocalDate, weekdayOf, Weekday, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import type { CreateGoalVersion, WeeklyPlanDays, WeeklyPlanVersionRecord } from '@abnehm/contracts/plan';
import { EffectivePlan } from '@abnehm/contracts/ports';

import type { ReadContext, TransactionContext } from '../local-db';
import { goalVersion, weeklyPlanDay, weeklyPlanVersion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository des Plan-Moduls: die einzige Stelle der App, die Drizzle und die Tabellen der Ziel- und
// Wochenplanversionen sieht. Andere Bereiche lesen sie nie, sondern fragen den `PlanReader`.

/** Fachliche Werte einer gespeicherten Zielversion samt Serverversion. */
export type StoredGoalVersion = Readonly<{ values: CreateGoalVersion; serverVersion: ServerVersion | null }>;

/** Tage einer gespeicherten Wochenplanversion samt Serverversion. */
export type StoredWeeklyPlan = Readonly<{ days: WeeklyPlanDays; serverVersion: ServerVersion | null }>;

/** Legt die Zielversion an oder überschreibt ihre fachlichen Felder (Last-Write-Wins). */
export function writeGoalVersion(tx: TransactionContext, id: EntityId, personId: EntityId, values: CreateGoalVersion, at: Instant): void {
  const fields = { ...values, updatedAt: at };
  sqliteOf(tx)
    .insert(goalVersion)
    .values({ ...fields, id, personId, createdAt: at })
    .onConflictDoUpdate({ target: goalVersion.id, set: fields })
    .run();
}

export function readGoalVersion(tx: ReadContext, id: EntityId): StoredGoalVersion | undefined {
  const row = sqliteOf(tx).select().from(goalVersion).where(eq(goalVersion.id, id)).get();
  if (row === undefined) return undefined;
  const { id: _id, personId: _personId, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, serverVersion, ...values } = row;
  return { values: values as CreateGoalVersion, serverVersion: serverVersion as ServerVersion | null };
}

/** Legt die Wochenplanversion samt ihrer sieben Tage an oder überschreibt sie (Last-Write-Wins). */
export function writeWeeklyPlan(
  tx: TransactionContext,
  id: EntityId,
  personId: EntityId,
  version: Readonly<{ validFrom: LocalDate; days: WeeklyPlanDays }>,
  at: Instant,
  canonical?: Readonly<{ serverVersion: ServerVersion; createdAt: Instant; updatedAt: Instant }>,
): void {
  const db = sqliteOf(tx);
  const stamps = canonical === undefined ? { updatedAt: at } : { updatedAt: canonical.updatedAt, serverVersion: canonical.serverVersion, deletedAt: null };
  db.insert(weeklyPlanVersion)
    .values({ id, personId, validFrom: version.validFrom, createdAt: canonical?.createdAt ?? at, ...stamps })
    .onConflictDoUpdate({ target: weeklyPlanVersion.id, set: { validFrom: version.validFrom, ...stamps } })
    .run();
  for (const weekday of Weekday.options) {
    const [baustein1, baustein2, baustein3] = version.days[weekday];
    db.insert(weeklyPlanDay)
      .values({ weeklyPlanVersionId: id, personId, weekday, baustein1, baustein2, baustein3 })
      .onConflictDoUpdate({ target: [weeklyPlanDay.weeklyPlanVersionId, weeklyPlanDay.weekday], set: { baustein1, baustein2, baustein3 } })
      .run();
  }
}

/** Übernimmt die kanonische Wochenplanversion des Servers. */
export function writeWeeklyPlanRecord(tx: TransactionContext, id: EntityId, record: WeeklyPlanVersionRecord, serverVersion: ServerVersion): void {
  writeWeeklyPlan(tx, id, record.personId, record, record.updatedAt, { serverVersion, createdAt: record.createdAt, updatedAt: record.updatedAt });
}

export function readWeeklyPlan(tx: ReadContext, id: EntityId): StoredWeeklyPlan | undefined {
  const version = sqliteOf(tx).select({ serverVersion: weeklyPlanVersion.serverVersion }).from(weeklyPlanVersion).where(eq(weeklyPlanVersion.id, id)).get();
  if (version === undefined) return undefined;
  return { days: daysOf(tx, id), serverVersion: version.serverVersion as ServerVersion | null };
}

/** Person und `valid_from` einer Fassung; für die Tagesmeldung nach einer Pull-Übernahme. */
export function planVersionValidity(tx: ReadContext, table: 'zielversion' | 'wochenplan', id: EntityId) {
  const source = table === 'zielversion' ? goalVersion : weeklyPlanVersion;
  const row = sqliteOf(tx).select({ personId: source.personId, validFrom: source.validFrom }).from(source).where(eq(source.id, id)).get();
  return row === undefined ? undefined : { personId: EntityId.parse(row.personId), validFrom: LocalDate.parse(row.validFrom) };
}

/** Entfernt eine Zielversion, die der Server nie bestätigt hat; eine bestätigte bleibt. */
export function removeUnconfirmedGoalVersion(tx: TransactionContext, id: EntityId): void {
  sqliteOf(tx).delete(goalVersion).where(and(eq(goalVersion.id, id), isNull(goalVersion.serverVersion))).run();
}

/** Entfernt eine nie bestätigte Wochenplanversion samt ihrer Tage; eine bestätigte bleibt. */
export function removeUnconfirmedWeeklyPlan(tx: TransactionContext, id: EntityId): void {
  const db = sqliteOf(tx);
  const unconfirmed = db.select({ id: weeklyPlanVersion.id }).from(weeklyPlanVersion)
    .where(and(eq(weeklyPlanVersion.id, id), isNull(weeklyPlanVersion.serverVersion))).get();
  if (unconfirmed === undefined) return;
  db.delete(weeklyPlanDay).where(eq(weeklyPlanDay.weeklyPlanVersionId, id)).run();
  db.delete(weeklyPlanVersion).where(eq(weeklyPlanVersion.id, id)).run();
}

/**
 * Gültiger Plan eines Tags: die Zielversion und die Wochenplanversion mit dem größten `valid_from` ≤
 * Tag, vom Wochenplan der Wochentag des Tags. Fehlt eine der beiden, gilt noch kein Plan.
 */
export function readEffectivePlan(tx: ReadContext, personId: EntityId, localDate: LocalDate): EffectivePlan {
  const db = sqliteOf(tx);
  const goal = db
    .select()
    .from(goalVersion)
    .where(and(eq(goalVersion.personId, personId), lte(goalVersion.validFrom, localDate), isNull(goalVersion.deletedAt)))
    .orderBy(desc(goalVersion.validFrom))
    .limit(1)
    .get();
  const plan = db
    .select({ id: weeklyPlanVersion.id, validFrom: weeklyPlanVersion.validFrom })
    .from(weeklyPlanVersion)
    .where(and(eq(weeklyPlanVersion.personId, personId), lte(weeklyPlanVersion.validFrom, localDate), isNull(weeklyPlanVersion.deletedAt)))
    .orderBy(desc(weeklyPlanVersion.validFrom))
    .limit(1)
    .get();
  if (goal === undefined || plan === undefined) return EffectivePlan.parse({ type: 'leer', localDate });
  const day = db
    .select()
    .from(weeklyPlanDay)
    .where(and(eq(weeklyPlanDay.weeklyPlanVersionId, plan.id), eq(weeklyPlanDay.weekday, weekdayOf(localDate))))
    .get();
  return EffectivePlan.parse({
    type: 'gueltig',
    localDate,
    goal: {
      id: goal.id,
      validFrom: goal.validFrom,
      calorieBudgetMilliKcal: goal.calorieBudgetMilliKcal,
      lowerBoundMilliKcal: goal.lowerBoundMilliKcal,
      maintenanceReason: goal.maintenanceReason,
      pace: goal.pace,
      goalWeightG: goal.goalWeightG,
      waterTargetMl: goal.waterTargetMl,
      weeklySportTargetMinutes: goal.weeklySportTargetMinutes,
    },
    weeklyPlanDay: {
      weeklyPlanVersionId: plan.id,
      validFrom: plan.validFrom,
      bausteine: day === undefined ? undefined : [day.baustein1, day.baustein2, day.baustein3],
    },
  });
}

function daysOf(tx: ReadContext, id: EntityId): WeeklyPlanDays {
  const rows = sqliteOf(tx).select().from(weeklyPlanDay).where(eq(weeklyPlanDay.weeklyPlanVersionId, id)).all();
  return Object.fromEntries(
    rows.map((row) => [row.weekday, [BausteinKey.parse(row.baustein1), BausteinKey.parse(row.baustein2), BausteinKey.parse(row.baustein3)]]),
  ) as WeeklyPlanDays;
}
