import { useState } from 'react';

import { ActivityLevel } from '@abnehm/contracts/person';

import { ListGroup, ListRow, Notice, Text } from '../design';
import { activityTexts as texts } from './goal-texts';
import { preselectedActivityLevel } from './goals';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepTitles } from './steps';
import { activityLevelParts, onboardingTexts } from './texts';

export type ActivityLevelStepProps = {
  /** Zurück zu Schritt 4; die Wahl bleibt im Entwurf. */
  onBack: () => void;
  /** Weiter zu Schritt 6, die gezeigte Stufe liegt dann im Entwurf. */
  onNext: () => void;
};

/**
 * Schritt 5 „Aktivitätsstufe“ (Spezifikation 1, Abschnitte 3 und 9): drei Karten als Einzelauswahl, die
 * niedrigste vorausgewählt, dazu der Hinweis „im Zweifel die niedrigere“. Die Wahl liegt sofort im lokalen
 * Entwurf; „Weiter“ übernimmt auch die Vorauswahl. Ohne Netz.
 */
export function ActivityLevelStep({ onBack, onNext }: ActivityLevelStepProps) {
  const onboarding = useOnboarding();
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  const selected = draft.activityLevel ?? preselectedActivityLevel;

  function next() {
    if (draft.activityLevel === undefined) onboarding.updateDraft({ activityLevel: selected });
    onNext();
  }

  return (
    <OnboardingFrame step="aktivitaetsstufe" title={stepTitles.aktivitaetsstufe} onBack={onBack} primary={{ label: onboardingTexts.next, onPress: next }}>
      <Text>{texts.intro}</Text>
      {/* Je Stufe eine Karte: eine Zeile des Design-Systems mit Einzelauswahl, ausgewählt mit Häkchen (#95). */}
      {ActivityLevel.options.map((level) => (
        <ListGroup key={level}>
          <ListRow
            title={activityLevelParts[level].level}
            subtitle={activityLevelParts[level].everyday}
            accessibilityLabel={`${activityLevelParts[level].level}, ${activityLevelParts[level].everyday}`}
            selected={selected === level}
            onPress={() => setDraft(onboarding.updateDraft({ activityLevel: level }))}
          />
        </ListGroup>
      ))}
      <Notice tone="neutral" icon="info" text={texts.doubt} />
    </OnboardingFrame>
  );
}
