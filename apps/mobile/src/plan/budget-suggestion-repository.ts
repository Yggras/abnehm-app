import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { EntityId, Instant, type ServerVersion } from '@abnehm/contracts/base';
import { BudgetSuggestionRecord, type BudgetSuggestionStatus, BudgetSuggestionUpsert } from '@abnehm/contracts/plan';

import type { ReadContext, TransactionContext } from '../local-db';
import { budgetSuggestion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository des Budgetvorschlags (Spezifikation 1, Abschnitt 7): neben dem Sync-Adapter die einzige
// Stelle der App, die die Tabelle `budget_suggestion` sieht. Andere Bereiche lesen Vorschläge nie; die
// Ernährungskarte erhält ihren Hinweis über die „Heute“-Beiträge des Plan-Moduls.

/** Ein gespeicherter Vorschlag, geprüft wie ein kanonischer Datensatz, samt ID und Serverversion. */
export type StoredBudgetSuggestion = Readonly<{ id: EntityId; record: BudgetSuggestionRecord; serverVersion: ServerVersion | null }>;

type Row = typeof budgetSuggestion.$inferSelect;

function stored(row: Row | undefined): StoredBudgetSuggestion | undefined {
  if (row === undefined) return undefined;
  const { id, deletedAt: _deletedAt, serverVersion, ...record } = row;
  return { id: EntityId.parse(id), record: BudgetSuggestionRecord.parse(record), serverVersion: serverVersion as ServerVersion | null };
}

const present = (personId: EntityId) => and(eq(budgetSuggestion.personId, personId), isNull(budgetSuggestion.deletedAt));

/** Der Vorschlag mit dieser ID, gleich in welchem Status. */
export function readBudgetSuggestion(tx: ReadContext, id: EntityId): StoredBudgetSuggestion | undefined {
  return stored(sqliteOf(tx).select().from(budgetSuggestion).where(eq(budgetSuggestion.id, id)).get());
}

/** Der offene Vorschlag der Person; es gibt höchstens einen, weil die Prüfung nur ohne offenen einen anlegt. */
export function readOpenBudgetSuggestion(tx: ReadContext, personId: EntityId): StoredBudgetSuggestion | undefined {
  return stored(
    sqliteOf(tx)
      .select()
      .from(budgetSuggestion)
      .where(and(present(personId), eq(budgetSuggestion.status, 'offen')))
      .orderBy(desc(budgetSuggestion.periodTo))
      .limit(1)
      .get(),
  );
}

/**
 * Zeitpunkt der letzten Entscheidung (`angenommen` oder `abgelehnt`): die letzte Änderung des zuletzt
 * entschiedenen Vorschlags. Ein entschiedener Vorschlag ändert sich danach nicht mehr.
 */
export function readLastDecisionAt(tx: ReadContext, personId: EntityId): Instant | undefined {
  const row = sqliteOf(tx)
    .select({ updatedAt: budgetSuggestion.updatedAt })
    .from(budgetSuggestion)
    .where(and(present(personId), inArray(budgetSuggestion.status, ['angenommen', 'abgelehnt'] satisfies BudgetSuggestionStatus[])))
    .orderBy(desc(budgetSuggestion.updatedAt))
    .limit(1)
    .get();
  return row === undefined ? undefined : Instant.parse(row.updatedAt);
}

/** Die Nutzlast eines gespeicherten Vorschlags mit einem anderen Status, etwa für den Upsert eines Statuswechsels. */
export function withStatus(record: BudgetSuggestionRecord, status: BudgetSuggestionStatus): BudgetSuggestionUpsert {
  const { personId: _personId, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = record;
  return BudgetSuggestionUpsert.parse({ ...values, status });
}

/** Legt einen neuen Vorschlag an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeBudgetSuggestion(tx: TransactionContext, id: EntityId, personId: EntityId, values: BudgetSuggestionUpsert, at: Instant): void {
  const fields = { ...values, updatedAt: at };
  sqliteOf(tx)
    .insert(budgetSuggestion)
    .values({ ...fields, id, personId, createdAt: at })
    .onConflictDoUpdate({ target: budgetSuggestion.id, set: fields })
    .run();
}
