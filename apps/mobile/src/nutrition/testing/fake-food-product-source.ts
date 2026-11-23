import type { FoodProductSource, OffProduct, ProductLookup } from '../food-product-source';

// Fake der Naht `FoodProductSource` (Spezifikation 2, Abschnitt 13; #160): deterministisch steuerbar mit den
// Ergebnissen `found`, `not_found`, `incomplete`, HTTP 429 und 503 sowie Zeitüberschreitung. Es gibt ihn nur in
// Tests und in Test-Artefakten (Development- und E2E-Build, Testfähigkeit `fake-produktquelle` in
// `test/test-capabilities.ts`); das Produktions-Bundle enthält ihn nicht.

/** Marker für den Release-Test: steht im Fake und darf im Produktions-Bundle nicht vorkommen. */
export const fakeFoodProductSourceMarker = 'fake_produktquelle';

/**
 * Ergebnis des Fakes. `katalog`: Produkte des Fakes werden gefunden, alle anderen Barcodes nicht.
 * `unvollstaendig`: jedes Produkt ohne kcal. `offline`: OFF nicht erreicht. `zeitueberschreitung`: keine
 * Antwort, bis das Modul nach 8 s abbricht.
 */
export const fakeProductModes = ['katalog', 'nicht_gefunden', 'unvollstaendig', 'http_429', 'http_503', 'zeitueberschreitung', 'offline'] as const;
export type FakeProductMode = (typeof fakeProductModes)[number];

/**
 * Synthetische Produkte des Fakes mit erfundenen Barcodes und Werten, gültigen GTIN-13-Prüfziffern
 * (https://www.gs1.org/services/how-calculate-check-digit-manually).
 */
export const fakeProducts: Readonly<Record<string, OffProduct>> = {
  '4000000000013': {
    name: 'Naturjoghurt 3,5 %',
    brand: 'Testmolkerei',
    baseUnit: 'g',
    milliKcalPer100: 64_000,
    proteinMgPer100: 3_900,
    carbsMgPer100: 4_500,
    fatMgPer100: 3_500,
    portions: [{ unit: 'portion', label: null, baseAmount: 150_000 }],
  },
  '4000000000020': {
    name: 'Orangensaft',
    brand: 'Testkelterei',
    baseUnit: 'ml',
    milliKcalPer100: 43_000,
    proteinMgPer100: 700,
    carbsMgPer100: 9_000,
    fatMgPer100: 100,
    portions: [{ unit: 'portion', label: null, baseAmount: 200 }],
  },
};

/** Ein Barcode, den der Fake im Modus `katalog` nicht kennt. */
export const unknownFakeBarcode = '4000000000037';

export type FakeFoodProductSource = FoodProductSource &
  Readonly<{
    setMode(mode: FakeProductMode): void;
    mode(): FakeProductMode;
    /** Abgefragte Barcodes in Reihenfolge. */
    readonly calls: readonly string[];
  }>;

/** Ein unvollständiges Produkt: ohne kcal (Spezifikation 2, Abschnitt 3). */
const withoutKcal = (product: OffProduct): OffProduct => ({ ...product, milliKcalPer100: null });

export function createFakeFoodProductSource({
  products = fakeProducts,
  mode: initial = 'katalog',
}: { products?: Readonly<Record<string, OffProduct>>; mode?: FakeProductMode } = {}): FakeFoodProductSource {
  let mode = initial;
  const calls: string[] = [];
  return {
    calls,
    mode: () => mode,
    setMode(next) {
      mode = next;
    },
    lookup(barcode, signal) {
      calls.push(barcode);
      const known = products[barcode];
      const answer = (lookup: ProductLookup) => Promise.resolve(lookup);
      switch (mode) {
        case 'katalog':
          return answer(known === undefined ? { type: 'not_found' } : { type: 'found', product: known });
        case 'nicht_gefunden':
          return answer({ type: 'not_found' });
        case 'unvollstaendig':
          return answer({ type: 'found', product: withoutKcal(known ?? Object.values(fakeProducts)[0]!) });
        case 'http_429':
        case 'http_503':
          return answer({ type: 'unavailable', retryable: true });
        case 'offline':
          return answer({ type: 'offline' });
        case 'zeitueberschreitung':
          // Antwortet erst, wenn das Modul abbricht; das Ergebnis zählt dann nicht mehr.
          return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ type: 'unavailable', retryable: true }), { once: true }));
      }
    },
  };
}
