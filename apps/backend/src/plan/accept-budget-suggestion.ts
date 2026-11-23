import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import { AcceptBudgetSuggestion, acceptBudgetSuggestionKey, budgetSuggestionOfAcceptKey } from '@abnehm/contracts/plan';

import { policies } from '../authorization/authorization.ts';
import { budgetSuggestion } from '../db/schema/index.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { budgetSuggestionEntity, setBudgetSuggestionStatus } from './budget-suggestion-entity.ts';
import { saveGoalVersion } from './goal-versions.ts';

// Budgetvorschlag annehmen (Spezifikation 1, Abschnitte 7 und 11; #151): Der Fachbefehl legt atomar eine
// Zielversion ab morgen mit dem Budget des Vorschlags an und setzt den Vorschlag auf `angenommen`. Nur er
// setzt diesen Status; der Upsert des Vorschlags lehnt ihn ab (#150). Lesen und Befehl darf nur der
// Eigentümer des Vorschlags (Regel der Ressource `budget_suggestion`).
//
// Der Schlüssel ist einer je Vorschlag. Eine Wiederholung derselben Operation und die Annahme desselben
// Vorschlags durch ein zweites Gerät treffen so dieselbe Annahme, und es entsteht genau eine Zielversion.

export const acceptBudgetSuggestionCommand: ServerCommand<AcceptBudgetSuggestion> = {
  type: 'acceptBudgetSuggestion',
  identity: 'none',
  policy: policies.resource('budget_suggestion', 'befehl'),
  payload: AcceptBudgetSuggestion,
  // Ein Schlüssel ohne Vorschlag nennt keine Ressource; die Autorisierung verweigert ihn.
  target: (operation) => {
    const suggestionId = budgetSuggestionOfAcceptKey(operation.businessKey);
    return suggestionId === null ? {} : { id: suggestionId };
  },
  canonicalRequest: (operation) => AcceptBudgetSuggestion.parse(operation.payload),
  duplicate: () => [],
  async execute(tx, { actor, payload, businessKey, at }) {
    const { suggestionId, goalVersion } = payload;
    if (businessKey !== acceptBudgetSuggestionKey(suggestionId)) throw new CommandRejection('invalid_payload');
    const [stored] = await tx.select().from(budgetSuggestion).where(eq(budgetSuggestion.id, suggestionId));
    if (stored === undefined || stored.deletedAt !== null) throw new CommandRejection('invalid_payload');
    // Entschieden oder überholt: Die App übernimmt den kanonischen Stand, und ihr Hinweis verschwindet.
    if (stored.status !== 'offen') throw new CommandRejection('conflict', await canonicalAfterWrite(tx, budgetSuggestionEntity, suggestionId));
    // Die Zielversion trägt genau das vorgeschlagene Budget und gilt erst nach dem geprüften Zeitraum.
    if (goalVersion.calorieBudgetMilliKcal !== stored.suggestedBudgetMilliKcal || goalVersion.validFrom <= stored.periodTo) {
      throw new CommandRejection('invalid_payload');
    }
    // Erst entscheiden, dann die Fassung schreiben: Sie überholt so nur andere offene Vorschläge. Lehnt
    // `saveGoalVersion` das Ersetzen einer wirksamen Fassung ab, rollt der Savepoint beides zurück.
    const accepted = await setBudgetSuggestionStatus(tx, actor.personId, EntityId.parse(suggestionId), 'angenommen', at);
    const saved = await saveGoalVersion(tx, actor.personId, goalVersion, at);
    return { changes: [accepted, ...saved.changes], idMappings: [] };
  },
};
