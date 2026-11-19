import { motion } from '../design/tokens';

// Takt der Verwandlungsszene (Spezifikation 4, Abschnitt 6; Design-System › Insel und Bewegung; #204): Momo blendet
// über `duration-celebrate` von der alten zur neuen Form über und wird dabei kurz größer; danach zieht der Nebel
// über `duration-celebrate` ab („Gesperrtes Gebiet … Nebel, der beim Freischalten über duration-celebrate abzieht“).
// Mit „Bewegung reduzieren“ ist beides eine reine Überblendung in `duration-fast`, ohne Skalierung.

export type TransformationMotion = Readonly<{
  /** Überblendung von der alten zur neuen Form, in ms. */
  morph: number;
  /** Abziehen des Nebels nach der Überblendung, in ms. */
  lift: number;
  /** Wie viel größer Momo in der Mitte der Überblendung ist; 0 ohne Skalierung. */
  grow: number;
}>;

/** Kurze Skalierung um 15 % (Designwert aus #204, nicht belegt). */
const growth = 0.15;

export function transformationMotion(reduceMotion: boolean): TransformationMotion {
  const duration = reduceMotion ? motion.duration.fast : motion.duration.celebrate;
  return { morph: duration, lift: duration, grow: reduceMotion ? 0 : growth };
}

/** Wie lange die ganze Szene dauert: Überblendung und, wenn ein Gebiet dazukam, das Abziehen des Nebels. */
export function transformationDuration(reduceMotion: boolean, lifting: boolean): number {
  const { morph, lift } = transformationMotion(reduceMotion);
  return morph + (lifting ? lift : 0);
}
