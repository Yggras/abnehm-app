import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { OnboardingStepOutcome } from '@abnehm/contracts/onboarding';

import { Button, space } from '../design';
import type { OnboardingStepProps } from '../shell/onboarding-registry';
import { PermissionExplanation, PermissionState } from './PermissionParts';
import { useNotificationPermission, useNotifications } from './NotificationsProvider';
import type { NotificationPermission } from './port';
import { notificationTexts } from './texts';

type Outcome = Extract<OnboardingStepOutcome, { type: 'notifications_granted' | 'notifications_denied' | 'skipped' }>;

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
  const notifications = useNotifications();
  const permission = useNotificationPermission();
  const [asking, setAsking] = useState(false);

  const allow = async () => {
    setAsking(true);
    const answer = await notifications.request().finally(() => setAsking(false));
    complete(answerOutcome(answer));
  };

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
