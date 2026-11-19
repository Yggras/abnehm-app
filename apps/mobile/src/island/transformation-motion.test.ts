/** @jest-environment node */
import { motion } from '../design/tokens';
import { transformationDuration, transformationMotion } from './transformation-motion';

// Nachweis für #204: Takt der Verwandlungsszene (Spezifikation 4, Abschnitt 6; Design-System › Insel und Bewegung).

test('Überblendung mit kurzer Skalierung über `duration-celebrate`, danach zieht der Nebel über `duration-celebrate` ab', () => {
  expect(transformationMotion(false)).toEqual({ morph: motion.duration.celebrate, lift: motion.duration.celebrate, grow: 0.15 });
  expect(transformationDuration(false, true)).toBe(2 * motion.duration.celebrate);
});

test('mit „Bewegung reduzieren“ eine reine Überblendung in `duration-fast`, ohne Skalierung', () => {
  expect(transformationMotion(true)).toEqual({ morph: motion.duration.fast, lift: motion.duration.fast, grow: 0 });
  expect(transformationDuration(true, true)).toBe(2 * motion.duration.fast);
});

test('ohne neues Gebiet endet die Szene mit der Überblendung', () => {
  expect(transformationDuration(false, false)).toBe(motion.duration.celebrate);
  expect(transformationDuration(true, false)).toBe(motion.duration.fast);
});
