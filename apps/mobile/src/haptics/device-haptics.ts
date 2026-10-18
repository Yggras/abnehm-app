import { AndroidHaptics, ImpactFeedbackStyle, impactAsync, performAndroidHapticsAsync } from 'expo-haptics';
import { Platform } from 'react-native';

import type { HapticKind, Haptics } from './haptics';

// Spezifikation 0 verlangt leichtes Feedback für alle drei Erfolge: auf iOS der leichte Impuls, auf
// Android die Bestätigung der Haptik-Engine, die anders als der Vibrationsmotor keine Berechtigung
// braucht (https://docs.expo.dev/versions/v58.0.0/sdk/haptics/). Ob sie auf den Zielgeräten dezent
// genug ist, zeigt der Gerätesmoke; dann wird nur diese Tabelle angepasst. Bewegung reduzieren ändert
// daran nichts. Ist auf Android „Haptisches Feedback beim Berühren“ aus, schweigt die Haptik-Engine;
// so beobachtet auf dem Fairphone 6 (#95). Die App respektiert die Systemeinstellung bewusst.
const ios: Record<HapticKind, ImpactFeedbackStyle> = {
  tageszielerfuellung: ImpactFeedbackStyle.Light,
  tagesbonus: ImpactFeedbackStyle.Light,
  levelaufstieg: ImpactFeedbackStyle.Light,
};

const android: Record<HapticKind, AndroidHaptics> = {
  tageszielerfuellung: AndroidHaptics.Confirm,
  tagesbonus: AndroidHaptics.Confirm,
  levelaufstieg: AndroidHaptics.Confirm,
};

/** Produktionsadapter über expo-haptics. Ohne Taptic Engine oder im Stromsparmodus passiert still nichts. */
export const deviceHaptics: Haptics = {
  feedback(kind) {
    const played = Platform.OS === 'android' ? performAndroidHapticsAsync(android[kind]) : impactAsync(ios[kind]);
    played.catch(() => {
      // Haptik ist Zierde: Ein Fehler der Plattform darf die auslösende Reaktion nicht stören.
    });
  },
};
