import type { MomoForm, MomoMood } from '@abnehm/contracts/island';

// Namen der Entwicklungsformen (Spezifikation 4, Abschnitt 5) und der Stimmungen (Abschnitt 6), so wie
// Momo-Sheet und `accessibilityLabel` sie nennen.

export const formNames = {
  kaulquappe: 'Kaulquappe',
  huepfer: 'Hüpfer',
  krabbler: 'Krabbler',
  aufrechter: 'Aufrechter',
  springer: 'Springer',
  spirale: 'Spirale',
  fluegling: 'Flügling',
  lagunendrache: 'Lagunendrache',
} as const satisfies Record<MomoForm, string>;

export const moodNames = {
  zufrieden: 'zufrieden',
  freut_sich: 'freut sich',
  begeistert: 'begeistert',
  neugierig: 'neugierig',
  doest: 'döst',
  schlaeft: 'schläft',
} as const satisfies Record<MomoMood, string>;

/** Zugänglicher Name, etwa „Momo, Hüpfer, freut sich, trägt Strohhütchen“ (Spezifikation 4, Abschnitt 6). */
export function momoLabel(form: MomoForm, mood: MomoMood, accessoryNames: readonly string[]): string {
  const worn = accessoryNames.length > 0 ? `, trägt ${accessoryNames.join(' und ')}` : '';
  return `Momo, ${formNames[form]}, ${moodNames[mood]}${worn}`;
}

export const eggLabel = 'Momo wartet im Ei';
