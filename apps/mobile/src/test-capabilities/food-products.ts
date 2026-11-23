import type { FoodProductSource } from '../nutrition';
import { createFakeFoodProductSource, type FakeProductMode } from '../nutrition/testing/fake-food-product-source';
import type { FaultController } from './faults';

// Fake der `FoodProductSource` in Test-Artefakten (Spezifikation 2, Abschnitt 13; #160): Development- und E2E-Build
// stellen ihn per Link `produkt?ergebnis=<modus>`. Bis zum ersten Link fragt die App Open Food Facts wie im
// Produktionsbuild; danach antwortet der Fake mit `katalog`, `nicht_gefunden`, `unvollstaendig`, `http_429`,
// `http_503`, `zeitueberschreitung` oder `offline`. `ergebnis=echt` stellt zurück auf Open Food Facts. Der
// Transport-Fehlermodus (`fehler?transport=offline`) gilt auch hier. Registriert als Testfähigkeit
// `fake-produktquelle` (`test/test-capabilities.ts`).
//
// `produkt?scan=<barcode>` hinterlegt zusätzlich einen Barcode, den der nächste geöffnete Scanner wie einen
// Kameratreffer übernimmt: Der iOS-Simulator hat keine Kamera (https://docs.expo.dev/versions/v58.0.0/sdk/camera/),
// und Maestro kann keinen Barcode vor die Kamera halten.

export type TestFoodProductMode = FakeProductMode | 'echt';

export type TestFoodProducts = Readonly<{
  /** Umhüllt die Produktquelle des Geräts; einmal je Prozess. */
  source(inner: FoodProductSource): FoodProductSource;
  apply(change: Readonly<{ mode?: TestFoodProductMode; scan?: string }>): void;
  /** Der hinterlegte Barcode für den nächsten Scanner, höchstens einmal; sonst `null`. */
  takeScan(): string | null;
}>;

export function createTestFoodProducts(faults: Pick<FaultController, 'plan'>): TestFoodProducts {
  const fake = createFakeFoodProductSource();
  let active = false;
  let pendingScan: string | null = null;
  return {
    source(inner) {
      return {
        lookup(barcode, signal) {
          if (faults.plan().transport === 'offline') return Promise.resolve({ type: 'offline' });
          return (active ? fake : inner).lookup(barcode, signal);
        },
      };
    },
    apply({ mode, scan }) {
      if (mode === 'echt') active = false;
      else if (mode !== undefined) {
        active = true;
        fake.setMode(mode);
      }
      if (scan !== undefined) pendingScan = scan;
    },
    takeScan() {
      const scan = pendingScan;
      pendingScan = null;
      return scan;
    },
  };
}
