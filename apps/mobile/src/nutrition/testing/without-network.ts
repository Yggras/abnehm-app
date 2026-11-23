import type { NutritionDependencies } from '../nutrition';

/**
 * Test-Adapter für Tests ohne Server und ohne Netz (#164, #160): Jeder Bildabruf ist `offline`, der Netzstatus
 * bleibt unbekannt, und Open Food Facts ist nicht erreichbar. Das Protokoll zeigt dann nur das Foto-/KI-Symbol
 * der Einträge; ein unbekannter Barcode endet in `offline_unknown`. Tests mit Produkten geben den Fake aus
 * `fake-food-product-source.ts`.
 */
export const withoutNetwork: Pick<NutritionDependencies, 'photoImages' | 'observeOnline' | 'foodProducts'> = {
  photoImages: async () => ({ type: 'offline' }),
  observeOnline: () => () => {},
  foodProducts: { lookup: async () => ({ type: 'offline' }) },
};
