import { z } from 'zod';

import { EntityId, Instant, LocalDate, MealKey, TimeZone, UtcOffsetMinutes } from './base.ts';
import { addDays } from './calendar.ts';
import { QuickCommandOutcome } from './today.ts';

// Ernährung (Spezifikation 2, Abschnitte 2–4): Lebensmittelreferenz, Nährwert-Snapshot, Eintragsmenge
// und die Rechenregeln, mit denen App, Server und Projektoren dieselben Werte bilden. Messwerte sind
// Ganzzahlen nach Spezifikation 0, Abschnitt 8: Energie in `milli_kcal`, Nährstoffe und
// Lebensmittelmasse in mg, Volumen in ml. Gerundet wird nur für die Anzeige.

/** Basiseinheit eines Lebensmittels. Mengen in dieser Einheit stehen in mg (g) bzw. ml. */
export const BaseUnit = z.enum(['g', 'ml']);
export type BaseUnit = z.infer<typeof BaseUnit>;

/** Höchstmenge je Eintrag in der Basiseinheit: 5 kg bzw. 5 l (Spezifikation 2, Abschnitt 2). */
export const maxBaseAmount: Readonly<Record<BaseUnit, number>> = { g: 5_000_000, ml: 5_000 };

const amountWithin = (baseUnit: BaseUnit, amount: number) => amount <= maxBaseAmount[baseUnit];

/**
 * Text ohne Leerraum am Rand, 1 bis `max` Zeichen, gezählt in Unicode-Codepunkten wie bei
 * `DisplayName`. Die Höchstlängen unten sind Designwerte (nicht belegt).
 */
const trimmedText = (max: number) =>
  z
    .string()
    .refine((value) => value === value.trim(), { message: 'Kein Leerraum am Rand' })
    .refine((value) => [...value].length >= 1 && [...value].length <= max, { message: `1–${max} Zeichen` });

/** Herkunft der Werte eines Snapshots; `ki` hat keine Lebensmittelreferenz. */
export const SnapshotSource = z.enum(['bls', 'off', 'eigen', 'ki']);
export type SnapshotSource = z.infer<typeof SnapshotSource>;

/** Art einer Lebensmittelreferenz: jede Quelle außer der KI-Schätzung (Spezifikation 2, Abschnitt 2). */
export const FoodRefType = SnapshotSource.exclude(['ki']);
export type FoodRefType = z.infer<typeof FoodRefType>;

/** BLS-Schlüssel: Buchstabe der Hauptgruppe und sechs Stellen (BLS-4.0-Dokumentation, Abschnitt 2.4). */
export const BlsKey = z.string().regex(/^[A-Z][0-9A-Z]{6}$/);

/** Barcode als GTIN-8, -12, -13 oder -14 (https://www.gs1.org/standards/id-keys/gtin); UPC-E hat 8 Stellen. */
const Barcode = z.string().regex(/^(?:[0-9]{8}|[0-9]{12,14})$/);

/**
 * Lebensmittelreferenz: woher die Werte eines Eintrags oder Favoriten stammen. In SQLite und Postgres
 * steht sie als `food_ref_type` und `food_ref_key`.
 */
export const FoodRef = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(FoodRefType.enum.bls), key: BlsKey }),
  z.strictObject({ type: z.literal(FoodRefType.enum.off), key: Barcode }),
  z.strictObject({ type: z.literal(FoodRefType.enum.eigen), key: EntityId }),
]);
export type FoodRef = z.infer<typeof FoodRef>;

/** Bekannte Umrechnung von Stück bzw. Portion in die Basiseinheit. */
export const PortionConversion = z.strictObject({
  unit: z.enum(['stueck', 'portion']),
  /** Bezeichnung wie „1 Becher“; ohne sie heißt die Einheit nur „Stück“ bzw. „Portion“. */
  label: trimmedText(40).nullable(),
  /** Basismenge eines Stücks bzw. einer Portion in mg bzw. ml. */
  baseAmount: z.int().positive(),
});
export type PortionConversion = z.infer<typeof PortionConversion>;

const nutrient = z.int().nonnegative();

/**
 * Vollständiger Nährwert-Snapshot, wie er an jedem Ernährungseintrag und jeder Favoritenfassung
 * gespeichert wird. Spätere Korrekturen am Lebensmittel ändern ihn nicht (Spezifikation 2, Abschnitt 2).
 */
export const NutritionSnapshot = z
  .strictObject({
    name: trimmedText(200),
    baseUnit: BaseUnit,
    /** Bezugsmenge der Nährwerte in der Basiseinheit, z. B. 100.000 für 100 g. */
    referenceAmount: z.int().positive(),
    milliKcal: nutrient,
    proteinMg: nutrient,
    carbsMg: nutrient,
    fatMg: nutrient,
    /** Höchstens eine Umrechnung je Einheit: Die Mengenprüfung bietet je Einheit einen Chip. */
    portions: z.array(PortionConversion).max(2),
    source: SnapshotSource,
    /** Quellenangabe, etwa für BLS und Open Food Facts; eigene Lebensmittel und KI-Schätzungen brauchen keine. */
    attribution: trimmedText(300).nullable(),
  })
  // Bezugsmenge und Umrechnungen begrenzt wie die Menge je Eintrag (Designwert, nicht belegt): Größere
  // Werte ergäben keinen erfassbaren Eintrag und halten die Rechnung im sicheren Ganzzahlbereich.
  .refine((s) => amountWithin(s.baseUnit, s.referenceAmount), {
    message: 'Bezugsmenge höchstens 5 kg bzw. 5 l',
    path: ['referenceAmount'],
  })
  // Makros und Bezugsmenge sind nur bei der Basiseinheit g beide Massen; bei ml hinge der Vergleich
  // von der Dichte ab. So prüfen es auch die CHECKs `*_macros_check` beider Datenbankschemas.
  .refine((s) => s.baseUnit !== 'g' || s.proteinMg + s.carbsMg + s.fatMg <= s.referenceAmount, {
    message: 'Makros zusammen höchstens die Bezugsmenge',
    path: ['proteinMg'],
  })
  .refine((s) => new Set(s.portions.map((portion) => portion.unit)).size === s.portions.length, {
    message: 'Höchstens eine Umrechnung je Einheit',
    path: ['portions'],
  })
  .refine((s) => s.portions.every((portion) => amountWithin(s.baseUnit, portion.baseAmount)), {
    message: 'Stück bzw. Portion höchstens 5 kg bzw. 5 l',
    path: ['portions'],
  })
  .refine((s) => (s.source !== 'bls' && s.source !== 'off') || s.attribution !== null, {
    message: 'BLS und Open Food Facts brauchen eine Quellenangabe',
    path: ['attribution'],
  })
  .refine((s) => s.source !== 'bls' || (s.baseUnit === 'g' && s.portions.length === 0), {
    message: 'BLS-Lebensmittel haben die Basiseinheit g und keine Portionsumrechnung',
    path: ['source'],
  });
export type NutritionSnapshot = z.infer<typeof NutritionSnapshot>;

/** Einheit, in der die Person eine Menge eingibt und sieht. */
export const DisplayUnit = z.enum(['g', 'ml', 'stueck', 'portion']);
export type DisplayUnit = z.infer<typeof DisplayUnit>;

/** Menge eines Eintrags: verzehrte Basismenge und die Anzeige, in der die Person sie eingegeben hat. */
export const EntryAmount = z.strictObject({
  /** Verzehrte Menge in der Basiseinheit des Snapshots: mg bzw. ml. */
  baseAmount: z.int().positive(),
  displayUnit: DisplayUnit,
  /** Angezeigte Menge in Tausendsteln der Anzeigeeinheit, z. B. 500 für 0,5 Stück. */
  displayAmountMilli: z.int().positive(),
});
export type EntryAmount = z.infer<typeof EntryAmount>;

/** Eintragssummen: kcal und Makros der verzehrten Menge, beim Speichern berechnet und mitgespeichert. */
export const EntryTotals = z.strictObject({ milliKcal: nutrient, proteinMg: nutrient, carbsMg: nutrient, fatMg: nutrient });
export type EntryTotals = z.infer<typeof EntryTotals>;

/** Warum sich aus einer Eingabe keine Eintragsmenge ergibt. */
export type AmountProblem = 'einheit_unbekannt' | 'menge_zu_klein' | 'menge_zu_gross';

/**
 * Eintragsmenge aus der Eingabe der Person: Anzeigeeinheit und Anzeigemenge in Tausendsteln. Gramm
 * werden zu mg, Milliliter, Stück und Portionen kaufmännisch zu ganzen mg bzw. ml. Stück und Portion
 * gibt es nur mit bekannter Umrechnung; die App schätzt keine (Spezifikation 2, Abschnitt 2).
 */
export function entryAmount(
  snapshot: NutritionSnapshot,
  displayUnit: DisplayUnit,
  displayAmountMilli: number,
): { type: 'menge'; amount: EntryAmount } | { type: 'problem'; problem: AmountProblem } {
  const perUnit = baseAmountPerDisplayUnit(snapshot, displayUnit);
  if (perUnit === null) return { type: 'problem', problem: 'einheit_unbekannt' };
  if (!Number.isSafeInteger(displayAmountMilli) || displayAmountMilli <= 0) return { type: 'problem', problem: 'menge_zu_klein' };

  const baseAmount = scaled(displayAmountMilli, perUnit, 1_000);
  if (baseAmount < 1) return { type: 'problem', problem: 'menge_zu_klein' };
  if (!amountWithin(snapshot.baseUnit, baseAmount)) return { type: 'problem', problem: 'menge_zu_gross' };
  return { type: 'menge', amount: { baseAmount, displayUnit, displayAmountMilli } };
}

/** Basismenge (mg bzw. ml) einer ganzen Anzeigeeinheit; `null`, wenn die Einheit nicht bekannt ist. */
function baseAmountPerDisplayUnit(snapshot: NutritionSnapshot, displayUnit: DisplayUnit): number | null {
  if (displayUnit === snapshot.baseUnit) return displayUnit === 'g' ? 1_000 : 1;
  if (displayUnit === 'stueck' || displayUnit === 'portion') {
    return snapshot.portions.find((portion) => portion.unit === displayUnit)?.baseAmount ?? null;
  }
  return null;
}

/**
 * Eintragssummen aus Snapshot und Menge: die Nährwerte je Bezugsmenge, umgerechnet auf die verzehrte
 * Basismenge und kaufmännisch auf ganze `milli_kcal` bzw. mg gerundet. Ob die Basismenge zur Anzeige
 * passt, entscheidet `entryAmount`.
 */
export function entryTotals(snapshot: NutritionSnapshot, amount: EntryAmount): EntryTotals {
  const scale = (value: number) => scaled(value, amount.baseAmount, snapshot.referenceAmount);
  return {
    milliKcal: scale(snapshot.milliKcal),
    proteinMg: scale(snapshot.proteinMg),
    carbsMg: scale(snapshot.carbsMg),
    fatMg: scale(snapshot.fatMg),
  };
}

/** Erfassungsart eines Ernährungseintrags (Spezifikation 2, Abschnitt 6); beide Datenbankschemas nehmen sie von hier. */
export const CaptureMethod = z.enum([
  'suche',
  'barcode',
  'foto',
  'lebensmittelfavorit',
  'mahlzeitenfavorit',
  'zuletzt',
  'eigenes_lebensmittel',
]);
export type CaptureMethod = z.infer<typeof CaptureMethod>;

const entryFields = {
  /** Erfassungszeitpunkt; lokaler Tag, Zone und Offset stammen beim Anlegen aus derselben Ablesung der Uhr. */
  consumedAt: Instant,
  /** Der im Protokoll gewählte Tag; er kann vor dem Tag des Erfassungszeitpunkts liegen (Nachtragen). */
  localDate: LocalDate,
  timeZone: TimeZone,
  utcOffsetMinutes: UtcOffsetMinutes,
  meal: MealKey,
  captureMethod: CaptureMethod,
  /** Fehlt nur bei KI-Bestandteilen ohne Ersatz durch ein Suchergebnis. */
  foodRef: FoodRef.nullable(),
  snapshot: NutritionSnapshot,
  amount: EntryAmount,
  totals: EntryTotals,
  mealPhotoId: EntityId.nullable(),
};

type EntryFields = { [K in keyof typeof entryFields]: z.output<(typeof entryFields)[K]> };

/**
 * Regeln eines Ernährungseintrags wie in den CHECKs beider Datenbankschemas und der Server-Validierung
 * (Spezifikation 2, Abschnitt 11): Die Referenz passt zur Quelle des Snapshots, KI-Schätzungen kommen
 * nur aus einem Foto, Menge und Summen folgen aus Snapshot und Anzeige. So rechnen App, Server und
 * Projektoren mit identischen Werten.
 */
function withEntryRules<T extends z.ZodType<EntryFields>>(schema: T) {
  return schema
    .refine((entry) => (entry.foodRef === null) === (entry.snapshot.source === 'ki') && (entry.foodRef === null || entry.foodRef.type === entry.snapshot.source), {
      message: 'Die Lebensmittelreferenz passt nicht zur Quelle des Snapshots',
      path: ['foodRef'],
    })
    .refine((entry) => entry.snapshot.source !== 'ki' || entry.captureMethod === 'foto', {
      message: 'KI-Schätzungen kommen nur aus einem Foto',
      path: ['captureMethod'],
    })
    .refine(
      (entry) => withinSafeIntegers(() => {
        const amount = entryAmount(entry.snapshot, entry.amount.displayUnit, entry.amount.displayAmountMilli);
        return amount.type === 'menge' && amount.amount.baseAmount === entry.amount.baseAmount;
      }),
      { message: 'Die Menge passt nicht zu Snapshot und Anzeige', path: ['amount'] },
    )
    .refine(
      (entry) => withinSafeIntegers(() => {
        const totals = entryTotals(entry.snapshot, entry.amount);
        return (Object.keys(totals) as (keyof EntryTotals)[]).every((key) => totals[key] === entry.totals[key]);
      }),
      { message: 'Die Summen passen nicht zu Snapshot und Menge', path: ['totals'] },
    );
}

/** Eine Prüfung, deren Rechnung den sicheren Ganzzahlbereich verlässt, scheitert, statt zu werfen. */
function withinSafeIntegers(check: () => boolean): boolean {
  try {
    return check();
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/**
 * Vollständige Nutzlast eines Ernährungseintrags im Sync (Spezifikation 2, Abschnitt 11), ohne
 * Eigentums-, Server- und abgeleitete Felder. Snapshot und Summen werden mitgespeichert, damit spätere
 * Korrekturen am Lebensmittel vergangene Tage nicht verschieben.
 */
export const NutritionEntryUpsert = withEntryRules(z.strictObject(entryFields));
export type NutritionEntryUpsert = z.infer<typeof NutritionEntryUpsert>;

/** Kanonischer Ernährungseintrag des Servers: Nutzlast samt Eigentümer und Zeitpunkten. */
export const NutritionEntryRecord = withEntryRules(
  z.strictObject({ ...entryFields, personId: EntityId, createdAt: Instant, updatedAt: Instant }),
);
export type NutritionEntryRecord = z.infer<typeof NutritionEntryRecord>;

/**
 * Spätester `local_date`, den der Server für einen Ernährungseintrag annimmt: der aktuelle lokale Tag
 * der Person zuzüglich eines Tages Toleranz für Zeitzonen (Spezifikation 2, Abschnitt 11). Die App
 * selbst erreicht künftige Tage nicht.
 */
export function latestAcceptedEntryDate(personToday: LocalDate): LocalDate {
  return LocalDate.parse(addDays(personToday, 1));
}

/** Werte der Meldung nach dem Hinzufügen, etwa „209 kcal zum Frühstück hinzugefügt“; ohne Namen des Lebensmittels. */
export const NutritionEntryAddedValues = z.strictObject({ meal: MealKey, kcal: z.int().nonnegative() });
export type NutritionEntryAddedValues = z.infer<typeof NutritionEntryAddedValues>;

/** Ergebnis von „Eintrag hinzufügen“: Meldung samt typisierten Werten und flüchtigem Undo-Token. */
export const NutritionEntryAddedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('ernaehrung.eintrag_hinzugefuegt'),
  values: NutritionEntryAddedValues,
});
export type NutritionEntryAddedOutcome = z.infer<typeof NutritionEntryAddedOutcome>;

/** Angezeigte kcal: kaufmännisch auf ganze kcal gerundet (Spezifikation 2, Abschnitt 2). */
export function roundKcal(milliKcal: number): number {
  return scaled(milliKcal, 1, 1_000);
}

/** Tagesaufnahme in kcal: die gerundete Summe der `milli_kcal` aller nicht gelöschten Einträge des Tags. */
export function dailyIntakeKcal(entryMilliKcal: Iterable<number>): number {
  let sum = 0;
  for (const milliKcal of entryMilliKcal) sum += milliKcal;
  return roundKcal(sum);
}

/** Angezeigte Makros in g: kaufmännisch auf ganze g, unter 10 g auf eine Nachkommastelle. */
export function roundMacroGrams(mg: number): number {
  const tenths = scaled(mg, 1, 100);
  return tenths < 100 ? tenths / 10 : scaled(mg, 1, 1_000);
}

/**
 * `value · numerator / denominator`, kaufmännisch gerundet: ⌊(2·value·numerator + denominator) / (2·denominator)⌋.
 * Das Produkt kann über 2^53 liegen; BigInt rechnet es exakt.
 */
function scaled(value: number, numerator: number, denominator: number): number {
  const result = Number(
    (2n * BigInt(value) * BigInt(numerator) + BigInt(denominator)) / (2n * BigInt(denominator)),
  );
  if (!Number.isSafeInteger(result)) throw new RangeError(`Wert außerhalb des Ganzzahlbereichs: ${result}`);
  return result;
}
