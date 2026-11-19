import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { Button, ListGroup, Notice, space, Stepper, Text } from '../design';
import { previewGoals } from '../plan';
import { budgetDerivationRows, ValueRow } from '../plan-settings/BudgetDerivation';
import { kcalText, litreText } from '../plan-settings/texts';
import { SectionTitle } from '../settings/SectionTitle';
import { resultTexts as texts } from './goal-texts';
import type { OnboardingDraftChange } from './draft';
import { budgetChoiceOf, onboardingGoalDraft } from './goals';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepTitles } from './steps';
import { onboardingTexts } from './texts';

export type ResultStepProps = {
  /** Zurück zu Schritt 6; alle Eingaben bleiben im Entwurf. */
  onBack: () => void;
  /** Weiter zu Schritt 8, Wasser- und Sportziel liegen dann im Entwurf. */
  onNext: () => void;
};

/**
 * Schritt 7 „Ergebnis“ (Spezifikation 1, Abschnitte 3 und 9): Kalorienbudget mit aufklappbarer Herleitung
 * (Grundumsatz, Aktivitätsstufe, Defizit) und gegebenenfalls dem Anhebungshinweis, dazu Wasser- und
 * Sportziel. Jeder Wert ist direkt änderbar: das Budget in 10-kcal-Schritten zwischen Untergrenze und
 * Gesamtumsatz, im erzwungenen Haltemodus nicht; Wasser in 250-ml-, Sport in 10-Minuten-Schritten. Alle
 * Werte kommen aus der Vorschau des Zielrechners und liegen sofort im lokalen Entwurf. Ohne Netz.
 */
export function ResultStep({ onBack, onNext }: ResultStepProps) {
  const onboarding = useOnboarding();
  const today = useClock().read().localDate;
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  const [derivationShown, setDerivationShown] = useState(false);
  // Vorauswahl und Eingaben des Entwurfs; die Herleitung nennt die Aktivitätsstufe daraus.
  const goals = onboardingGoalDraft(draft, today);
  const result = goals === null ? null : previewGoals(goals, today);
  const calculation = goals !== null && result?.type === 'berechnet' ? { ...result, activityLevel: goals.activityLevel } : null;
  const choice = budgetChoiceOf(draft, today);
  const change = (next: OnboardingDraftChange) => setDraft(onboarding.updateDraft(next));

  function next() {
    if (calculation === null) return;
    // „Weiter“ übernimmt die gezeigten Vorschläge für Wasser und Sport.
    onboarding.updateDraft({ waterTargetMl: calculation.water.targetMl, weeklySportTargetMinutes: calculation.sport.weeklyTargetMinutes });
    onNext();
  }

  return (
    <OnboardingFrame
      step="ergebnis"
      title={stepTitles.ergebnis}
      onBack={onBack}
      primary={{ label: onboardingTexts.next, onPress: next, disabled: calculation === null }}
    >
      {calculation === null ? (
        <Notice tone="hint" icon="info" text={texts.incomplete} />
      ) : (
        <>
          <Text>{texts.intro}</Text>

          <View style={styles.section}>
            <ListGroup>
              {choice === null || choice.range === null ? (
                // Warum es sich nicht ändern lässt, sagt der Hinweis zum Haltemodus direkt darunter.
                <ValueRow title={texts.budget} value={kcalText(calculation.calorieBudget.kcal)} />
              ) : (
                <Stepper
                  label={texts.budget}
                  value={calculation.calorieBudget.kcal}
                  valueText={kcalText(calculation.calorieBudget.kcal)}
                  {...choice.range}
                  stacked
                  hint={texts.budgetHint(calculation.budgetSource, choice.range.min, choice.range.max)}
                  // Zurück auf genau den berechneten Wert heißt wieder „berechnet“.
                  onChange={(kcal) => change({ manualBudgetKcal: kcal === choice.calculatedKcal ? undefined : kcal })}
                />
              )}
            </ListGroup>
            {/* Hinweise direkt unter dem Budget, das sie erklären; danach die Textaktionen (Impeccable-critique). */}
            {calculation.budgetRaisedToLowerBound ? <Notice tone="hint" icon="info" text={texts.raised} /> : null}
            {calculation.hints.includes('maintenance_forced') ? (
              <Notice tone="hint" icon="info" text={texts.maintenanceForced(calculation.safetyTriggers)} />
            ) : null}
            <View style={styles.actions}>
              {calculation.budgetSource === 'manuell' && choice !== null ? (
                <Button label={texts.useCalculated(choice.calculatedKcal)} variant="text" onPress={() => change({ manualBudgetKcal: undefined })} />
              ) : null}
              <Button
                label={derivationShown ? texts.hideDerivation : texts.showDerivation}
                variant="text"
                onPress={() => setDerivationShown((shown) => !shown)}
              />
            </View>
            {derivationShown ? (
              <ListGroup>
                {budgetDerivationRows({
                  basalKcal: calculation.basalMetabolicRate.kcal,
                  activityLevel: calculation.activityLevel,
                  activityFactor: calculation.activityFactor,
                  totalKcal: calculation.totalEnergyExpenditure.kcal,
                  deficit: calculation.deficit === null || calculation.pace === null ? null : { pace: calculation.pace, kcal: calculation.deficit.kcal },
                  lowerBoundKcal: calculation.lowerBound.kcal,
                })}
              </ListGroup>
            ) : null}
          </View>

          <View style={styles.section}>
            <SectionTitle>{texts.goals}</SectionTitle>
            <ListGroup>
              <Stepper
                label={texts.water}
                value={calculation.water.targetMl}
                valueText={litreText(calculation.water.targetMl)}
                {...calculation.water.range}
                hint={texts.waterHint}
                onChange={(waterTargetMl) => change({ waterTargetMl })}
              />
              <Stepper
                label={texts.sport}
                value={calculation.sport.weeklyTargetMinutes}
                valueText={texts.sportStep(calculation.sport.weeklyTargetMinutes)}
                {...calculation.sport.range}
                hint={texts.sportHint}
                onChange={(weeklySportTargetMinutes) => change({ weeklySportTargetMinutes })}
              />
            </ListGroup>
          </View>
        </>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  /** Textaktionen linksbündig untereinander, wie die übrigen Inhalte. */
  actions: { alignItems: 'flex-start' },
});
