import { StyleSheet, View } from 'react-native';

import { Button, space } from '../design';
import type { OnboardingStepOutcomeOf, OnboardingStepProps } from '../shell/onboarding-registry';
import { PermissionExplanation, PermissionState } from './PermissionParts';
import { useNotificationPermission, usePermissionRequest } from './NotificationsProvider';
import type { NotificationPermission } from './port';
import { notificationTexts } from './texts';

type Outcome = OnboardingStepOutcomeOf<'notifications'>;

/**
 * Ergebnis nach dem Systemdialog: Nicht erteilt ist `notifications_denied`, auch wenn Android noch einmal
 * fragen dürfte (dann ist die Erlaubnis wieder `undetermined`). Scheitert die Anfrage, hat die Person
 * nichts entschieden, und der Schritt gilt als übersprungen.
 */
function answerOutcome(answer: NotificationPermission | null): Outcome {
  if (answer === null) return { type: 'skipped' };
  return answer === 'granted' ? { type: 'notifications_granted' } : { type: 'notifications_denied' };
}

/**
 * Onboarding-Schritt 10 `notifications` (Spezifikation 5, Abschnitt 8) am Steckplatz der
 * Onboarding-Registry: derselbe Erklärtext wie `notifications.permission` mit der Hauptaktion
 * „Erlauben“. „Überspringen“ zeichnet der Rahmen von Spezifikation 1 und meldet `skipped`. Ist die
 * Erlaubnis schon entschieden, zeigt der Schritt den Stand mit „Weiter“.
 */
export function NotificationsStep({ complete }: OnboardingStepProps<'notifications'>) {
  const permission = useNotificationPermission();
  const { asking, request } = usePermissionRequest();

  const allow = async () => complete(answerOutcome(await request()));

  return (
    <View style={styles.step}>
      <PermissionExplanation />
      {permission === 'granted' || permission === 'denied' ? (
        <>
          <PermissionState permission={permission} />
          <Button label={notificationTexts.next} variant="primary" block onPress={() => complete(answerOutcome(permission))} />
        </>
      ) : (
        <Button label={notificationTexts.allow} variant="primary" block loading={asking || permission === null} onPress={() => void allow()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ step: { gap: space[4] } });
