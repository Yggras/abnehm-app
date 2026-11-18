import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { EntityId, LocalDate, weekdayOf, Weekday, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import {
  effectivePlanOf,
  GoalVersionRecord,
  weeklyPlanDaysOf,
  type CreateGoalVersion,
  type PlanVersionKind,
  type WeeklyPlanDays,
  type WeeklyPlanVersionRecord,
} from '@abnehm/contracts/plan';

import type { ReadContext, TransactionContext } from '../local-db';
import { goalVersion, weeklyPlanDay, weeklyPlanVersion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository des Plan-Moduls: die einzige Stelle der App, die Drizzle und die Tabellen der Ziel- und
// Wochenplanversionen sieht; der Sync-Adapter der Zielversion bekommt nur die Tabelle für `sqliteEntity`.
// Andere Bereiche lesen die Fassungen nie, sondern fragen den `PlanReader`.

/** Fachliche Werte einer Zielversion, wie sie gespeichert sind, samt `validFrom`. */
export type GoalVersionValues = Omit<GoalVersionRecord, 'personId' | 'createdAt' | 'updatedAt'>;

/** Fachliche Werte einer gespeicherten Zielversion samt Serverversion. */
export type StoredGoalVersion = Readonly<{ values: GoalVersionValues; serverVersion: ServerVersion | null }>;

/** Tage einer gespeicherten Wochenplanversion samt `validFrom` und Serverversion. */
export type StoredWeeklyPlan = Readonly<{ validFrom: LocalDate; days: WeeklyPlanDays; serverVersion: ServerVersion | null }>;

/** Legt die Zielversion an oder überschreibt ihre fachlichen Felder (Last-Write-Wins). */
export function writeGoalVersion(tx: TransactionContext, id: EntityId, personId: EntityId, values: CreateGoalVersion, at: Instant): void {
  const fields = { ...values, updatedAt: at };
  sqliteOf(tx)
    .insert(goalVersion)
    .values({ ...fields, id, personId, createdAt: at })
    .onConflictDoUpdate({ target: goalVersion.id, set: fields })
    .run();
}

/** Die gespeicherte Zielversion, geprüft wie ein kanonischer Datensatz. */
export function readGoalVersion(tx: ReadContext, id: EntityId): StoredGoalVersion | undefined {
  return storedGoalVersion(sqliteOf(tx).select().from(goalVersion).where(eq(goalVersion.id, id)).get());
}

/** Die an einem Tag gültige Zielversion der Person: die mit dem größten `valid_from` ≤ Tag. */
export function readGoalVersionOn(tx: ReadContext, personId: EntityId, localDate: LocalDate): StoredGoalVersion | undefined {
  return storedGoalVersion(goalVersionRowOn(tx, personId, localDate));
}

/** Die Zeile der Zielversion mit dem größten `valid_from` ≤ Tag; die eine Stelle dieser Regel in SQLite. */
function goalVersionRowOn(tx: ReadContext, personId: EntityId, localDate: LocalDate) {
  return sqliteOf(tx)
    .select()
    .from(goalVersion)
    .where(and(eq(goalVersion.personId, personId), lte(goalVersion.validFrom, localDate), isNull(goalVersion.deletedAt)))
    .orderBy(desc(goalVersion.validFrom))
    .limit(1)
    .get();
}

function storedGoalVersion(row: typeof goalVersion.$inferSelect | undefined): StoredGoalVersion | undefined {
  if (row === undefined) return undefined;
  const { id: _id, deletedAt: _deletedAt, serverVersion, ...record } = row;
  const { personId: _personId, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = GoalVersionRecord.parse(record);
  return { values, serverVersion: serverVersion as ServerVersion | null };
}

type Stamps = Readonly<{ createdAt: Instant; updatedAt: Instant; serverVersion: ServerVersion | null }>;

/**
 * Schreibt Version und sieben Tage. Eine lokale Änderung (ohne Serverversion) lässt Anlagezeit und
 * Serverversion stehen; der kanonische Datensatz ersetzt alles, wie bei `sqliteEntity`.
 */
function writeWeeklyPlanRows(tx: TransactionContext, id: EntityId, personId: EntityId, validFrom: LocalDate, days: WeeklyPlanDays, stamps: Stamps): void {
  const db = sqliteOf(tx);
  const changed = stamps.serverVersion === null
    ? { validFrom, updatedAt: stamps.updatedAt }
    : { validFrom, createdAt: stamps.createdAt, updatedAt: stamps.updatedAt, serverVersion: stamps.serverVersion, deletedAt: null };
  db.insert(weeklyPlanVersion)
    .values({ id, personId, createdAt: stamps.createdAt, ...changed })
    .onConflictDoUpdate({ target: weeklyPlanVersion.id, set: changed })
    .run();
  for (const weekday of Weekday.options) {
    const [baustein1, baustein2, baustein3] = days[weekday];
    db.insert(weeklyPlanDay)
      .values({ weeklyPlanVersionId: id, personId, weekday, baustein1, baustein2, baustein3 })
      .onConflictDoUpdate({ target: [weeklyPlanDay.weeklyPlanVersionId, weeklyPlanDay.weekday], set: { baustein1, baustein2, baustein3 } })
      .run();
  }
}

/** Legt die Wochenplanversion samt ihrer sieben Tage an oder überschreibt sie (Last-Write-Wins). */
export function writeWeeklyPlan(
  tx: TransactionContext,
  id: EntityId,
  personId: EntityId,
  version: Readonly<{ validFrom: LocalDate; days: WeeklyPlanDays }>,
  at: Instant,
): void {
  writeWeeklyPlanRows(tx, id, personId, version.validFrom, version.days, { createdAt: at, updatedAt: at, serverVersion: null });
}

/**
 * Übernimmt die kanonische Wochenplanversion samt Tagen. Wie bei `sqliteEntity` bleibt alles, wie es ist,
 * wenn die lokale Serverversion schon neuer ist; eine gleiche Version wird erneut übernommen.
 */
export function applyWeeklyPlanRecord(tx: TransactionContext, id: EntityId, record: WeeklyPlanVersionRecord, serverVersion: ServerVersion): void {
  const local = sqliteOf(tx).select({ serverVersion: weeklyPlanVersion.serverVersion }).from(weeklyPlanVersion).where(eq(weeklyPlanVersion.id, id)).get();
  if (local?.serverVersion != null && BigInt(local.serverVersion) > BigInt(serverVersion)) return;
  writeWeeklyPlanRows(tx, id, record.personId, record.validFrom, record.days, { createdAt: record.createdAt, updatedAt: record.updatedAt, serverVersion });
}

/** Setzt die Löschmarkierung des Servers; eine lokal unbekannte Fassung bleibt unbekannt. */
export function tombstoneWeeklyPlan(tx: TransactionContext, id: EntityId, deletedAt: Instant, serverVersion: ServerVersion): void {
  sqliteOf(tx).update(weeklyPlanVersion).set({ deletedAt, serverVersion }).where(eq(weeklyPlanVersion.id, id)).run();
}

const weeklyPlanColumns = { id: weeklyPlanVersion.id, validFrom: weeklyPlanVersion.validFrom, serverVersion: weeklyPlanVersion.serverVersion };

export function readWeeklyPlan(tx: ReadContext, id: EntityId): StoredWeeklyPlan | undefined {
  return storedWeeklyPlan(tx, sqliteOf(tx).select(weeklyPlanColumns).from(weeklyPlanVersion).where(eq(weeklyPlanVersion.id, id)).get());
}

/** Die an einem Tag gültige Wochenplanversion der Person samt ihrer sieben Tage. */
export function readWeeklyPlanOn(tx: ReadContext, personId: EntityId, localDate: LocalDate): StoredWeeklyPlan | undefined {
  return storedWeeklyPlan(tx, weeklyPlanRowOn(tx, personId, localDate));
}

/** Die Zeile der Wochenplanversion mit dem größten `valid_from` ≤ Tag, ohne ihre Tage. */
function weeklyPlanRowOn(tx: ReadContext, personId: EntityId, localDate: LocalDate) {
  return sqliteOf(tx)
    .select(weeklyPlanColumns)
    .from(weeklyPlanVersion)
    .where(and(eq(weeklyPlanVersion.personId, personId), lte(weeklyPlanVersion.validFrom, localDate), isNull(weeklyPlanVersion.deletedAt)))
    .orderBy(desc(weeklyPlanVersion.validFrom))
    .limit(1)
    .get();
}

function storedWeeklyPlan(tx: ReadContext, version: { id: string; validFrom: string; serverVersion: string | null } | undefined): StoredWeeklyPlan | undefined {
  if (version === undefined) return undefined;
  const days = sqliteOf(tx).select().from(weeklyPlanDay).where(eq(weeklyPlanDay.weeklyPlanVersionId, version.id)).all();
  return { validFrom: LocalDate.parse(version.validFrom), days: weeklyPlanDaysOf(days), serverVersion: version.serverVersion as ServerVersion | null };
}

/** Person und `valid_from` einer Fassung; für die Tagesmeldung nach einer Pull-Übernahme. */
export function planVersionValidity(tx: ReadContext, kind: PlanVersionKind, id: EntityId) {
  const source = kind === 'zielversion' ? goalVersion : weeklyPlanVersion;
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

/** Gültiger Plan eines Tags aus SQLite samt Vertragsprüfung; die Abbildung teilt die App mit dem `PlanReader` des Servers. */
export function readEffectivePlan(tx: ReadContext, personId: EntityId, localDate: LocalDate): ReturnType<typeof effectivePlanOf> {
  const goal = goalVersionRowOn(tx, personId, localDate);
  const weeklyPlan = weeklyPlanRowOn(tx, personId, localDate);
  const day = weeklyPlan === undefined
    ? undefined
    : sqliteOf(tx).select().from(weeklyPlanDay)
      .where(and(eq(weeklyPlanDay.weeklyPlanVersionId, weeklyPlan.id), eq(weeklyPlanDay.weekday, weekdayOf(localDate))))
      .get();
  return effectivePlanOf(localDate, { goal, weeklyPlan, day });
}
