import {
  BaseUnit,
  BlsKey,
  CaptureMethod,
  ConfirmedPhotoEntry,
  ConfirmPhotoDraft,
  DisplayUnit,
  EntryAmount,
  EntryTotals,
  FoodRef,
  FoodRefType,
  MealPhotoAnalysis,
  MealPhotoAnalysisComponent,
  PhotoImageKey,
  MealPhotoRecord,
  MealPhotoUpsert,
  NutritionEntryAddedOutcome,
  NutritionEntryAddedValues,
  NutritionEntryRecord,
  NutritionEntryUpsert,
  NutritionSnapshot,
  OwnFoodOrigin,
  OwnFoodRecord,
  OwnFoodUpsert,
  PhotoAnalysisError,
  PhotoAnalysisErrorCode,
  PhotoAnalysisResult,
  PhotoAnalysisUpload,
  PhotoDraftComponent,
  PhotoMediaType,
  PortionConversion,
  SnapshotSource,
} from '../src/nutrition.ts';
import { fixtures, without } from './define.ts';
import { now, philipp, timeZone, today } from './ids.ts';

const photoDraft = '5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03';

/** Bratkartoffeln, wie das Modell sie schätzt: 180 g mit den Nährwerten genau dieser Menge. */
const estimatedPotatoes = { name: 'Bratkartoffeln', amount: 180, unit: 'g', kcal: 270, proteinG: 4, carbsG: 32, fatG: 13 } as const;
/** Dieselben Bratkartoffeln in Vertragseinheiten. */
const draftPotatoes = { name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 } as const;
const draftJuice = { name: 'Apfelschorle', baseUnit: 'ml', baseAmount: 330, milliKcal: 82_500, proteinMg: 0, carbsMg: 19_800, fatMg: 0 } as const;

const ownFood = '5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e01';
const mealPhoto = '5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e02';

/** Hafer Flocken aus dem BLS 4.0 (C133000), Werte je 100 g. */
const blsSnapshot = {
  name: 'Hafer Flocken',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 348_000,
  proteinMg: 13_220,
  carbsMg: 53_300,
  fatMg: 6_650,
  portions: [],
  source: 'bls',
  attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
} as const;

const ownSnapshot = {
  name: 'Apfel aus dem Garten',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 52_000,
  proteinMg: 300,
  carbsMg: 11_400,
  fatMg: 200,
  portions: [{ unit: 'stueck', label: null, baseAmount: 125_000 }],
  source: 'eigen',
  attribution: null,
} as const;

/** Der Apfel aus dem Garten als eigenes Lebensmittel, ohne Herkunft. */
const ownFoodValues = {
  name: ownSnapshot.name,
  baseUnit: ownSnapshot.baseUnit,
  referenceAmount: ownSnapshot.referenceAmount,
  milliKcal: ownSnapshot.milliKcal,
  proteinMg: ownSnapshot.proteinMg,
  carbsMg: ownSnapshot.carbsMg,
  fatMg: ownSnapshot.fatMg,
  portions: ownSnapshot.portions,
  origin: null,
} as const;

/** Hafer Flocken aus dem BLS, korrigiert um eine Portion von 40 g: ein eigenes Lebensmittel mit Herkunft. */
const correctedOats = {
  name: blsSnapshot.name,
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 372_000,
  proteinMg: 13_500,
  carbsMg: 58_700,
  fatMg: 7_000,
  portions: [{ unit: 'portion', label: '1 Schale', baseAmount: 40_000 }],
  origin: { type: 'bls', key: 'C133000' },
} as const;

const aiSnapshot = {
  name: 'Bratkartoffeln',
  baseUnit: 'g',
  referenceAmount: 180_000,
  milliKcal: 270_000,
  proteinMg: 4_000,
  carbsMg: 32_000,
  fatMg: 13_000,
  portions: [],
  source: 'ki',
  attribution: null,
} as const;

/** 60 g Hafer Flocken zum Frühstück aus der Suche: 348 kcal je 100 g × 0,6 = 208,8 kcal. */
const searchEntry = {
  consumedAt: now,
  localDate: today,
  timeZone,
  utcOffsetMinutes: 120,
  meal: 'fruehstueck',
  captureMethod: 'suche',
  foodRef: { type: 'bls', key: 'C133000' },
  snapshot: blsSnapshot,
  amount: { baseAmount: 60_000, displayUnit: 'g', displayAmountMilli: 60_000 },
  totals: { milliKcal: 208_800, proteinMg: 7_932, carbsMg: 31_980, fatMg: 3_990 },
  mealPhotoId: null,
} as const;

/** Ein halber Apfel aus dem Garten: 62,5 g, Eiweiß 300 mg × 0,625 = 187,5 mg, kaufmännisch 188 mg. */
const halfApple = {
  ...searchEntry,
  meal: 'snacks',
  captureMethod: 'eigenes_lebensmittel',
  foodRef: { type: 'eigen', key: ownFood },
  snapshot: ownSnapshot,
  amount: { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 500 },
  totals: { milliKcal: 32_500, proteinMg: 188, carbsMg: 7_125, fatMg: 125 },
} as const;

/** Ein KI-Bestandteil ohne Referenz in der geschätzten Menge, verknüpft mit seinem Mahlzeitenfoto. */
const photoEntry = {
  ...searchEntry,
  meal: 'abendessen',
  captureMethod: 'foto',
  foodRef: null,
  snapshot: aiSnapshot,
  amount: { baseAmount: 180_000, displayUnit: 'g', displayAmountMilli: 180_000 },
  totals: { milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 },
  mealPhotoId: mealPhoto,
} as const;

const photoMealEntry = '5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e04';
const imageKey = 'q8Vh2mT0bX4nR7cJ1wK9pL3sY6dF5gA2zE8uN0oI4tM';

/** Ein durch ein Suchergebnis ersetzter Bestandteil: Referenz und Snapshot aus dem BLS, die geschätzte Menge. */
const replacedEntry = {
  ...photoEntry,
  foodRef: { type: 'bls', key: 'C133000' },
  snapshot: blsSnapshot,
  amount: { baseAmount: 60_000, displayUnit: 'g', displayAmountMilli: 60_000 },
  totals: searchEntry.totals,
} as const;

const confirmation = {
  draftId: photoDraft,
  photoId: mealPhoto,
  sharedWithPartner: true,
  entries: [
    { id: photoMealEntry, entry: photoEntry },
    { id: '5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e05', entry: replacedEntry },
  ],
} as const;

export const nutritionFixtures = {
  BaseUnit: fixtures(BaseUnit, {
    valid: { 'Gramm': 'g', 'Milliliter': 'ml' },
    invalid: { 'Stück ist keine Basiseinheit': 'stueck', 'Kilogramm': 'kg' },
  }),
  DisplayUnit: fixtures(DisplayUnit, {
    valid: { 'Gramm': 'g', 'Milliliter': 'ml', 'Stück': 'stueck', 'Portion': 'portion' },
    invalid: { 'Großgeschrieben': 'Stück', 'Liter': 'l' },
  }),
  SnapshotSource: fixtures(SnapshotSource, {
    valid: { 'BLS': 'bls', 'Open Food Facts': 'off', 'eigenes Lebensmittel': 'eigen', 'KI-Schätzung': 'ki' },
    invalid: { 'unbekannte Quelle': 'usda' },
  }),
  FoodRefType: fixtures(FoodRefType, {
    valid: { 'BLS': 'bls', 'Open Food Facts': 'off', 'eigenes Lebensmittel': 'eigen' },
    invalid: { 'KI-Schätzung hat keine Referenz': 'ki' },
  }),
  BlsKey: fixtures(BlsKey, {
    valid: { 'Buchstabe und sechs Ziffern': 'C133000', 'mit Buchstaben in der Mitte': 'B6A2100' },
    invalid: { 'sechs Stellen': 'C13300', 'kleingeschrieben': 'c133000', 'Ziffer vorn': '1133000' },
  }),
  FoodRef: fixtures(FoodRef, {
    valid: {
      'BLS-Schlüssel': { type: 'bls', key: 'C133000' },
      'BLS-Schlüssel mit Buchstaben': { type: 'bls', key: 'B6A2100' },
      'EAN-13': { type: 'off', key: '4006040001234' },
      'EAN-8': { type: 'off', key: '40170725' },
      'eigenes Lebensmittel': { type: 'eigen', key: ownFood },
    },
    invalid: {
      'BLS-Schlüssel zu kurz': { type: 'bls', key: 'C13300' },
      'BLS-Schlüssel kleingeschrieben': { type: 'bls', key: 'c133000' },
      'Barcode mit 10 Stellen': { type: 'off', key: '4006040001' },
      'Barcode mit Buchstaben': { type: 'off', key: '400604000123X' },
      'eigenes Lebensmittel ohne UUID': { type: 'eigen', key: 'apfel' },
      'KI hat keine Referenz': { type: 'ki', key: 'C133000' },
    },
  }),
  PortionConversion: fixtures(PortionConversion, {
    valid: {
      'Stück ohne Bezeichnung': { unit: 'stueck', label: null, baseAmount: 125_000 },
      'Portion mit Bezeichnung': { unit: 'portion', label: '1 Becher', baseAmount: 150_000 },
    },
    invalid: {
      'Basiseinheit statt Stück': { unit: 'g', label: null, baseAmount: 1_000 },
      'Menge 0': { unit: 'stueck', label: null, baseAmount: 0 },
      'Bruchteil statt Ganzzahl': { unit: 'stueck', label: null, baseAmount: 12.5 },
      'leere Bezeichnung': { unit: 'portion', label: '', baseAmount: 150_000 },
      'Bezeichnung ohne null': without({ unit: 'portion', label: null, baseAmount: 150_000 }, 'label'),
    },
  }),
  NutritionSnapshot: fixtures(NutritionSnapshot, {
    valid: {
      'BLS je 100 g': blsSnapshot,
      'eigenes Lebensmittel mit Stück': ownSnapshot,
      'Open Food Facts in ml mit Portion': {
        name: 'Hafer Drink',
        baseUnit: 'ml',
        referenceAmount: 100,
        milliKcal: 46_000,
        proteinMg: 300,
        carbsMg: 6_700,
        fatMg: 1_500,
        portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 250 }],
        source: 'off',
        attribution: 'Daten von Open Food Facts (openfoodfacts.org), ODbL',
      },
      'KI-Schätzung für die geschätzte Menge': aiSnapshot,
      'Makros genau so schwer wie die Bezugsmenge': { ...ownSnapshot, proteinMg: 0, carbsMg: 0, fatMg: 100_000 },
    },
    invalid: {
      'negative kcal': { ...ownSnapshot, milliKcal: -1 },
      'kcal als Kommazahl': { ...ownSnapshot, milliKcal: 52_000.5 },
      'Makros schwerer als die Bezugsmenge': { ...ownSnapshot, proteinMg: 1, carbsMg: 0, fatMg: 100_000 },
      'Bezugsmenge 0': { ...ownSnapshot, referenceAmount: 0 },
      'Bezugsmenge über 5 kg': { ...ownSnapshot, referenceAmount: 5_000_001 },
      'zwei Umrechnungen für Stück': {
        ...ownSnapshot,
        portions: [
          { unit: 'stueck', label: null, baseAmount: 125_000 },
          { unit: 'stueck', label: 'groß', baseAmount: 180_000 },
        ],
      },
      'Stück über 5 kg': { ...ownSnapshot, portions: [{ unit: 'stueck', label: null, baseAmount: 5_000_001 }] },
      'BLS ohne Quellenangabe': { ...blsSnapshot, attribution: null },
      'BLS mit Portionsumrechnung': { ...blsSnapshot, portions: [{ unit: 'stueck', label: null, baseAmount: 125_000 }] },
      'BLS in ml': { ...blsSnapshot, baseUnit: 'ml', referenceAmount: 100 },
      'Name mit Leerraum am Rand': { ...ownSnapshot, name: 'Apfel ' },
      'leerer Name': { ...ownSnapshot, name: '' },
      'unvollständig ohne Fett': without(ownSnapshot, 'fatMg'),
    },
  }),
  EntryAmount: fixtures(EntryAmount, {
    valid: {
      '40 g': { baseAmount: 40_000, displayUnit: 'g', displayAmountMilli: 40_000 },
      '0,5 Stück': { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 500 },
      '250 ml': { baseAmount: 250, displayUnit: 'ml', displayAmountMilli: 250_000 },
    },
    invalid: {
      'Menge 0': { baseAmount: 0, displayUnit: 'g', displayAmountMilli: 0 },
      'Anzeigemenge als Kommazahl': { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 0.5 },
      'unbekannte Einheit': { baseAmount: 1_000, displayUnit: 'kg', displayAmountMilli: 1_000 },
    },
  }),
  EntryTotals: fixtures(EntryTotals, {
    valid: {
      '40 g Haferflocken': { milliKcal: 139_200, proteinMg: 5_288, carbsMg: 21_320, fatMg: 2_660 },
      'Wasser ohne Nährwerte': { milliKcal: 0, proteinMg: 0, carbsMg: 0, fatMg: 0 },
    },
    invalid: {
      'negative Summe': { milliKcal: -1, proteinMg: 0, carbsMg: 0, fatMg: 0 },
      'ohne Fett': { milliKcal: 139_200, proteinMg: 5_288, carbsMg: 21_320 },
    },
  }),
  CaptureMethod: fixtures(CaptureMethod, {
    valid: { 'Suche': 'suche', 'Foto': 'foto', 'eigenes Lebensmittel': 'eigenes_lebensmittel' },
    invalid: { 'Großgeschrieben': 'Suche', 'unbekannt': 'sprache' },
  }),
  NutritionEntryUpsert: fixtures(NutritionEntryUpsert, {
    valid: {
      '60 g Hafer Flocken aus der Suche': searchEntry,
      '0,5 Stück eigenes Lebensmittel': halfApple,
      'KI-Bestandteil mit Mahlzeitenfoto': photoEntry,
    },
    invalid: {
      'Snapshot ohne Fett': { ...searchEntry, snapshot: without(blsSnapshot, 'fatMg') },
      'Summen passen nicht zur Menge': { ...searchEntry, totals: { ...searchEntry.totals, milliKcal: 208_801 } },
      'Basismenge passt nicht zur Anzeige': { ...searchEntry, amount: { ...searchEntry.amount, baseAmount: 61_000 } },
      'Stück ohne Umrechnung': { ...searchEntry, amount: { baseAmount: 60_000, displayUnit: 'stueck', displayAmountMilli: 1_000 } },
      'über 5 kg': {
        ...searchEntry,
        amount: { baseAmount: 5_000_001, displayUnit: 'g', displayAmountMilli: 5_000_001 },
        totals: { milliKcal: 17_400_003, proteinMg: 661_000, carbsMg: 2_665_001, fatMg: 332_500 },
      },
      'Summen außerhalb des Ganzzahlbereichs': {
        ...searchEntry,
        snapshot: { ...ownSnapshot, referenceAmount: 1, milliKcal: 9_007_199_254_740_991, proteinMg: 0, carbsMg: 0, fatMg: 0, portions: [] },
        foodRef: { type: 'eigen', key: ownFood },
      },
      'Anzeige außerhalb des Ganzzahlbereichs': {
        ...halfApple,
        amount: { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 9_007_199_254_740_991 },
      },
      'BLS ohne Referenz': { ...searchEntry, foodRef: null },
      'Referenz einer anderen Quelle': { ...searchEntry, foodRef: { type: 'eigen', key: ownFood } },
      'KI-Schätzung mit Referenz': { ...photoEntry, foodRef: { type: 'bls', key: 'C133000' } },
      'KI-Schätzung aus der Suche': { ...photoEntry, captureMethod: 'suche' },
      'unbekannte Mahlzeit': { ...searchEntry, meal: 'brunch' },
      'ohne Offset': without(searchEntry, 'utcOffsetMinutes'),
      'mit Eigentümer': { ...searchEntry, personId: philipp },
    },
  }),
  NutritionEntryRecord: fixtures(NutritionEntryRecord, {
    valid: { 'kanonisch': { ...searchEntry, personId: philipp, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Eigentümer': { ...searchEntry, createdAt: now, updatedAt: now },
      'Summen passen nicht zur Menge': { ...searchEntry, totals: { ...searchEntry.totals, fatMg: 0 }, personId: philipp, createdAt: now, updatedAt: now },
      'mit Serverversion': { ...searchEntry, personId: philipp, createdAt: now, updatedAt: now, serverVersion: '1842' },
    },
  }),
  OwnFoodOrigin: fixtures(OwnFoodOrigin, {
    valid: { 'BLS-Lebensmittel': { type: 'bls', key: 'C133000' }, 'Barcode': { type: 'off', key: '4006040001234' } },
    invalid: { 'eigenes Lebensmittel ist keine Herkunft': { type: 'eigen', key: ownFood }, 'BLS-Schlüssel zu kurz': { type: 'bls', key: 'C13300' } },
  }),
  OwnFoodUpsert: fixtures(OwnFoodUpsert, {
    valid: {
      'neu angelegt mit Stück': ownFoodValues,
      'Korrektur eines BLS-Lebensmittels mit Portion': correctedOats,
      'Getränk in ml, Makros nicht mit der Bezugsmenge vergleichbar': {
        ...ownFoodValues, name: 'Hafer Drink', baseUnit: 'ml', referenceAmount: 100, carbsMg: 6_700, portions: [], origin: { type: 'off', key: '4006040001234' },
      },
    },
    invalid: {
      'negative kcal': { ...ownFoodValues, milliKcal: -1 },
      'negatives Fett': { ...ownFoodValues, fatMg: -1 },
      'Makros schwerer als die Bezugsmenge': { ...ownFoodValues, proteinMg: 1, carbsMg: 0, fatMg: 100_000 },
      'mit Quelle wie ein Snapshot': { ...ownFoodValues, source: 'eigen' },
      'eigenes Lebensmittel als Herkunft': { ...ownFoodValues, origin: { type: 'eigen', key: ownFood } },
      'ohne Herkunft statt null': without(ownFoodValues, 'origin'),
      'mit Eigentümer': { ...ownFoodValues, personId: philipp },
    },
  }),
  OwnFoodRecord: fixtures(OwnFoodRecord, {
    valid: { 'kanonisch': { ...correctedOats, personId: philipp, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Eigentümer': { ...correctedOats, createdAt: now, updatedAt: now },
      'Makros schwerer als die Bezugsmenge': { ...correctedOats, proteinMg: 100_000, personId: philipp, createdAt: now, updatedAt: now },
    },
  }),
  NutritionEntryAddedValues: fixtures(NutritionEntryAddedValues, {
    valid: { 'Frühstück': { meal: 'fruehstueck', kcal: 209 }, 'Wasser ohne kcal': { meal: 'snacks', kcal: 0 } },
    invalid: { 'ohne Mahlzeit': { kcal: 209 }, 'kcal als Kommazahl': { meal: 'fruehstueck', kcal: 208.8 }, 'mit Name': { meal: 'fruehstueck', kcal: 209, name: 'Hafer Flocken' } },
  }),
  NutritionEntryAddedOutcome: fixtures(NutritionEntryAddedOutcome, {
    valid: { 'zum Frühstück': { messageKey: 'ernaehrung.eintrag_hinzugefuegt', values: { meal: 'fruehstueck', kcal: 209 }, undoToken: 'undo-7f3a' } },
    invalid: {
      'ohne Rückgängig': { messageKey: 'ernaehrung.eintrag_hinzugefuegt', values: { meal: 'fruehstueck', kcal: 209 } },
      'fremde Meldung': { messageKey: 'wasser.hinzugefuegt', values: { meal: 'fruehstueck', kcal: 209 }, undoToken: 'undo-7f3a' },
    },
  }),
  PhotoMediaType: fixtures(PhotoMediaType, {
    valid: { 'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WebP': 'image/webp' },
    invalid: { 'GIF nimmt der Server nicht an': 'image/gif', 'HEIC': 'image/heic' },
  }),
  PhotoAnalysisUpload: fixtures(PhotoAnalysisUpload, {
    valid: { 'JPEG der App': { mediaType: 'image/jpeg', byteSize: 412_345 }, 'genau 8 MB': { mediaType: 'image/webp', byteSize: 8_000_000 } },
    invalid: {
      'über 8 MB': { mediaType: 'image/jpeg', byteSize: 8_000_001 },
      'leere Datei': { mediaType: 'image/png', byteSize: 0 },
      'unbekanntes Format': { mediaType: 'application/pdf', byteSize: 1_000 },
    },
  }),
  MealPhotoAnalysisComponent: fixtures(MealPhotoAnalysisComponent, {
    valid: { 'Bratkartoffeln in g': estimatedPotatoes, 'Getränk in ml': { ...estimatedPotatoes, name: 'Apfelschorle', amount: 330, unit: 'ml', kcal: 82.5, proteinG: 0, carbsG: 19.8, fatG: 0 } },
    invalid: {
      'Menge 0': { ...estimatedPotatoes, amount: 0 },
      'über 5 kg': { ...estimatedPotatoes, amount: 5_001 },
      'Makros über der Menge': { ...estimatedPotatoes, carbsG: 170 },
      'negative kcal': { ...estimatedPotatoes, kcal: -5 },
      'Stück als Einheit': { ...estimatedPotatoes, unit: 'stueck' },
      'mit Konfidenz': { ...estimatedPotatoes, confidence: 0.8 },
    },
  }),
  MealPhotoAnalysis: fixtures(MealPhotoAnalysis, {
    valid: { 'ein Bestandteil': { components: [estimatedPotatoes] }, 'kein Essen erkannt': { components: [] } },
    invalid: {
      '16 Bestandteile': { components: Array.from({ length: 16 }, () => estimatedPotatoes) },
      'ohne Liste': {},
      'Bestandteil ohne Menge': { components: [without(estimatedPotatoes, 'amount')] },
    },
  }),
  PhotoDraftComponent: fixtures(PhotoDraftComponent, {
    valid: { 'Bratkartoffeln': draftPotatoes, 'Apfelschorle': draftJuice },
    invalid: {
      'Menge in Gramm statt mg': { ...draftPotatoes, baseAmount: 180.5 },
      'Makros über der Menge': { ...draftPotatoes, carbsMg: 170_000 },
      'über 5 l': { ...draftJuice, baseAmount: 5_001 },
      'Leerraum im Namen': { ...draftPotatoes, name: ' Bratkartoffeln' },
    },
  }),
  PhotoAnalysisResult: fixtures(PhotoAnalysisResult, {
    valid: { 'zwei Bestandteile': { draftId: photoDraft, expiresAt: '2026-10-15T12:00:00.000Z', components: [draftPotatoes, draftJuice] } },
    invalid: {
      'ohne Bestandteile': { draftId: photoDraft, expiresAt: '2026-10-15T12:00:00.000Z', components: [] },
      'ohne Ablauf': { draftId: photoDraft, components: [draftPotatoes] },
      'mit Bildschlüssel': { draftId: photoDraft, expiresAt: '2026-10-15T12:00:00.000Z', components: [draftPotatoes], imageKey: 'abc' },
    },
  }),
  PhotoAnalysisErrorCode: fixtures(PhotoAnalysisErrorCode, {
    valid: { 'kein Bild': 'photo_invalid_image', 'kein Essen': 'photo_no_food_detected', 'Limit': 'photo_analysis_limit_reached' },
    invalid: { 'Ablauf gehört zum Bestätigen': 'photo_draft_expired', 'allgemeiner Fehler': 'forbidden' },
  }),
  ConfirmedPhotoEntry: fixtures(ConfirmedPhotoEntry, {
    valid: { 'KI-Bestandteil': { id: photoMealEntry, entry: photoEntry } },
    invalid: { 'ohne ID': { entry: photoEntry }, 'ungültiger Eintrag': { id: photoMealEntry, entry: { ...photoEntry, captureMethod: 'suche' } } },
  }),
  ConfirmPhotoDraft: fixtures(ConfirmPhotoDraft, {
    valid: {
      'KI-Bestandteil und ersetzter Bestandteil, geteilt': confirmation,
      'vom Teilen ausgenommen': { ...confirmation, sharedWithPartner: false },
    },
    invalid: {
      'ohne Einträge': { ...confirmation, entries: [] },
      '31 Einträge': {
        ...confirmation,
        entries: Array.from({ length: 31 }, (_, index) => ({ id: `5c7e9a1b-3d5f-4a7c-9e1b-${String(index).padStart(12, '0')}`, entry: photoEntry })),
      },
      'doppelte Eintrags-ID': { ...confirmation, entries: [confirmation.entries[0], { ...confirmation.entries[1], id: photoMealEntry }] },
      'Eintrag aus der Suche': { ...confirmation, entries: [{ id: photoMealEntry, entry: { ...searchEntry, mealPhotoId: mealPhoto } }] },
      'Eintrag ohne Fotoverweis': { ...confirmation, entries: [{ id: photoMealEntry, entry: { ...photoEntry, mealPhotoId: null } }] },
      'Eintrag mit anderem Foto': { ...confirmation, photoId: photoDraft },
      'zwei Mahlzeiten': { ...confirmation, entries: [confirmation.entries[0], { ...confirmation.entries[1], entry: { ...replacedEntry, meal: 'snacks' } }] },
      'zwei Tage': { ...confirmation, entries: [confirmation.entries[0], { ...confirmation.entries[1], entry: { ...replacedEntry, localDate: '2026-10-13' } }] },
      'mit Eigentümer': { ...confirmation, personId: philipp },
    },
  }),
  PhotoImageKey: fixtures(PhotoImageKey, {
    valid: { '32 Zufallsbytes in base64url': imageKey },
    invalid: { 'Pfad': 'seed/foto.jpg', 'zu kurz': imageKey.slice(1), 'Pfadtrenner': `${imageKey.slice(0, 42)}/` },
  }),
  MealPhotoUpsert: fixtures(MealPhotoUpsert, {
    valid: { 'vom Teilen ausgenommen': { sharedWithPartner: false } },
    invalid: {
      'mit Bildschlüssel (generisches Create)': { sharedWithPartner: true, imageKey },
      'mit Aufnahmezeit': { sharedWithPartner: true, capturedAt: now },
      'ohne Schalter': {},
    },
  }),
  MealPhotoRecord: fixtures(MealPhotoRecord, {
    valid: { 'kanonisch': { imageKey, capturedAt: now, sharedWithPartner: true, personId: philipp, createdAt: now, updatedAt: now } },
    invalid: {
      'ohne Eigentümer': { imageKey, capturedAt: now, sharedWithPartner: true, createdAt: now, updatedAt: now },
      'Bildschlüssel als Pfad': { imageKey: 'fotos/a.jpg', capturedAt: now, sharedWithPartner: true, personId: philipp, createdAt: now, updatedAt: now },
    },
  }),
  PhotoAnalysisError: fixtures(PhotoAnalysisError, {
    valid: {
      'Anbieter nicht erreichbar': { code: 'photo_analysis_unavailable', retryable: true },
      'Modellfehler': { code: 'photo_analysis_failed', retryable: false },
    },
    invalid: {
      'Limit als wiederholbar': { code: 'photo_analysis_limit_reached', retryable: true },
      'nicht erreichbar, aber nicht wiederholbar': { code: 'photo_analysis_unavailable', retryable: false },
      'mit Kontext': { code: 'photo_analysis_failed', retryable: false, context: { stopReason: 'refusal' } },
    },
  }),
};
