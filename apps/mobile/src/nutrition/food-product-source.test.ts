/** @jest-environment node */
import { createOffProductSource, offProductOf, offUserAgent, type ProductLookup } from './food-product-source';

// Nachweis für #160: produktiver Adapter der Naht `FoodProductSource` gegen ein aufgezeichnetes `fetch`. Die
// Antworten sind gekürzte echte Antworten der Produkt-API v3 vom 23.11.2026 (`research/off-produkt-api.md`):
// Nutella (3017620422003) in g ohne eindeutige Portion, Coca-Cola (5449000000996) in ml mit Portion 330 ml.

const nutella = {
  code: '3017620422003',
  status: 'success',
  product: {
    brands: 'Ferrero, Nutella',
    nutriments: { carbohydrates_100g: 57.5, 'energy-kcal_100g': 539, fat_100g: 30.9, proteins_100g: 6.3 },
    product_name: 'Nutella',
    product_name_de: 'Nutella',
    product_quantity: 400,
    product_quantity_unit: 'g',
    quantity: '400 g e',
    serving_quantity_unit: 'g',
  },
};

const cola = {
  code: '5449000000996',
  status: 'success',
  product: {
    brands: 'COCA-COLA SERVICES SA/NV',
    nutriments: { carbohydrates_100g: 10.9, 'energy-kcal_100g': 44, fat_100g: 0, proteins_100g: 0 },
    product_name: 'Coca-Cola Original',
    product_name_de: 'Coca-Cola',
    product_quantity: 330,
    product_quantity_unit: 'ml',
    quantity: '330 ml',
    serving_quantity: 330,
    serving_quantity_unit: 'ml',
  },
};

const notFound = { code: '4000000000037', status: 'failure', result: { id: 'product_not_found' } };

type Call = { url: string; headers: Headers; signal: AbortSignal | null | undefined };

function recordingFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), signal: init?.signal });
    return respond();
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function lookup(respond: () => Response | Promise<Response>, barcode = '3017620422003') {
  const recorded = recordingFetch(respond);
  const source = createOffProductSource({ fetch: recorded.fetch, userAgent: offUserAgent('0.1.0', 'kontakt@example.org') });
  const result: ProductLookup = await source.lookup(barcode, new AbortController().signal);
  return { result, calls: recorded.calls };
}

describe('Open-Food-Facts-Adapter (#160)', () => {
  it('fragt die Produkt-API v3 nur mit den benötigten Feldern und dem Pflicht-User-Agent ab, ohne Sitzung', async () => {
    const { calls } = await lookup(() => json(nutella));
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(
      'https://world.openfoodfacts.org/api/v3/product/3017620422003?fields=product_name,product_name_de,brands,quantity,product_quantity_unit,serving_quantity,serving_quantity_unit,nutriments',
    );
    expect(call!.headers.get('user-agent')).toBe('AbnehmApp/0.1.0 (kontakt@example.org)');
    expect(call!.headers.has('authorization')).toBe(false);
    expect(call!.signal).toBeDefined();
  });

  it('übernimmt Name, Marke, Basiseinheit g und die vier Nährwerte je 100 g; eine Portion ohne Menge entfällt', async () => {
    expect((await lookup(() => json(nutella))).result).toEqual({
      type: 'found',
      product: {
        name: 'Nutella',
        brand: 'Ferrero, Nutella',
        baseUnit: 'g',
        milliKcalPer100: 539_000,
        proteinMgPer100: 6_300,
        carbsMgPer100: 57_500,
        fatMgPer100: 30_900,
        portions: [],
      },
    });
  });

  it('übernimmt ein Getränk in ml samt eindeutiger Portion in ml und bevorzugt den deutschen Namen', async () => {
    expect((await lookup(() => json(cola))).result).toEqual({
      type: 'found',
      product: {
        name: 'Coca-Cola',
        brand: 'COCA-COLA SERVICES SA/NV',
        baseUnit: 'ml',
        milliKcalPer100: 44_000,
        proteinMgPer100: 0,
        carbsMgPer100: 10_900,
        fatMgPer100: 0,
        portions: [{ unit: 'portion', label: null, baseAmount: 330 }],
      },
    });
  });

  it('HTTP 404 ist not_found, 429 und 5xx sind erneut versuchbar, andere Antworten nicht', async () => {
    expect((await lookup(() => json(notFound, 404))).result).toEqual({ type: 'not_found' });
    expect((await lookup(() => new Response(null, { status: 429 }))).result).toEqual({ type: 'unavailable', retryable: true });
    expect((await lookup(() => new Response(null, { status: 503 }))).result).toEqual({ type: 'unavailable', retryable: true });
    expect((await lookup(() => new Response(null, { status: 400 }))).result).toEqual({ type: 'unavailable', retryable: false });
    expect((await lookup(() => json({ status: 'success' }))).result).toEqual({ type: 'unavailable', retryable: false });
  });

  it('ohne Verbindung ist das Ergebnis offline', async () => {
    expect((await lookup(() => Promise.reject(new TypeError('Network request failed')))).result).toEqual({ type: 'offline' });
  });
});

describe('Produkt aus der OFF-Antwort (#160)', () => {
  const base = { product_name: 'Joghurt', quantity: '500 g', nutriments: { 'energy-kcal_100g': 64, proteins_100g: 3.9, carbohydrates_100g: 4.5, fat_100g: 3.5 } };

  it('fehlende, negative oder unlesbare Nährwerte werden null, Zahlen als Text gelten', () => {
    expect(offProductOf({ product: { ...base, nutriments: { 'energy-kcal_100g': '64', proteins_100g: -1, carbohydrates_100g: 'viel' } } })).toMatchObject({
      milliKcalPer100: 64_000,
      proteinMgPer100: null,
      carbsMgPer100: null,
      fatMgPer100: null,
    });
  });

  it('ohne Einheit der Packung entscheidet ihr Text, sonst die Portion, sonst g', () => {
    expect(offProductOf({ product: { ...base, quantity: '1,5 l' } })?.baseUnit).toBe('ml');
    expect(offProductOf({ product: { ...base, quantity: undefined, serving_quantity_unit: 'ml' } })?.baseUnit).toBe('ml');
    expect(offProductOf({ product: { ...base, quantity: undefined } })?.baseUnit).toBe('g');
  });

  it('eine Portion nur, wenn sie eindeutig in der Basiseinheit angegeben ist', () => {
    expect(offProductOf({ product: { ...base, serving_quantity: 150, serving_quantity_unit: 'g' } })?.portions).toEqual([{ unit: 'portion', label: null, baseAmount: 150_000 }]);
    expect(offProductOf({ product: { ...base, serving_quantity: 150, serving_quantity_unit: 'ml' } })?.portions).toEqual([]);
    expect(offProductOf({ product: { ...base, serving_quantity: 0, serving_quantity_unit: 'g' } })?.portions).toEqual([]);
  });

  it('der Name wird gekürzt und bereinigt; ohne Namen ist er null', () => {
    expect(offProductOf({ product: { ...base, product_name: '  Joghurt \n natur  ' } })?.name).toBe('Joghurt natur');
    expect([...(offProductOf({ product: { ...base, product_name: 'x'.repeat(250) } })?.name ?? '')]).toHaveLength(200);
    expect(offProductOf({ product: { ...base, product_name: ' ' } })?.name).toBeNull();
  });
});
