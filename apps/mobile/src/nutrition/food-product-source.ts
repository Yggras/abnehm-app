import { foodNameMaxLength, maxBaseAmount, type BaseUnit, type PortionConversion } from '@abnehm/contracts/nutrition';

// Naht `FoodProductSource` (Spezifikation 2, Abschnitte 1, 3 und 5; #160): Abfrage eines Barcodes bei
// Open Food Facts direkt aus der App. Der produktive Adapter fragt die Produkt-API v3 ab, die OFF für neue
// Integrationen empfiehlt; v2 gilt dort als veraltet (https://openfoodfacts.github.io/openfoodfacts-server/api/).
// Den Fake mit `found`, `not_found`, `incomplete`, 429/503 und Zeitüberschreitung gibt es nur in Test- und
// Development-Artefakten (`testing/fake-food-product-source.ts`, Testfähigkeit `fake-produktquelle`).
//
// Die Datei hat bewusst keine React- oder React-Native-Importe, damit Node-Tests den Adapter laden.

/**
 * Ein Produkt, wie es Open Food Facts liefert und der Cache speichert: Werte je 100 g bzw. 100 ml in
 * `milli_kcal` und mg; `null`, wo OFF keinen gültigen Wert kennt. Fehlt kcal oder ein Makro, ist das
 * Produkt unvollständig.
 */
export type OffProduct = Readonly<{
  name: string | null;
  brand: string | null;
  baseUnit: BaseUnit;
  milliKcalPer100: number | null;
  proteinMgPer100: number | null;
  carbsMgPer100: number | null;
  fatMgPer100: number | null;
  /** Nur Portionen, die OFF eindeutig in der Basiseinheit angibt. */
  portions: readonly PortionConversion[];
}>;

/**
 * Ausgang einer Abfrage. `offline`: Open Food Facts nicht erreicht. `unavailable`: OFF hat geantwortet,
 * aber nicht mit einem Produkt; `retryable` bei HTTP 429 und 5xx, die OFF zeitweise liefert.
 */
export type ProductLookup =
  | Readonly<{ type: 'found'; product: OffProduct }>
  | Readonly<{ type: 'not_found' }>
  | Readonly<{ type: 'offline' }>
  | Readonly<{ type: 'unavailable'; retryable: boolean }>;

export type FoodProductSource = Readonly<{
  /**
   * Fragt einen Barcode ab. `signal` bricht die Anfrage nach der Zeitüberschreitung des Moduls ab; ein
   * Ergebnis danach zählt nicht mehr.
   */
  lookup(barcode: string, signal: AbortSignal): Promise<ProductLookup>;
}>;

/** Produktiver Server (https://openfoodfacts.github.io/openfoodfacts-server/api/). */
export const offBaseUrl = 'https://world.openfoodfacts.org';

/**
 * Nur die Felder, die die App übernimmt, kommagetrennt im Parameter `fields`
 * (https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/). Feldnamen und Einheiten sind
 * in `research/off-produkt-api.md` belegt. `quantity` steht dabei, weil OFF `product_quantity_unit` neben
 * `nutriments` sonst weglässt (beobachtet am 23.11.2026).
 */
export const offProductFields = ['product_name', 'product_name_de', 'brands', 'quantity', 'product_quantity_unit', 'serving_quantity', 'serving_quantity_unit', 'nutriments'] as const;

/**
 * User-Agent in der Form, die Open Food Facts verlangt: `AppName/Version (ContactEmail)`
 * (https://openfoodfacts.github.io/openfoodfacts-server/api/). Die Kontaktadresse ist Build-Konfiguration.
 */
export function offUserAgent(version: string, contact: string): string {
  return `AbnehmApp/${version} (${contact})`;
}

/**
 * Produktiver Adapter: `GET /api/v3/product/{barcode}` mit `fields` und dem Pflicht-User-Agent. Kein
 * Auth-Header, keine Sitzung: Die Anfrage geht nie an das eigene Backend. Ein gefundenes Produkt kommt mit
 * HTTP 200, ein unbekannter Barcode mit HTTP 404 (beobachtet am 23.11.2026, `research/off-produkt-api.md`).
 */
export function createOffProductSource({
  fetch,
  userAgent,
  baseUrl = offBaseUrl,
}: {
  fetch: typeof globalThis.fetch;
  userAgent: string;
  baseUrl?: string;
}): FoodProductSource {
  return {
    async lookup(barcode, signal) {
      const url = `${baseUrl}/api/v3/product/${encodeURIComponent(barcode)}?fields=${offProductFields.join(',')}`;
      let response: Response;
      try {
        response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal });
      } catch {
        return { type: 'offline' };
      }
      if (response.status === 404) return { type: 'not_found' };
      if (response.status === 429 || response.status >= 500) return { type: 'unavailable', retryable: true };
      if (response.status !== 200) return { type: 'unavailable', retryable: false };
      try {
        const product = offProductOf(await response.json());
        return product === null ? { type: 'unavailable', retryable: false } : { type: 'found', product };
      } catch {
        // Unterwegs abgerissen oder kein JSON.
        return { type: 'unavailable', retryable: true };
      }
    },
  };
}

/**
 * Das Produkt aus der Antwort der Produkt-API; `null` ohne Objekt `product`. Werte unter `nutriments`
 * enden auf `_100g` und gelten für 100 g bzw. 100 ml, Energie in kcal, Nährstoffe in g
 * (https://world.openfoodfacts.org/data/data-fields.txt).
 */
export function offProductOf(body: unknown): OffProduct | null {
  const product = objectOf(objectOf(body)?.product);
  if (product === undefined) return null;
  const nutriments = objectOf(product.nutriments) ?? {};
  // Die Basiseinheit nennt die Packungsmenge, ohne sie der Text der Packungsmenge wie „330 ml“, zuletzt die
  // Portion. OFF schreibt die Einheiten als `g` bzw. `ml`; ohne Angabe gilt g.
  const quantityUnit = textOf(product.product_quantity_unit) ?? unitOfQuantity(textOf(product.quantity)) ?? textOf(product.serving_quantity_unit);
  const baseUnit: BaseUnit = quantityUnit?.toLowerCase() === 'ml' ? 'ml' : 'g';
  return {
    name: nameOf(textOf(product.product_name_de) ?? textOf(product.product_name)),
    brand: nameOf(textOf(product.brands)),
    baseUnit,
    milliKcalPer100: milliOf(nutriments['energy-kcal_100g']),
    proteinMgPer100: milliOf(nutriments.proteins_100g),
    carbsMgPer100: milliOf(nutriments.carbohydrates_100g),
    fatMgPer100: milliOf(nutriments.fat_100g),
    portions: servingOf(product.serving_quantity, textOf(product.serving_quantity_unit), baseUnit),
  };
}

/** Eine Portion nur, wenn OFF sie eindeutig in der Basiseinheit angibt (Spezifikation 2, Abschnitt 3). */
function servingOf(quantity: unknown, unit: string | undefined, baseUnit: BaseUnit): PortionConversion[] {
  const amount = numberOf(quantity);
  if (amount === undefined || amount <= 0 || unit?.toLowerCase() !== baseUnit) return [];
  // g als mg; ml nur ganzzahlig, wie der Vertrag Volumen speichert.
  const baseAmount = baseUnit === 'g' ? Math.round(amount * 1_000) : amount;
  if (!Number.isInteger(baseAmount) || baseAmount <= 0 || baseAmount > maxBaseAmount[baseUnit]) return [];
  return [{ unit: 'portion', label: null, baseAmount }];
}

/** Volumen (`ml`, `cl`, `l`) oder Masse (`g`, `kg`) aus einer Packungsmenge wie „1,5 l“; sonst `undefined`. */
function unitOfQuantity(quantity: string | undefined): string | undefined {
  const unit = quantity?.match(/\d\s*(ml|cl|l|kg|g)\b/i)?.[1]?.toLowerCase();
  if (unit === undefined) return undefined;
  return ['ml', 'cl', 'l'].includes(unit) ? 'ml' : 'g';
}

/** kcal bzw. g als `milli_kcal` bzw. mg; `null` ohne gültigen, nicht negativen Wert. */
function milliOf(value: unknown): number | null {
  const amount = numberOf(value);
  return amount === undefined || amount < 0 ? null : Math.round(amount * 1_000);
}

function numberOf(value: unknown): number | undefined {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : undefined;
}

/** Ein Name ohne Leerraum am Rand, höchstens so lang wie ein Lebensmittelname; `null`, wenn leer. */
function nameOf(text: string | undefined): string | null {
  if (text === undefined) return null;
  const trimmed = [...text.replace(/\s+/g, ' ').trim()].slice(0, foodNameMaxLength).join('').trim();
  return trimmed === '' ? null : trimmed;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
