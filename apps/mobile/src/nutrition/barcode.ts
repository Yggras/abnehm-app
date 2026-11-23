import type { Clock } from '@abnehm/clock';
import { Instant } from '@abnehm/contracts/base';
import { FoodRef } from '@abnehm/contracts/nutrition';

import type { LocalDatabase } from '../local-db';
import type { FoodChoice } from './current-foods';
import { InvalidNutritionInputError } from './entries';
import { productSnapshot, type FoodProductSource, type OffProduct, type ProductLookup } from './food-product-source';
import { readCachedProduct, writeCachedProduct } from './off-cache-repository';
import { overlayingOwnFood } from './own-food-repository';

// Barcode-Auflösung (Spezifikation 2, Abschnitt 5; #160) in der Reihenfolge: eigenes Lebensmittel mit diesem
// Barcode, OFF-Cache, OFF-API. Die Netzwerkanfrage ist flüchtig; persistiert wird nur der Cache-Eintrag in der
// lokalen Tabelle `off_cache`. Den Ablauf auf dem Bildschirm orchestriert das Modul für Online-Abläufe (#103).

/**
 * Ergebnis einer Auflösung. `found` führt in die Mengenprüfung, `incomplete` und `not_found` in „Eigenes
 * Lebensmittel anlegen“ mit Barcode und allen bekannten Werten, `offline_unknown` zu „Kein Netz – …“ und
 * `unavailable` zu einem neutralen Hinweis, bei `retryable` mit „Erneut versuchen“.
 */
export type BarcodeResolution =
  | Readonly<{ type: 'found'; food: FoodChoice }>
  | Readonly<{ type: 'incomplete'; barcode: string; product: OffProduct }>
  | Readonly<{ type: 'not_found'; barcode: string }>
  | Readonly<{ type: 'offline_unknown'; barcode: string }>
  | Readonly<{ type: 'unavailable'; barcode: string; retryable: boolean }>;

/** Zeitüberschreitung der Anfrage; danach gilt `unavailable` (Spezifikation 2, Abschnitt 5). */
export const productLookupTimeoutMs = 8_000;

/** Ein älterer Cache-Eintrag wird beim nächsten Online-Scan im Hintergrund aktualisiert (Spezifikation 2, Abschnitt 3). */
const cacheRefreshAfterMs = 30 * 24 * 60 * 60 * 1_000;

export type BarcodeResolver = Readonly<{
  /** Löst einen Barcode auf; wirft `InvalidNutritionInputError` für einen Barcode, den die Lebensmittelreferenz nicht nimmt. */
  resolve(barcode: string): Promise<BarcodeResolution>;
}>;

export function createBarcodeResolver({ database, clock, source }: { database: LocalDatabase; clock: Clock; source: FoodProductSource }): BarcodeResolver {
  // Läuft für einen Barcode schon eine Aktualisierung, startet keine zweite.
  const refreshing = new Set<string>();

  /** Fragt OFF ab und speichert ein gefundenes Produkt im Cache; sonst bleibt der Cache unverändert. */
  async function fetchAndCache(barcode: string): Promise<ProductLookup> {
    const lookup = await lookupWithTimeout(source, barcode);
    if (lookup.type === 'found') database.transaction((tx) => writeCachedProduct(tx, barcode, lookup.product, Instant.parse(clock.read().instant)));
    return lookup;
  }

  function refreshInBackground(barcode: string): void {
    if (refreshing.has(barcode)) return;
    refreshing.add(barcode);
    // Fehlschläge lassen den Eintrag unverändert, auch wenn das Konto inzwischen gesperrt ist.
    void fetchAndCache(barcode)
      .catch(() => undefined)
      .finally(() => refreshing.delete(barcode));
  }

  return {
    async resolve(barcode) {
      const parsed = FoodRef.safeParse({ type: 'off', key: barcode });
      if (!parsed.success || parsed.data.type !== 'off') throw new InvalidNutritionInputError(`Ungültiger Barcode: ${barcode}`);
      const ref = parsed.data;

      const local = database.read((tx) => {
        const own = overlayingOwnFood(tx, ref);
        return own === undefined ? { own, cached: readCachedProduct(tx, barcode) } : { own, cached: undefined };
      });
      if (local.own !== undefined) return { type: 'found', food: local.own };
      if (local.cached !== undefined) {
        if (Date.parse(clock.read().instant) - Date.parse(local.cached.fetchedAt) > cacheRefreshAfterMs) refreshInBackground(barcode);
        return resolutionOf(ref, local.cached.product);
      }

      const lookup = await fetchAndCache(barcode);
      switch (lookup.type) {
        case 'found':
          return resolutionOf(ref, lookup.product);
        case 'not_found':
          return { type: 'not_found', barcode };
        case 'offline':
          return { type: 'offline_unknown', barcode };
        case 'unavailable':
          return { type: 'unavailable', barcode, retryable: lookup.retryable };
      }
    },
  };
}

function resolutionOf(ref: Extract<FoodRef, { type: 'off' }>, product: OffProduct): BarcodeResolution {
  const snapshot = productSnapshot(product);
  return snapshot === null ? { type: 'incomplete', barcode: ref.key, product } : { type: 'found', food: { ref, snapshot } };
}

/** Die Abfrage mit Zeitüberschreitung: Nach 8 s wird sie abgebrochen und gilt als `unavailable` (erneut versuchbar). */
async function lookupWithTimeout(source: FoodProductSource, barcode: string): Promise<ProductLookup> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProductLookup>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve({ type: 'unavailable', retryable: true });
    }, productLookupTimeoutMs);
  });
  try {
    return await Promise.race([source.lookup(barcode, abort.signal).catch((): ProductLookup => ({ type: 'unavailable', retryable: true })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
