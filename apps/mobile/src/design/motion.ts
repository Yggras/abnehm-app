import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { motion } from './tokens';

/**
 * Wofür sich etwas bewegt (Design-System, Abschnitt „Bewegung“):
 * - `bounce`: Häkchen ploppt, Momo hüpft, Energie-Funke;
 * - `settle`: Rückfedern nach dem Drücken, Chips;
 * - `celebrate`: Tagesbonus und Levelaufstieg;
 * - `enter`, `exit`: Meldung oder Sheet erscheint bzw. verschwindet;
 * - `move`: Standardübergang innerhalb eines Bildschirms, etwa ein wachsender Balken;
 * - `loop`: dauerhafte Bewegung wie Wellen, Ruheatmung, Partikel, Wippen der Laichkugel.
 */
export type MotionIntent = 'bounce' | 'settle' | 'celebrate' | 'enter' | 'exit' | 'move' | 'loop';

type Bezier = readonly [number, number, number, number];
type SpringConfig = { readonly damping: number; readonly stiffness: number; readonly mass: number };

/** Wie sich etwas bewegt; Reanimated setzt `spring` mit `withSpring`, `timing` mit `withTiming` um. */
export type Motion =
  | { type: 'spring'; config: SpringConfig; duration?: number }
  | { type: 'timing'; duration: number; easing: Bezier }
  | { type: 'crossfade'; duration: number }
  | { type: 'loop'; duration: number }
  | { type: 'still' };

const crossfade: Motion = { type: 'crossfade', duration: motion.duration.fast };

/**
 * Bewegung zu einer Absicht. Mit „Bewegung reduzieren“ werden Federn, Hüpfer und Verschiebungen zu
 * kurzen Überblendungen, dauerhafte Bewegung steht still. Haptik ist davon unabhängig.
 */
export function motionFor(intent: MotionIntent, { reduceMotion }: { reduceMotion: boolean }): Motion {
  if (reduceMotion) return intent === 'loop' ? { type: 'still' } : crossfade;
  switch (intent) {
    case 'bounce':
      return { type: 'spring', config: motion.spring.bouncy };
    case 'settle':
      return { type: 'spring', config: motion.spring.firm };
    case 'celebrate':
      return { type: 'spring', config: motion.spring.bouncy, duration: motion.duration.celebrate };
    case 'enter':
      return { type: 'timing', duration: motion.duration.base, easing: motion.easing.enter };
    case 'exit':
      return { type: 'timing', duration: motion.duration.base, easing: motion.easing.exit };
    case 'move':
      return { type: 'timing', duration: motion.duration.base, easing: motion.easing.standard };
    case 'loop':
      return { type: 'loop', duration: motion.duration.celebrate };
  }
}

/**
 * Systemeinstellung „Bewegung reduzieren“ ([RN-Doku](https://reactnative.dev/docs/accessibilityinfo)).
 * Bis die Abfrage antwortet, gilt sie als eingeschaltet: lieber einmal überblenden als ungewollt hüpfen.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/** Bewegung zu einer Absicht unter der aktuellen Systemeinstellung. */
export function useMotion(intent: MotionIntent): Motion {
  return motionFor(intent, { reduceMotion: useReducedMotion() });
}
