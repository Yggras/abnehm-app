import { useEffect } from 'react';
import { cancelAnimation, Easing, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

import { motion, motionFor } from '../design';

/**
 * Takt der dauerhaften Bewegung auf der Insel: Wellen, Ruheatmung und Partikel. Er läuft endlos
 * von 0 bis 1; bei „Bewegung reduzieren“ steht er auf 0 still (Spezifikation 4, Abschnitt 7;
 * Design-System › Bewegung). Ein Durchlauf dauert drei Längen von `loop`, damit die Insel leise und
 * langsam lebt (Designwert aus #182, nicht belegt).
 */
export function useLoop(reduceMotion: boolean): SharedValue<number> {
  const progress = useSharedValue(0);
  const motion = motionFor('loop', { reduceMotion });
  const duration = motion.type === 'loop' ? 3 * motion.duration : 0;

  useEffect(() => {
    if (duration === 0) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [duration, progress]);

  return progress;
}

/**
 * Pulsieren der gültigen Felder im Bau-Modus: hin und zurück zwischen 0 und 1, je Richtung `duration-slow`
 * (Design-System › Insel: „pulsierend mit duration-slow“). Bei „Bewegung reduzieren“ steht es auf 1 still,
 * die Felder leuchten dann ruhig.
 */
export function usePulse(reduceMotion: boolean): SharedValue<number> {
  const pulse = useSharedValue(1);
  const still = motionFor('loop', { reduceMotion }).type === 'still';

  useEffect(() => {
    if (still) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: motion.duration.slow, easing: Easing.bezier(...motion.easing.standard) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [still, pulse]);

  return pulse;
}
