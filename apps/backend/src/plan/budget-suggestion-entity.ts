import { eq } from 'drizzle-orm';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { budgetSuggestionId, BudgetSuggestionRecord, BudgetSuggestionUpsert } from '@abnehm/contracts/plan';

import { budgetSuggestion } from '../db/schema/index.ts';
import { ownedEntity } from '../sync/registry.ts';

// Der Budgetvorschlag im Sync (Spezifikation 1, Abschnitte 7 und 11; #150): generisches Upsert innerhalb der
// eigenen Eigentumsgrenze, Last-Write-Wins, ohne Löschen. Lesen und schreiben darf nur der Eigentümer (Regel
// der Ressource `budget_suggestion`). Die App legt ihn `offen` an und setzt ihn auf `abgelehnt` oder
// `ueberholt`. Fachlich prüft der Server:
// - Die ID ist die deterministische aus Person und Zeitraumende, dem natürlichen Schlüssel. Zwei Geräte, die
//   am selben Tag prüfen, treffen so dieselbe Zeile; eine andere ID scheiterte sonst am eindeutigen Schlüssel.
// - Zeitraum, Budgets und Richtung bleiben, wie der Vorschlag angelegt wurde; nur der Status ändert sich.
// - `angenommen` setzt allein der Fachbefehl `acceptBudgetSuggestion` (#151), zusammen mit der Zielversion
//   ab morgen. Danach ist der Vorschlag entschieden und ändert sich nicht mehr.

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
    return unchanged && stored.status !== 'angenommen' ? null : 'invalid_payload';
  },
  columns: (payload) => ({
    periodFrom: payload.periodFrom,
    periodTo: payload.periodTo,
    previousBudgetMilliKcal: payload.previousBudgetMilliKcal,
    suggestedBudgetMilliKcal: payload.suggestedBudgetMilliKcal,
    direction: payload.direction,
    status: payload.status,
  }),
  record: (row): BudgetSuggestionRecord =>
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
    }),
});
