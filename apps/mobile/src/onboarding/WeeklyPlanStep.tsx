import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Weekday } from '@abnehm/contracts/base';

import { useClock } from '../clock/clock-context';
import { Chip, ListGroup, ListRow, Notice, space, Text } from '../design';
import { SectionTitle } from '../settings/SectionTitle';
import type { OnboardingDraftChange } from './draft';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepTitles } from './steps';
import { toggledSportDays, weekChoiceOf, weekPreviewOf } from './week';
import { weeklyPlanTexts as texts } from './week-texts';

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
 * gegenseitig; der gesperrte Chip und ein Satz darunter sagen, warum. Unter den Sporttagen steht die
 * Mindestdauer einer Sporteinheit, darunter die Tagesziele je Wochentag. „Plan speichern“ ruft über das
 * Onboarding-Modul „Erstplan speichern“ auf, ohne Netz; nach einem Fehler heißt die Hauptaktion „Erneut
 * versuchen“. Gilt heute schon ein Plan, etwa nach „Zurück“ aus Schritt 9, sagt der Schritt, dass
 * Änderungen ab morgen gelten.
 */
export function WeeklyPlanStep({ onBack, onSaved }: WeeklyPlanStepProps) {
  const onboarding = useOnboarding();
  const today = useClock().read().localDate;
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  const [fromTomorrow] = useState(() => onboarding.hasPlanToday());
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
      {fromTomorrow ? <Notice tone="hint" icon="info" text={texts.fromTomorrow} /> : null}

      <View style={styles.section}>
        <SectionTitle>{texts.sportDays}</SectionTitle>
        <WeekdayChips
          selection="multiple"
          isSelected={(weekday) => choice.sportDays.includes(weekday)}
          lockedHint={(weekday) => (weekday === choice.weighDay ? texts.weighDayLocked(weekday) : null)}
          onPress={(weekday) => change({ sportDays: toggledSportDays(choice, weekday) })}
        />
        {/* Die Folge der Wahl direkt unter den Chips, die sie auslösen (Impeccable-critique). */}
        {preview === null ? null : (
          <Text variant="caption">
            {preview.minimumSessionMinutes === null
              ? texts.noSportDay(preview.weeklySportTargetMinutes)
              : texts.minimumSession(preview.minimumSessionMinutes, preview.weeklySportTargetMinutes, choice.sportDays.length)}
          </Text>
        )}
        <Text variant="caption" tone="inkMuted">
          {texts.weighDayLocked(choice.weighDay)}
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>{texts.weighDay}</SectionTitle>
        <WeekdayChips
          selection="single"
          groupLabel={texts.weighDay}
          isSelected={(weekday) => weekday === choice.weighDay}
          lockedHint={(weekday) => (choice.sportDays.includes(weekday) ? texts.sportDayLocked(weekday) : null)}
          onPress={(weekday) => change({ weighDay: weekday })}
        />
        {choice.sportDays.length > 0 ? (
          <Text variant="caption" tone="inkMuted">
            {texts.sportDaysLocked}
          </Text>
        ) : null}
      </View>

      {/* Hinweise nach „Plan speichern“ über der Vorschau, damit sie ohne Scrollen sichtbar bleiben. */}
      {state === 'fehlgeschlagen' ? <Notice tone="hint" icon="info" text={texts.failed} /> : null}
      {state === 'unvollstaendig' || preview === null ? <Notice tone="hint" icon="info" text={texts.incomplete} /> : null}

      {preview === null ? null : (
        <View style={styles.section}>
          <SectionTitle>{texts.preview}</SectionTitle>
          {/* Plätze 1 und 2 gelten jeden Tag; je Zeile steht nur der dritte, der die Tage unterscheidet. */}
          <Text>{texts.everyDay(preview.everyDay)}</Text>
          <ListGroup>
            {preview.days.map(({ weekday, bausteine, thirdBaustein }) => (
              <ListRow
                key={weekday}
                title={texts.weekday(weekday)}
                value={texts.baustein(thirdBaustein)}
                accessibilityLabel={texts.dayLabel(weekday, bausteine)}
              />
            ))}
          </ListGroup>
        </View>
      )}
    </OnboardingFrame>
  );
}

/**
 * Sieben quadratische Wochentag-Chips Mo–So. Ein gesperrter Tag trägt seinen Grund als Hinweis für
 * Screenreader; der sichtbare Satz steht unter der Gruppe.
 */
function WeekdayChips({
  selection,
  groupLabel,
  isSelected,
  lockedHint,
  onPress,
}: {
  selection: 'single' | 'multiple';
  /** Name der Einzelauswahl als `radiogroup`. */
  groupLabel?: string;
  isSelected: (weekday: Weekday) => boolean;
  /** Grund der Sperre; `null`, wenn der Tag wählbar ist. */
  lockedHint: (weekday: Weekday) => string | null;
  onPress: (weekday: Weekday) => void;
}) {
  return (
    <View accessibilityRole={selection === 'single' ? 'radiogroup' : undefined} accessibilityLabel={groupLabel} style={styles.chips}>
      {Weekday.options.map((weekday) => {
        const hint = lockedHint(weekday);
        return (
          <Chip
            key={weekday}
            label={texts.weekdayShort(weekday)}
            accessibilityLabel={texts.weekday(weekday)}
            accessibilityHint={hint ?? undefined}
            selection={selection}
            square
            selected={isSelected(weekday)}
            disabled={hint !== null}
            onPress={() => onPress(weekday)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  /** Sieben quadratische Chips passen mit 4 dp Abstand in eine Zeile des iPhone SE; bei großer Schrift brechen sie um. */
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
