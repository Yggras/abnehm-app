import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { EntityId } from '@abnehm/contracts/base';

import { Button, ListGroup, Notice, Skeleton, space, Text } from '../design';
import { closeRoute, type RouteScreenProps } from '../navigation';
import { useAppPlan, type BudgetSuggestionView, type Plan } from '../plan';
import { useMessageHost } from '../shell/MessageHost';
import { ScreenFrame } from '../shell/ScreenFrame';
import { titleOf } from '../shell/texts';
import { ValueRow } from './BudgetDerivation';
import { budgetSuggestionTexts as texts, goalTexts } from './texts';

/**
 * Sheet `plan.budget_suggestion` (Spezifikation 1, Abschnitt 7; #151), geöffnet über den Hinweis der
 * Ernährungskarte auf „Heute“. Es zeigt bisheriges und vorgeschlagenes Budget mit einer neutralen
 * Begründung. „Übernehmen ab morgen“ legt über das Plan-Modul die Zielversion ab morgen an, „Nicht jetzt“
 * lehnt ab; beides schließt das Sheet. Ohne Entscheidung ändert sich nichts. Ein entschiedener, überholter
 * oder unbekannter Vorschlag zeigt nur seinen Stand, ohne Aktionen.
 */
export function BudgetSuggestionScreen({ target }: RouteScreenProps<'plan.budget_suggestion'>) {
  const plan = useAppPlan();
  return (
    <ScreenFrame title={titleOf(target)} presentation="modal">
      {plan === null ? (
        <View accessibilityLabel={texts.loading}>
          <Skeleton width="60%" />
        </View>
      ) : (
        <Suggestion plan={plan} suggestionId={target.suggestionId} />
      )}
    </ScreenFrame>
  );
}

function Suggestion({ plan, suggestionId }: { plan: Plan; suggestionId: EntityId }) {
  const { showMessage } = useMessageHost();
  // Gelesen wird beim Öffnen und nach einer Entscheidung, die nicht mehr möglich war. Überholt ein Pull den
  // Vorschlag bei offenem Sheet, zeigt das Tippen den neuen Stand, ohne etwas zu ändern.
  const [view, setView] = useState<BudgetSuggestionView>(() => plan.budgetSuggestion(suggestionId));

  if (view.type !== 'offen') {
    return <Notice tone="neutral" text={view.type === 'unbekannt' ? texts.closed.unbekannt : texts.closed[view.status]} />;
  }

  function decide(decision: 'annehmen' | 'ablehnen') {
    const result = plan.decideBudgetSuggestion(suggestionId, decision);
    if (result.type === 'nicht_offen') {
      setView(plan.budgetSuggestion(suggestionId));
      return;
    }
    if (result.type === 'angenommen') showMessage({ messageKey: 'ziele.budgetvorschlag_uebernommen', values: {} });
    closeRoute();
  }

  return (
    <>
      <ListGroup>
        <ValueRow title={texts.previous} value={texts.perDay(view.previousBudgetKcal)} />
        <ValueRow title={texts.suggested} value={texts.perDay(view.suggestedBudgetKcal)} />
      </ListGroup>
      <Text>{texts.reason(view.direction, view.pace)}</Text>
      <Text>{texts.effect(view.direction, view.differenceKcal)}</Text>
      <Text tone="inkMuted">{texts.onlyWithConfirmation}</Text>
      <View style={styles.actions}>
        <Button label={texts.accept} block onPress={() => decide('annehmen')} />
        <Button label={texts.decline} variant="secondary" block onPress={() => decide('ablehnen')} />
      </View>
      <Text variant="caption" tone="inkMuted">
        {goalTexts.disclaimer}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space[3] },
});
