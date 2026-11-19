import { z } from 'zod';

import { EntityId, Instant, LocalDate, MealKey, TimeZone, UtcOffsetMinutes } from './base.ts';
import { addDays } from './calendar.ts';
import { ContractErrorCode } from './errors.ts';
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

const BlsRef = z.strictObject({ type: z.literal(FoodRefType.enum.bls), key: BlsKey });
const OffRef = z.strictObject({ type: z.literal(FoodRefType.enum.off), key: Barcode });

/**
 * Lebensmittelreferenz: woher die Werte eines Eintrags oder Favoriten stammen. In SQLite und Postgres
 * steht sie als `food_ref_type` und `food_ref_key`.
 */
export const FoodRef = z.discriminatedUnion('type', [
  BlsRef,
  OffRef,
  z.strictObject({ type: z.literal(FoodRefType.enum.eigen), key: EntityId }),
]);
export type FoodRef = z.infer<typeof FoodRef>;

/** Höchstlänge eines Lebensmittelnamens in Zeichen (Designwert, nicht belegt). */
export const foodNameMaxLength = 200;

/** Höchstlänge der Bezeichnung einer Umrechnung wie „1 Becher“ (Designwert, nicht belegt). */
export const portionLabelMaxLength = 40;

/** Bekannte Umrechnung von Stück bzw. Portion in die Basiseinheit. */
export const PortionConversion = z.strictObject({
  unit: z.enum(['stueck', 'portion']),
  /** Bezeichnung wie „1 Becher“; ohne sie heißt die Einheit nur „Stück“ bzw. „Portion“. */
  label: trimmedText(portionLabelMaxLength).nullable(),
  /** Basismenge eines Stücks bzw. einer Portion in mg bzw. ml. */
  baseAmount: z.int().positive(),
});
export type PortionConversion = z.infer<typeof PortionConversion>;

const nutrient = z.int().nonnegative();

/** Name, Einheit, Nährwerte und Umrechnungen eines Lebensmittels: gemeinsam für Snapshot und eigenes Lebensmittel. */
const foodValueFields = {
  name: trimmedText(foodNameMaxLength),
  baseUnit: BaseUnit,
  /** Bezugsmenge der Nährwerte in der Basiseinheit, z. B. 100.000 für 100 g. */
  referenceAmount: z.int().positive(),
  milliKcal: nutrient,
  proteinMg: nutrient,
  carbsMg: nutrient,
  fatMg: nutrient,
  /** Höchstens eine Umrechnung je Einheit: Die Mengenprüfung bietet je Einheit einen Chip. */
  portions: z.array(PortionConversion).max(2),
};

type FoodValueFields = { [K in keyof typeof foodValueFields]: z.output<(typeof foodValueFields)[K]> };

/** Name, Basiseinheit, Bezugsmenge, Nährwerte und Umrechnungen eines Lebensmittels, ohne Quelle und Herkunftsreferenz. */
export type FoodValues = Readonly<FoodValueFields>;

/** Die Werte eines Snapshots, eines eigenen Lebensmittels oder seines Datensatzes, ohne alle übrigen Felder. */
export function foodValuesOf({ name, baseUnit, referenceAmount, milliKcal, proteinMg, carbsMg, fatMg, portions }: FoodValues): FoodValues {
  return { name, baseUnit, referenceAmount, milliKcal, proteinMg, carbsMg, fatMg, portions };
}

/**
 * Regeln der Werte eines Lebensmittels (Spezifikation 2, Abschnitt 2), für Snapshot und eigenes
 * Lebensmittel gleich: nicht negative Nährwerte (`nutrient`), Makros höchstens in Höhe der Bezugsmenge,
 * Bezugsmenge und Umrechnungen höchstens 5 kg bzw. 5 l, höchstens eine Umrechnung je Einheit.
 */
function withFoodValueRules<T extends z.ZodType<FoodValueFields>>(schema: T) {
  return (
    schema
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
  );
}

/**
 * Vollständiger Nährwert-Snapshot, wie er an jedem Ernährungseintrag und jeder Favoritenfassung
 * gespeichert wird. Spätere Korrekturen am Lebensmittel ändern ihn nicht (Spezifikation 2, Abschnitt 2).
 */
export const NutritionSnapshot = withFoodValueRules(
  z.strictObject({
    ...foodValueFields,
    source: SnapshotSource,
    /** Quellenangabe, etwa für BLS und Open Food Facts; eigene Lebensmittel und KI-Schätzungen brauchen keine. */
    attribution: trimmedText(300).nullable(),
  }),
)
  .refine((s) => (s.source !== 'bls' && s.source !== 'off') || s.attribution !== null, {
    message: 'BLS und Open Food Facts brauchen eine Quellenangabe',
    path: ['attribution'],
  })
  .refine((s) => s.source !== 'bls' || (s.baseUnit === 'g' && s.portions.length === 0), {
    message: 'BLS-Lebensmittel haben die Basiseinheit g und keine Portionsumrechnung',
    path: ['source'],
  });
export type NutritionSnapshot = z.infer<typeof NutritionSnapshot>;

// Eigenes Lebensmittel (Spezifikation 2, Abschnitt 3) ------------------------------------------------

/**
 * Herkunftsreferenz eines eigenen Lebensmittels: das BLS-Lebensmittel bzw. der Barcode, den es
 * korrigiert. Ab dann überdeckt es diese Quelle; die externen Daten bleiben unverändert.
 */
export const OwnFoodOrigin = z.discriminatedUnion('type', [BlsRef, OffRef]);
export type OwnFoodOrigin = z.infer<typeof OwnFoodOrigin>;

const ownFoodFields = { ...foodValueFields, origin: OwnFoodOrigin.nullable() };

/**
 * Nutzlast eines eigenen Lebensmittels im Sync (Spezifikation 2, Abschnitt 11): generisches
 * Upsert/Delete, Last-Write-Wins pro Zeile, Löschen ist ein Tombstone. Server und App prüfen dieselben
 * Regeln wie am Snapshot: nicht negative Nährwerte, Makros höchstens in Höhe der Bezugsmenge.
 */
export const OwnFoodUpsert = withFoodValueRules(z.strictObject(ownFoodFields));
export type OwnFoodUpsert = z.infer<typeof OwnFoodUpsert>;

/** Kanonisches eigenes Lebensmittel des Servers: Nutzlast samt Eigentümer und Zeitpunkten. */
export const OwnFoodRecord = withFoodValueRules(z.strictObject({ ...ownFoodFields, personId: EntityId, createdAt: Instant, updatedAt: Instant }));
export type OwnFoodRecord = z.infer<typeof OwnFoodRecord>;

/**
 * Die aktuelle Fassung eines eigenen Lebensmittels als Snapshot: Quelle `eigen`, ohne Quellenangabe.
 * Daraus entstehen Snapshots künftiger Einträge; gespeicherte Einträge behalten ihren.
 */
export function ownFoodSnapshot(food: FoodValues): NutritionSnapshot {
  return NutritionSnapshot.parse({ ...foodValuesOf(food), source: 'eigen', attribution: null });
}

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

/**
 * Ergebnis von „Eintrag ändern“ (Menge, Einheit oder Mahlzeit; Spezifikation 2, Abschnitt 6): „Eintrag
 * gespeichert · Rückgängig“. Der Wortlaut folgt den Bearbeiten-Meldungen von Sport und Gewicht
 * (Spezifikation 3, Abschnitt 4) und ist ein Designwert, nicht belegt.
 */
export const NutritionEntryUpdatedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('ernaehrung.eintrag_gespeichert'),
  values: z.strictObject({}),
});
export type NutritionEntryUpdatedOutcome = z.infer<typeof NutritionEntryUpdatedOutcome>;

/** Ergebnis von „Eintrag löschen“ ohne Bestätigungsdialog: „Eintrag gelöscht · Rückgängig“ (Spezifikation 2, Abschnitt 6). */
export const NutritionEntryDeletedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('ernaehrung.eintrag_geloescht'),
  values: z.strictObject({}),
});
export type NutritionEntryDeletedOutcome = z.infer<typeof NutritionEntryDeletedOutcome>;

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

// KI-Fotoanalyse (Spezifikation 2, Abschnitt 8) -----------------------------------------------------

/** Bildformate, die der Endpunkt der Fotoanalyse annimmt; die App lädt JPEG hoch. */
export const PhotoMediaType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type PhotoMediaType = z.infer<typeof PhotoMediaType>;

/** Höchstgröße eines hochgeladenen Fotos: 8 MB (Designwert, nicht belegt; Claude nimmt bis 10 MB je Bild). */
export const photoUploadMaxBytes = 8_000_000;

/**
 * Anfrage der Fotoanalyse: ein Bild im Feld `photo` eines `multipart/form-data`-Bodys. Das Schema
 * beschreibt, welche Datei der Server annimmt; ob sie sich als Bild dekodieren lässt, prüft er danach.
 */
export const PhotoAnalysisUpload = z.strictObject({ mediaType: PhotoMediaType, byteSize: z.int().min(1).max(photoUploadMaxBytes) });
export type PhotoAnalysisUpload = z.infer<typeof PhotoAnalysisUpload>;

/** Höchstzahl der Bestandteile eines Fotoentwurfs (Designwert, nicht belegt). */
export const photoAnalysisMaxComponents = 15;

/** Höchstwert für kcal eines Bestandteils: 5 kg reines Fett (9 kcal/g) liegen darunter; schützt die Ganzzahlrechnung. */
const maxComponentKcal = 50_000;

/** Ein Bestandteil, wie ihn das Modell schätzt: Menge in g bzw. ml, Nährwerte für genau diese Menge. */
const EstimatedComponent = z.strictObject({
  name: z.string().trim().min(1).max(200),
  amount: z.number().positive(),
  unit: BaseUnit,
  kcal: z.number().nonnegative().max(maxComponentKcal),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
});
type EstimatedComponent = z.infer<typeof EstimatedComponent>;

/**
 * Bestandteil einer Fotoanalyse, wie das Modell ihn liefert: deutscher Name, geschätzte Menge in g
 * bzw. ml und die Nährwerte für genau diese Menge. Zahlengrenzen bildet Structured Outputs nicht ab;
 * die Zod-Prüfung beim Parsen setzt sie durch (https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
 */
export const MealPhotoAnalysisComponent = EstimatedComponent.refine((component) => photoDraftComponentOf(component) !== null, {
  message: 'Menge über 0 und höchstens 5 kg bzw. 5 l; Makros zusammen höchstens die Menge',
});
export type MealPhotoAnalysisComponent = z.infer<typeof MealPhotoAnalysisComponent>;

/** Antwortschema des Modells für die Fotoanalyse; eine leere Liste heißt „kein Essen erkannt“. */
export const MealPhotoAnalysis = z.strictObject({ components: z.array(MealPhotoAnalysisComponent).max(photoAnalysisMaxComponents) });
export type MealPhotoAnalysis = z.infer<typeof MealPhotoAnalysis>;

/**
 * Bestandteil eines Fotoentwurfs in Vertragseinheiten: verzehrte Basismenge (mg bzw. ml) und die
 * Nährwerte dieser Menge in `milli_kcal` und mg. Die App bildet daraus den Snapshot der Quelle `ki`
 * mit dieser Menge als Bezugsmenge.
 */
export const PhotoDraftComponent = z
  .strictObject({
    name: trimmedText(200),
    baseUnit: BaseUnit,
    baseAmount: z.int().positive(),
    milliKcal: nutrient,
    proteinMg: nutrient,
    carbsMg: nutrient,
    fatMg: nutrient,
  })
  .refine((c) => amountWithin(c.baseUnit, c.baseAmount), { message: 'Menge höchstens 5 kg bzw. 5 l', path: ['baseAmount'] })
  .refine((c) => c.baseUnit !== 'g' || c.proteinMg + c.carbsMg + c.fatMg <= c.baseAmount, {
    message: 'Makros zusammen höchstens die Menge',
    path: ['proteinMg'],
  });
export type PhotoDraftComponent = z.infer<typeof PhotoDraftComponent>;

/**
 * Rechnet einen Bestandteil des Modells in Vertragseinheiten um, kaufmännisch auf ganze mg, ml und
 * `milli_kcal` gerundet. `null`, wenn sich daraus kein gültiger Bestandteil ergibt: Menge unter einer
 * Basiseinheit oder über 5 kg bzw. 5 l, bei Gramm Makros über der Menge.
 */
export function photoDraftComponentOf(component: EstimatedComponent): PhotoDraftComponent | null {
  const thousandths = (value: number) => Math.round(value * 1_000);
  const result = PhotoDraftComponent.safeParse({
    name: component.name.trim(),
    baseUnit: component.unit,
    baseAmount: component.unit === 'g' ? thousandths(component.amount) : Math.round(component.amount),
    milliKcal: thousandths(component.kcal),
    proteinMg: thousandths(component.proteinG),
    carbsMg: thousandths(component.carbsG),
    fatMg: thousandths(component.fatG),
  });
  return result.success ? result.data : null;
}

/** Erfolgreiche Fotoanalyse: der angelegte Fotoentwurf mit seinen Bestandteilen. */
export const PhotoAnalysisResult = z.strictObject({
  draftId: EntityId,
  /** Ab dann nimmt der Server den Entwurf nicht mehr an; spätestens 24 Stunden nach der Analyse ist er samt Bild gelöscht. */
  expiresAt: Instant,
  components: z.array(PhotoDraftComponent).min(1).max(photoAnalysisMaxComponents),
});
export type PhotoAnalysisResult = z.infer<typeof PhotoAnalysisResult>;

/** Fehlercodes der Fotoanalyse; `photo_draft_expired` gehört zum Bestätigen des Entwurfs. */
export const PhotoAnalysisErrorCode = ContractErrorCode.extract([
  'photo_invalid_image',
  'photo_no_food_detected',
  'photo_analysis_failed',
  'photo_analysis_limit_reached',
  'photo_analysis_unavailable',
]);
export type PhotoAnalysisErrorCode = z.infer<typeof PhotoAnalysisErrorCode>;

/**
 * Fehlerantwort der Fotoanalyse, ein `ContractError` ohne Kontext. Wiederholbar ist nur
 * `photo_analysis_unavailable` (Anbieter oder Server nicht erreichbar).
 */
export const PhotoAnalysisError = z
  .strictObject({ code: PhotoAnalysisErrorCode, retryable: z.boolean() })
  .refine((error) => error.retryable === (error.code === 'photo_analysis_unavailable'), {
    message: 'Wiederholbar ist nur photo_analysis_unavailable',
    path: ['retryable'],
  });
export type PhotoAnalysisError = z.infer<typeof PhotoAnalysisError>;

/**
 * Snapshot eines KI-Bestandteils aus dem Fotoentwurf: Quelle `ki`, die geschätzte Menge als
 * Bezugsmenge, ohne Portionsumrechnung und Quellenangabe (Spezifikation 2, Abschnitt 8). Ändert die
 * Person die Menge, skalieren seine Nährwerte damit linear.
 */
export function photoDraftSnapshot(component: PhotoDraftComponent): NutritionSnapshot {
  return NutritionSnapshot.parse({
    name: component.name,
    baseUnit: component.baseUnit,
    referenceAmount: component.baseAmount,
    milliKcal: component.milliKcal,
    proteinMg: component.proteinMg,
    carbsMg: component.carbsMg,
    fatMg: component.fatMg,
    portions: [],
    source: 'ki',
    attribution: null,
  });
}

// Fotoentwurf bestätigen und Mahlzeitenfoto (Spezifikation 2, Abschnitte 8, 9 und 11) ---------------

/**
 * Höchstzahl der Einträge einer bestätigten Fotomahlzeit: die höchstens 15 geschätzten Bestandteile
 * und solche, die die Person ergänzt (Designwert, nicht belegt).
 */
export const photoMealMaxEntries = 30;

/** Ein Eintrag der bestätigten Fotomahlzeit: die ID, die die App vergeben hat, und seine vollständige Nutzlast. */
export const ConfirmedPhotoEntry = z.strictObject({ id: EntityId, entry: NutritionEntryUpsert });
export type ConfirmedPhotoEntry = z.infer<typeof ConfirmedPhotoEntry>;

/**
 * Nutzlast des Fachbefehls `confirmPhotoDraft` (Spezifikation 2, Abschnitt 8): Entwurfs-ID, die von
 * der App vergebene ID des Mahlzeitenfotos, der Freigabeschalter „Mit Partner teilen“ (Standard an)
 * und alle Einträge der Mahlzeit. Jeder Eintrag stammt aus dem Foto und verweist auf dieses
 * Mahlzeitenfoto; alle gehören zu derselben Mahlzeit desselben Tags. Ist der Entwurf nicht mehr
 * gültig, legt der Server die Einträge trotzdem an, dann ohne Foto.
 */
export const ConfirmPhotoDraft = z
  .strictObject({
    draftId: EntityId,
    photoId: EntityId,
    /** „Mit Partner teilen“; Standard an (#22), die Person kann ihn abwählen. */
    sharedWithPartner: z.boolean().default(true),
    entries: z.array(ConfirmedPhotoEntry).min(1).max(photoMealMaxEntries),
  })
  .refine((command) => new Set(command.entries.map((item) => item.id)).size === command.entries.length, {
    message: 'Eintrags-IDs sind eindeutig',
    path: ['entries'],
  })
  .refine((command) => command.entries.every(({ entry }) => entry.captureMethod === 'foto' && entry.mealPhotoId === command.photoId), {
    message: 'Jeder Eintrag stammt aus dem Foto und verweist auf dieses Mahlzeitenfoto',
    path: ['entries'],
  })
  .refine(
    ({ entries: [first, ...rest] }) =>
      first === undefined || rest.every(({ entry }) => entry.meal === first.entry.meal && entry.localDate === first.entry.localDate),
    { message: 'Alle Einträge gehören zu derselben Mahlzeit desselben Tags', path: ['entries'] },
  );
export type ConfirmPhotoDraft = z.infer<typeof ConfirmPhotoDraft>;

/**
 * Fachlicher Idempotenzschlüssel von `confirmPhotoDraft`: der Fotoentwurf. Ein Entwurf wird höchstens
 * einmal zur Mahlzeit; eine zweite, abweichende Bestätigung desselben Entwurfs (etwa ein Doppeltipp)
 * ist ein `operation_conflict` statt einer doppelten Mahlzeit, ein identischer Retry `already_applied`.
 */
export function confirmPhotoDraftKey(draftId: EntityId): string {
  return `fotoentwurf:${draftId}`;
}

/** Bildschlüssel eines Fotos in der Fotoablage: 32 Zufallsbytes in base64url, nicht erratbar. */
export const PhotoImageKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export type PhotoImageKey = z.infer<typeof PhotoImageKey>;

/**
 * Generisches Upsert des Mahlzeitenfotos (Spezifikation 2, Abschnitt 11): nur der Freigabeschalter.
 * Löschen ist ein Tombstone. Ein Mahlzeitenfoto entsteht nur über `confirmPhotoDraft`; ein
 * generisches Create gibt es nicht.
 */
export const MealPhotoUpsert = z.strictObject({ sharedWithPartner: z.boolean() });
export type MealPhotoUpsert = z.infer<typeof MealPhotoUpsert>;

/**
 * Kanonische Metadaten eines Mahlzeitenfotos (Spezifikation 2, Abschnitt 9): Person, Bildschlüssel,
 * Aufnahmezeit und Freigabeschalter. Die Bilddatei liegt nur im Serverspeicher und ist nur über die
 * authentifizierte API abrufbar.
 */
export const MealPhotoRecord = z.strictObject({
  imageKey: PhotoImageKey,
  /** Zeitpunkt der Analyse auf dem Server, Sekunden nach der Aufnahme. */
  capturedAt: Instant,
  sharedWithPartner: z.boolean(),
  personId: EntityId,
  createdAt: Instant,
  updatedAt: Instant,
});
export type MealPhotoRecord = z.infer<typeof MealPhotoRecord>;

/**
 * Fassung eines Mahlzeitenfotos beim Bildabruf: die Vorschau für Protokoll und „Wir“ oder die
 * vergrößerte Fassung (Spezifikation 0, Abschnitt 5; Spezifikation 2, Abschnitt 9).
 */
export const MealPhotoVariant = z.enum(['vorschau', 'gross']);
export type MealPhotoVariant = z.infer<typeof MealPhotoVariant>;

/**
 * Bildabruf eines **eigenen** Mahlzeitenfotos (Spezifikation 2, Abschnitt 9): online, nur mit Sitzung,
 * nur für die Eigentümerin und nur, solange das Foto nicht gelöscht ist. Die Antwort ist das Bild
 * (`image/jpeg`) und nicht cachebar; die App hält es nur im Speicher. Partnerfotos laufen nie hierüber,
 * sondern über Fotoliste und Handle (`PartnerPhotoRequest`).
 */
export const OwnMealPhotoRequest = z.strictObject({ photoId: EntityId, variant: MealPhotoVariant });
export type OwnMealPhotoRequest = z.infer<typeof OwnMealPhotoRequest>;
