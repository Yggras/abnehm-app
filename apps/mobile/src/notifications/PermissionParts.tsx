import { StyleSheet, View } from 'react-native';

import { color, Icon, Notice, size, Skeleton, space, Text } from '../design';
import type { NotificationPermission } from './port';
import { notificationTexts } from './texts';

// Bausteine, die Erklär-Bildschirm (`notifications.permission`) und Onboarding-Schritt 10 teilen
// (Spezifikation 0, Abschnitt 6: „mit denselben Bausteinen“).

/** Glocke und Erklärtext vor dem Systemdialog. */
export function PermissionExplanation() {
  return (
    <View style={styles.explanation}>
      <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="bell" size="lg" tone="primary" />
      </View>
      <Text variant="headline">{notificationTexts.explanation}</Text>
    </View>
  );
}

/** Der Stand, wenn die Erlaubnis schon entschieden ist; `null` heißt noch nicht gelesen. */
export function PermissionState({ permission }: { permission: NotificationPermission | null }) {
  if (permission === null) {
    return (
      <View accessible accessibilityLabel={notificationTexts.loading}>
        <Skeleton width="80%" />
      </View>
    );
  }
  if (permission === 'granted') return <Notice tone="success" text={notificationTexts.granted} />;
  if (permission === 'denied') return <Notice tone="neutral" icon="bell" text={notificationTexts.denied} />;
  return <Notice tone="neutral" icon="bell" text={notificationTexts.undetermined} />;
}

const styles = StyleSheet.create({
  explanation: { gap: space[4] },
  badge: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: size.avatar / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primarySoft,
  },
});
