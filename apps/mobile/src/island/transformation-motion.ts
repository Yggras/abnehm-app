import { motion } from '../design/tokens';

// Takt der Verwandlungsszene (Spezifikation 4, Abschnitt 6; Design-System › Insel und Bewegung; #204): Momo blendet
// über `duration-celebrate` von der alten zur neuen Form über und wird dabei kurz größer. Danach schwenkt die Ansicht
// über `duration-slow` zum neuen Gebiet, denn auf kleinen Bildschirmen liegt es außerhalb des Startausschnitts
// (Impeccable-Kritik zu #204, iPhone-Simulator), und der Nebel zieht über `duration-celebrate` ab („Gesperrtes Gebiet
// … Nebel, der beim Freischalten über duration-celebrate abzieht“). Mit „Bewegung reduzieren“ sind Überblendung und
// Abziehen reine Überblendungen in `duration-fast` ohne Skalierung, und die Ansicht springt ohne Schwenk.

export type TransformationMotion = Readonly<{
  /** Überblendung von der alten zur neuen Form, in ms. */
  morph: number;
  /** Schwenk zum neuen Gebiet nach der Überblendung, in ms; 0 springt. */
  pan: number;
  /** Abziehen des Nebels nach dem Schwenk, in ms. */
  lift: number;
  /** Wie viel größer Momo in der Mitte der Überblendung ist; 0 ohne Skalierung. */
  grow: number;
}>;

/** Kurze Skalierung um 15 % (Designwert aus #204, nicht belegt). */
const growth = 0.15;

export function transformationMotion(reduceMotion: boolean): TransformationMotion {
  const duration = reduceMotion ? motion.duration.fast : motion.duration.celebrate;
  return { morph: duration, pan: reduceMotion ? 0 : motion.duration.slow, lift: duration, grow: reduceMotion ? 0 : growth };
}

/** Wie lange die ganze Szene dauert: Überblendung und, wenn ein Gebiet dazukam, Schwenk und Abziehen des Nebels. */
export function transformationDuration(reduceMotion: boolean, lifting: boolean): number {
  const { morph, pan, lift } = transformationMotion(reduceMotion);
  return morph + (lifting ? pan + lift : 0);
}
