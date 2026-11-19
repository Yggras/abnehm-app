import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Weekday } from '@abnehm/contracts/base';

import { useClock } from '../clock/clock-context';
import { Chip, ListGroup, ListRow, Notice, space, Text } from '../design';
import { SectionTitle } from '../settings/SectionTitle';
import { weeklyPlanTexts as texts } from './goal-texts';
import type { OnboardingDraftChange } from './draft';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepTitles } from './steps';
import { toggledSportDays, weekChoiceOf, weekPreviewOf } from './week';

export type WeeklyPlanStepProps = {
  /** Zurück zu Schritt 7; die Wahl bleibt im Entwurf. */
  onBack: () => void;
  /** Weiter zu Schritt 9, sobald der Plan gespeichert ist. */
  onSaved: () => void;
};

type SaveState = 'bereit' | 'speichert' | 'fehlgeschlagen' | 'unvollstaendig';

/**
 * Schritt 8 „Wochenplan“ (Spezifikation 1, Abschnitte 4 und 9): Chips Mo–So für die Sporttage und eine
 * Einzelauswahl für den Wiegetag, vorausgewählt Di/Do/Sa und Montag. Sporttag und Wiegetag sperren sich
 * gegenseitig; der gesperrte Chip und ein Satz darunter sagen, warum. Darunter die drei Tagesziele je
 * Wochentag und die Mindestdauer einer Sporteinheit. „Plan speichern“ ruft über das Onboarding-Modul
 * „Erstplan speichern“ auf, ohne Netz; nach einem Fehler heißt die Hauptaktion „Erneut versuchen“.
 */
export function WeeklyPlanStep({ onBack, onSaved }: WeeklyPlanStepProps) {
  const onboarding = useOnboarding();
  const today = useClock().read().localDate;
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  const [state, setState] = useState<SaveState>('bereit');
  const choice = weekChoiceOf(draft);
  const preview = weekPreviewOf(draft, today);
  const change = (next: OnboardingDraftChange) => setDraft(onboarding.updateDraft(next));

  async function save() {
    setState('speichert');
    const saved = await onboarding.savePlan();
    if (saved.type === 'gespeichert') {
      onSaved();
      return;
    }
    setState(saved.type);
  }

  return (
    <OnboardingFrame
      step="wochenplan"
      title={stepTitles.wochenplan}
      onBack={onBack}
      primary={{
        label: state === 'fehlgeschlagen' ? texts.retry : texts.save,
        onPress: () => void save(),
        disabled: preview === null,
        loading: state === 'speichert',
      }}
    >
      <Text>{texts.intro}</Text>

      <View style={styles.section}>
        <SectionTitle>{texts.sportDays}</SectionTitle>
        <View style={styles.chips}>
          {Weekday.options.map((weekday) => {
            const locked = weekday === choice.weighDay;
            return (
              <Chip
                key={weekday}
                label={texts.weekdayShort(weekday)}
                accessibilityLabel={texts.weekday(weekday)}
                accessibilityHint={locked ? texts.weighDayLocked(weekday) : undefined}
                selection="multiple"
                square
                selected={choice.sportDays.includes(weekday)}
                disabled={locked}
                onPress={() => change({ sportDays: toggledSportDays(choice, weekday) })}
              />
            );
          })}
        </View>
        <Text variant="caption" tone="inkMuted">
          {texts.weighDayLocked(choice.weighDay)}
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>{texts.weighDay}</SectionTitle>
        <View accessibilityRole="radiogroup" accessibilityLabel={texts.weighDay} style={styles.chips}>
          {Weekday.options.map((weekday) => {
            const locked = choice.sportDays.includes(weekday);
            return (
              <Chip
                key={weekday}
                label={texts.weekdayShort(weekday)}
                accessibilityLabel={texts.weekday(weekday)}
                accessibilityHint={locked ? texts.sportDayLocked(weekday) : undefined}
                selection="single"
                square
                selected={weekday === choice.weighDay}
                disabled={locked}
                onPress={() => change({ weighDay: weekday })}
              />
            );
          })}
        </View>
        {choice.sportDays.length > 0 ? (
          <Text variant="caption" tone="inkMuted">
            {texts.sportDaysLocked}
          </Text>
        ) : null}
      </View>

      {preview === null ? (
        <Notice tone="hint" icon="info" text={texts.incomplete} />
      ) : (
        <View style={styles.section}>
          <SectionTitle>{texts.preview}</SectionTitle>
          <ListGroup>
            {preview.days.map(({ weekday, bausteine }) => (
              <ListRow
                key={weekday}
                title={texts.weekday(weekday)}
                subtitle={texts.dayGoals(bausteine)}
                accessibilityLabel={texts.dayLabel(weekday, bausteine)}
              />
            ))}
          </ListGroup>
          <Text variant="caption" tone="inkMuted">
            {preview.minimumSessionMinutes === null
              ? texts.noSportDay(preview.weeklySportTargetMinutes)
              : texts.minimumSession(preview.minimumSessionMinutes, preview.weeklySportTargetMinutes, choice.sportDays.length)}
          </Text>
        </View>
      )}

      {state === 'fehlgeschlagen' ? <Notice tone="hint" icon="info" text={texts.failed} /> : null}
      {state === 'unvollstaendig' ? <Notice tone="hint" icon="info" text={texts.incomplete} /> : null}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  /** Sieben quadratische Chips passen mit 4 dp Abstand in eine Zeile des iPhone SE; bei großer Schrift brechen sie um. */
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
