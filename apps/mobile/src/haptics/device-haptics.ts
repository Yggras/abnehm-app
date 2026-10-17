import {
  AndroidHaptics,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  performAndroidHapticsAsync,
} from 'expo-haptics';
import { Platform } from 'react-native';

import type { HapticKind, Haptics } from './haptics';

// Ein Tagesziel bekommt den leichtesten Impuls, Tagesbonus und Levelaufstieg das Erfolgsmuster des
// Systems. Android nutzt die Haptik-Engine statt des Vibrationsmotors, wie die Expo-Doku empfiehlt
// (https://docs.expo.dev/versions/v58.0.0/sdk/haptics/). Bewegung reduzieren ändert daran nichts.
const ios: Record<HapticKind, () => Promise<void>> = {
  tageszielerfuellung: () => impactAsync(ImpactFeedbackStyle.Light),
  tagesbonus: () => notificationAsync(NotificationFeedbackType.Success),
  levelaufstieg: () => notificationAsync(NotificationFeedbackType.Success),
};

const android: Record<HapticKind, AndroidHaptics> = {
  tageszielerfuellung: AndroidHaptics.Context_Click,
  tagesbonus: AndroidHaptics.Confirm,
  levelaufstieg: AndroidHaptics.Confirm,
};

/** Produktionsadapter über expo-haptics. Ohne Taptic Engine oder im Stromsparmodus passiert still nichts. */
export const deviceHaptics: Haptics = {
  feedback(kind) {
    const played = Platform.OS === 'android' ? performAndroidHapticsAsync(android[kind]) : ios[kind]();
    played.catch(() => {
      // Haptik ist Zierde: Ein Fehler der Plattform darf die auslösende Reaktion nicht stören.
    });
  },
};
