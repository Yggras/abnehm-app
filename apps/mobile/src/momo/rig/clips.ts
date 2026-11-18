import { MomoMood } from '@abnehm/contracts/island';

import type { JointName } from './types';

// Semantische Clips des Momo-Rigs (Recherche Produktionsstrategie, Abschnitt 7.3; Spezifikation 4,
// Abschnitt 6): Ruheatmung, Hüpfer, Sprung mit Funken, Schlaf, Dösen, Fragezeichen und Wippen der
// Laichkugel. Eine Pose ist eine reine Funktion aus Stimmung, Gelenk und drei Antrieben, die
// Reanimated bewegt (`use-momo-motion.ts`):
// - `phase` läuft im Takt der Stimmung endlos von 0 bis 1 (Atmen, Wippen, Dösen);
// - `lift` hebt die Figur beim Hüpfer bzw. Sprung an und fällt mit `spring-bouncy` zurück;
// - `burst` lässt die Funken mit dem Sprung aufleuchten; danach bleiben sie als Zeichen von
//   „begeistert“ stehen und funkeln im Takt (Nutzerentscheidung in #187 nach der Impeccable-Prüfung:
//   sonst gliche „begeistert“ nach 1,2 s fast „freut sich“).
// Bei „Bewegung reduzieren“ stehen die Antriebe auf der Schlüsselpose der Stimmung: klar erkennbar,
// ohne räumliche Bewegung. Ausschläge sind Designwerte aus #187, nicht belegt.

/** Die sechs Stimmungen plus „wartet im Ei“, die Stufe `laichkugel`. */
export type RigMood = MomoMood | 'wartet_im_ei';
export const rigMoods: readonly RigMood[] = [...MomoMood.options, 'wartet_im_ei'];

/** Gelenke der Form plus die Zeichen über dem Kopf. */
export type PoseTarget = JointName | 'effekt';

export type MotionInput = Readonly<{ phase: number; lift: number; burst: number }>;

/** Verschiebung in Rig-Einheiten, Drehung in Grad im Uhrzeigersinn, Größe, Atmung und Deckkraft. */
export type JointPose = Readonly<{ x: number; y: number; rotation: number; scale: number; scaleY: number; opacity: number }>;

/** Länge eines Durchlaufs von `phase` je Stimmung in ms: Dösen und Schlaf atmen langsamer. */
export const loopDuration: Readonly<Record<RigMood, number>> = {
  zufrieden: 3600,
  freut_sich: 1200,
  begeistert: 1200,
  neugierig: 2400,
  doest: 4800,
  schlaeft: 6000,
  wartet_im_ei: 3600,
};

/** Ob die Stimmung mit einem Hüpfer bzw. Sprung beginnt. */
export function hops(mood: RigMood): boolean {
  'worklet';
  return mood === 'freut_sich' || mood === 'begeistert';
}

/**
 * Antriebe der Schlüsselpose: mitten im Takt, am Boden, Funken in voller Leuchtkraft. Dort steht jede
 * Stimmung klar: Wedel hoch, Kopf geneigt, Funken, „z z“ und Mond sichtbar, die Laichkugel aufrecht.
 */
export function keyMotion(mood: RigMood): MotionInput {
  return { phase: 0.5, lift: 0, burst: mood === 'begeistert' ? 1 : 0 };
}

/** Antriebe zu Beginn einer Stimmung; mit reduzierter Bewegung bleibt es bei der Schlüsselpose. */
export function motionInputs(mood: RigMood, { reduceMotion }: { reduceMotion: boolean }): MotionInput {
  return reduceMotion ? keyMotion(mood) : { phase: 0, lift: 0, burst: 0 };
}

const still: JointPose = { x: 0, y: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
const turn = 2 * Math.PI;

/** Pose eines Gelenks; `amplitude` ist die Korrektur der Form für dieses Gelenk. */
export function poseOf(mood: RigMood, target: PoseTarget, { phase, lift, burst }: MotionInput, amplitude: number): JointPose {
  'worklet';
  const wave = Math.sin(phase * turn);
  const happy = hops(mood);
  const resting = mood === 'doest' || mood === 'schlaeft';
  switch (target) {
    case 'figur': {
      if (mood === 'wartet_im_ei') return { ...still, rotation: 4 * wave * amplitude };
      const height = mood === 'begeistert' ? 16 : mood === 'freut_sich' ? 8 : 0;
      return { ...still, y: -height * lift * amplitude };
    }
    case 'koerper': {
      const breath = mood === 'schlaeft' ? 0.035 : mood === 'doest' ? 0.03 : 0.02;
      return { ...still, scaleY: 1 + breath * wave * amplitude, y: resting ? 1.5 : 0 };
    }
    case 'kopf': {
      const tilt = mood === 'neugierig' ? 8 + 2 * wave : mood === 'doest' ? 6 + 3 * wave : mood === 'schlaeft' ? 4 : 1.5 * Math.cos(phase * turn);
      return { ...still, rotation: tilt * amplitude };
    }
    case 'wedel_links':
    case 'wedel_rechts': {
      // Links dreht „hoch“ im Uhrzeigersinn, rechts dagegen.
      const up = target === 'wedel_links' ? 1 : -1;
      const raise = happy ? 18 + 6 * Math.sin(phase * 2 * turn) : mood === 'neugierig' ? 8 : resting ? -10 : 4 * wave;
      return { ...still, rotation: up * raise * amplitude };
    }
    case 'schwanz': {
      const swing = happy ? 12 * Math.sin(phase * 2 * turn) : resting ? 2 * wave : mood === 'neugierig' ? 6 + 3 * wave : 5 * wave;
      return { ...still, rotation: swing * amplitude };
    }
    case 'fluegel':
      return { ...still, rotation: (happy ? -10 * lift + 3 * wave : 2 * wave) * amplitude };
    case 'effekt': {
      switch (mood) {
        case 'begeistert':
          return { ...still, y: -6 * burst, scale: (0.6 + 0.4 * burst) * (1 + 0.12 * wave), opacity: burst };
        case 'neugierig':
          return { ...still, y: 1.5 * wave };
        case 'doest':
          return { ...still, y: -4 * phase, opacity: Math.sin(phase * Math.PI) };
        case 'schlaeft':
          return { ...still, y: wave };
        default:
          return { ...still, opacity: 0 };
      }
    }
  }
}
