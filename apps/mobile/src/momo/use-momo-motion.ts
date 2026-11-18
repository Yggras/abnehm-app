import { useEffect } from 'react';
import { cancelAnimation, Easing, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { motion, motionFor } from '../design';
import { hops, loopDuration, motionInputs, type RigMood } from './rig/clips';

/** Antriebe der Clips (`rig/clips.ts`) als Shared Values für den UI-Thread. */
export type MomoDrive = Readonly<{ phase: SharedValue<number>; lift: SharedValue<number>; burst: SharedValue<number> }>;

/**
 * Bewegt Momo in einer Stimmung: der Takt der Stimmung endlos, zu Beginn von „freut sich“ ein Hüpfer
 * und von „begeistert“ ein Sprung, die mit `spring-bouncy` landen, beim Sprung leuchten die Funken
 * über `duration-celebrate` (Design-System › Momo und › Bewegung). Bei „Bewegung reduzieren“ stehen
 * alle Antriebe auf der Schlüsselpose der Stimmung.
 */
export function useMomoMotion(mood: RigMood, reduceMotion: boolean): MomoDrive {
  const start = motionInputs(mood, { reduceMotion });
  const phase = useSharedValue(start.phase);
  const lift = useSharedValue(start.lift);
  const burst = useSharedValue(start.burst);

  useEffect(() => {
    const drives = [phase, lift, burst];
    const inputs = motionInputs(mood, { reduceMotion });
    for (const drive of drives) cancelAnimation(drive);
    phase.value = inputs.phase;
    lift.value = inputs.lift;
    burst.value = inputs.burst;
    if (reduceMotion) return;

    phase.value = withRepeat(withTiming(1, { duration: loopDuration[mood], easing: Easing.linear }), -1, false);
    const bounce = motionFor('bounce', { reduceMotion });
    if (hops(mood) && bounce.type === 'spring') {
      lift.value = withSequence(withTiming(1, { duration: motion.duration.fast, easing: Easing.out(Easing.quad) }), withSpring(0, bounce.config));
    }
    if (mood === 'begeistert') burst.value = withTiming(1, { duration: motion.duration.celebrate, easing: Easing.linear });
    return () => {
      for (const drive of drives) cancelAnimation(drive);
    };
  }, [mood, reduceMotion, phase, lift, burst]);

  return { phase, lift, burst };
}
