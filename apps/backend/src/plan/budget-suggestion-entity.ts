import { and, eq, isNull } from 'drizzle-orm';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { budgetSuggestionId, BudgetSuggestionRecord, BudgetSuggestionUpsert, type BudgetSuggestionStatus } from '@abnehm/contracts/plan';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import type { DbExecutor } from '../database.ts';
import { budgetSuggestion } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import { ownedEntity } from '../sync/registry.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';

// Der Budgetvorschlag im Sync (Spezifikation 1, Abschnitte 7 und 11; #150): generisches Upsert innerhalb der
// eigenen Eigentumsgrenze, Last-Write-Wins, ohne Löschen. Lesen und schreiben darf nur der Eigentümer (Regel
// der Ressource `budget_suggestion`). Die App legt ihn `offen` an und setzt ihn auf `abgelehnt` oder
// `ueberholt`. Fachlich prüft der Server:
// - Die ID ist die deterministische aus Person und Zeitraumende, dem natürlichen Schlüssel. Zwei Geräte, die
//   am selben Tag prüfen, treffen so dieselbe Zeile; eine andere ID scheiterte sonst am eindeutigen Schlüssel.
// - Zeitraum, Budgets und Richtung bleiben, wie der Vorschlag angelegt wurde.
// - Der Status ändert sich nur aus `offen` heraus. Ein entschiedener (`abgelehnt`, `angenommen`) oder
//   überholter Vorschlag bleibt, wie er ist; ein verspäteter Upsert eines anderen Geräts endet mit `conflict`
//   samt kanonischem Stand. So kehrt kein Vorschlag nach `offen` zurück, und die 14-Tage-Sperre ab der
//   Entscheidung hält.
// - `angenommen` setzt allein der Fachbefehl `acceptBudgetSuggestion` (#151), zusammen mit der Zielversion
//   ab morgen.

const record = (row: typeof budgetSuggestion.$inferSelect): BudgetSuggestionRecord =>
  BudgetSuggestionRecord.parse({
    personId: EntityId.parse(row.personId),
    periodFrom: LocalDate.parse(row.periodFrom),
    periodTo: LocalDate.parse(row.periodTo),
    previousBudgetMilliKcal: row.previousBudgetMilliKcal,
    suggestedBudgetMilliKcal: row.suggestedBudgetMilliKcal,
    direction: row.direction,
    status: row.status,
    createdAt: Instant.parse(row.createdAt.toISOString()),
    updatedAt: Instant.parse(row.updatedAt.toISOString()),
  });

export const budgetSuggestionEntity = ownedEntity({
  entityType: 'budget_suggestion',
  resource: 'budget_suggestion',
  table: budgetSuggestion,
  upsert: BudgetSuggestionUpsert,
  deletable: false,
  async validate(tx, { entityId, ownerPersonId, payload, exists }) {
    if (entityId !== budgetSuggestionId(ownerPersonId, payload.periodTo) || payload.status === 'angenommen') return 'invalid_payload';
    if (!exists) return null;
    const [stored] = await tx.select().from(budgetSuggestion).where(eq(budgetSuggestion.id, entityId));
    if (stored === undefined) return null;
    const unchanged =
      stored.periodFrom === payload.periodFrom &&
      stored.previousBudgetMilliKcal === payload.previousBudgetMilliKcal &&
      stored.suggestedBudgetMilliKcal === payload.suggestedBudgetMilliKcal &&
      stored.direction === payload.direction;
    if (!unchanged) return 'invalid_payload';
    return stored.status === 'offen' || stored.status === payload.status ? null : 'conflict';
  },
  columns: (payload) => ({
    periodFrom: payload.periodFrom,
    periodTo: payload.periodTo,
    previousBudgetMilliKcal: payload.previousBudgetMilliKcal,
    suggestedBudgetMilliKcal: payload.suggestedBudgetMilliKcal,
    direction: payload.direction,
    status: payload.status,
  }),
  record,
});

/**
 * Setzt die offenen Vorschläge der Person auf `ueberholt` (Spezifikation 1, Abschnitt 7: „Jede andere neue
 * Zielversion setzt einen offenen Vorschlag in derselben Transaktion auf `ueberholt`“). `createGoalVersion`
 * ruft es in seiner Transaktion auf. Die App des schreibenden Geräts hat ihren offenen Vorschlag meist schon
 * selbst überholt; hier erreicht die Regel auch einen Vorschlag, den dieses Gerät noch nicht gezogen hatte.
 * Die geänderten Vorschläge gehen als kanonische Änderungen in die Antwort und ins Änderungsprotokoll.
 */
export async function supersedeOpenBudgetSuggestions(tx: DbExecutor, personId: EntityId, at: Date): Promise<CanonicalChange[]> {
  const open = await tx.select({ id: budgetSuggestion.id }).from(budgetSuggestion)
    .where(and(eq(budgetSuggestion.personId, personId), eq(budgetSuggestion.status, 'offen'), isNull(budgetSuggestion.deletedAt)));
  const changes: CanonicalChange[] = [];
  for (const { id } of open) changes.push(await setBudgetSuggestionStatus(tx, personId, EntityId.parse(id), 'ueberholt', at));
  return changes;
}

/**
 * Setzt den Status eines Vorschlags der Person serverseitig, mit neuer Serverversion und Eintrag im
 * Änderungsprotokoll, und liefert seinen kanonischen Stand. Nur Fachregeln des Servers rufen es auf:
 * Überholen durch eine neue Zielversion und `acceptBudgetSuggestion`.
 */
export async function setBudgetSuggestionStatus(
  tx: DbExecutor,
  personId: EntityId,
  id: EntityId,
  status: Extract<BudgetSuggestionStatus, 'angenommen' | 'ueberholt'>,
  at: Date,
): Promise<CanonicalChange> {
  const serverVersion = await nextServerVersion(tx);
  await tx.update(budgetSuggestion).set({ status, updatedAt: at, serverVersion }).where(eq(budgetSuggestion.id, id));
  await recordChange(tx, { position: serverVersion, entityType: budgetSuggestionEntity.entityType, entityId: id, operation: 'upsert', ownerPersonId: personId, createdAt: at });
  return canonicalAfterWrite(tx, budgetSuggestionEntity, id);
}
