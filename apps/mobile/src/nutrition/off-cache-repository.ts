import { eq } from 'drizzle-orm';

import { BaseUnit, NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { ReadContext } from '../local-db';
import { offCache } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Lesender Zugriff auf den lokalen Open-Food-Facts-Cache (Spezifikation 2, Abschnitt 3). Favoriten und
// „Zuletzt verwendet“ lösen damit Barcode-Referenzen auf (#158); Abfrage und Pflege des Caches liefert
// der Barcode-Scan (#160). Werte stehen je 100 g bzw. 100 ml.

/** Quellenangabe der Produkte (https://world.openfoodfacts.org/terms-of-use). */
export const offAttribution = 'Daten von Open Food Facts (openfoodfacts.org), ODbL';

/** Bezugsmenge 100 g bzw. 100 ml in mg bzw. ml. */
const per100: Readonly<Record<BaseUnit, number>> = { g: 100_000, ml: 100 };

/** Ein vollständiges Produkt des Caches als Snapshot; `null` ohne Eintrag oder mit fehlenden Nährwerten. */
export function cachedProduct(tx: ReadContext, barcode: string): NutritionSnapshot | null {
  const row = sqliteOf(tx).select().from(offCache).where(eq(offCache.barcode, barcode)).get();
  if (row === undefined) return null;
  const { milliKcalPer100, proteinMgPer100, carbsMgPer100, fatMgPer100 } = row;
  // Unvollständig, wenn kcal oder einer der drei Makros fehlt.
  if (milliKcalPer100 === null || proteinMgPer100 === null || carbsMgPer100 === null || fatMgPer100 === null) return null;
  const baseUnit = BaseUnit.parse(row.baseUnit);
  const parsed = NutritionSnapshot.safeParse({
    name: row.name,
    baseUnit,
    referenceAmount: per100[baseUnit],
    milliKcal: milliKcalPer100,
    proteinMg: proteinMgPer100,
    carbsMg: carbsMgPer100,
    fatMg: fatMgPer100,
    portions: row.portions,
    source: 'off',
    attribution: offAttribution,
  });
  return parsed.success ? parsed.data : null;
}
