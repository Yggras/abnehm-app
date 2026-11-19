import type { NutritionDependencies } from '../nutrition';

/**
 * Test-Adapter für Tests ohne Server und ohne Netz (#164): Jeder Bildabruf ist `offline`, der Netzstatus
 * bleibt unbekannt. Das Protokoll zeigt dann nur das Foto-/KI-Symbol der Einträge.
 */
export const withoutPhotos: Pick<NutritionDependencies, 'photoImages' | 'observeOnline'> = {
  photoImages: async () => ({ type: 'offline' }),
  observeOnline: () => () => {},
};
