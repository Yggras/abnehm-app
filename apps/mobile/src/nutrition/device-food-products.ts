import Constants from 'expo-constants';

import { createOffProductSource, offUserAgent, type FoodProductSource } from './food-product-source';

// Open Food Facts auf dem Gerät (Spezifikation 2, Abschnitt 3; #160). Die Kontaktadresse des Pflicht-User-Agents
// ist Build-Konfiguration: `EXPO_PUBLIC_OFF_CONTACT`, das Expo beim Bündeln einsetzt
// (https://docs.expo.dev/guides/environment-variables/). Sie steht nicht im Repo (Nutzerentscheidung vom
// 23.11.2026); ohne sie bricht `scripts/app-build produktion` ab. Die Version kommt aus der App-Konfiguration
// (`Constants.expoConfig`, https://docs.expo.dev/versions/v58.0.0/sdk/constants/).

/** Hinweis im Log, wenn ein Test-Artefakt ohne Kontaktadresse gebaut wurde. */
export const missingOffContact = 'EXPO_PUBLIC_OFF_CONTACT fehlt: Open Food Facts verlangt eine Kontaktadresse im User-Agent; der Scan liefert „nicht verfügbar“.';

/**
 * Die Produktquelle des Geräts. Ohne Kontaktadresse fragt sie Open Food Facts nicht ab, sondern liefert
 * `unavailable` und meldet das; im Produktionsbuild kommt es dazu nicht.
 */
export function deviceFoodProductSource(onError: (error: unknown) => void): FoodProductSource {
  const contact = process.env.EXPO_PUBLIC_OFF_CONTACT?.trim();
  if (contact === undefined || contact === '') {
    return {
      lookup: async () => {
        onError(new Error(missingOffContact));
        return { type: 'unavailable', retryable: false };
      },
    };
  }
  return createOffProductSource({ fetch: globalThis.fetch, userAgent: offUserAgent(Constants.expoConfig?.version ?? '0.0.0', contact) });
}
