import type { LocalDate } from './base.ts';
import type { PersonUpsert } from './person.ts';
import type { EffectivePlan, MaintenanceReason } from './ports.ts';

// Zielrechner (Spezifikation 1, Abschnitt 3): eine reine Funktion für App und Server. Die App zeigt
// damit Vorschau, Ergebnis und Neuberechnung, der Server prüft damit die Stimmigkeit einer Zielversion.
// Grenzen und Rundungen ohne Quelle sind Designwerte der Spezifikation.

type CalculationSex = NonNullable<PersonUpsert['calculationSex']>;
type ActivityLevel = NonNullable<PersonUpsert['activityLevel']>;
type Pace = NonNullable<Extract<EffectivePlan, { type: 'gueltig' }>['goal']['pace']>;

/** Eingaben des Zielrechners; Gewichte in g, Größe in cm (Spezifikation 0, Abschnitt 8). */
export type GoalCalculatorInput = {
  calculationDate: LocalDate;
  calculationSex: CalculationSex;
  birthDate: LocalDate;
  heightCm: number;
  weightG: number;
  weightTrendG: number | null;
  activityLevel: ActivityLevel;
  pregnantOrBreastfeeding: boolean;
  knownEatingDisorder: boolean;
  goalWeightG: number | null;
  pace: Pace | null;
  manualBudgetKcal: number | null;
  waterTargetMl: number | null;
  weeklySportTargetMinutes: number | null;
};

/** Kalorienwert, gerundet auf ganze kcal: für Anzeige und Snapshots in kcal, für die Speicherung in `milli_kcal`. */
export type KcalAmount = { kcal: number; milliKcal: number };

/** Erlaubter Bereich einer Eingabe samt Raster, einschließlich beider Grenzen. */
export type StepRange = { min: number; max: number; step: number };

/** Anlass des erzwungenen Haltemodus aus dem Sicherheits-Check. */
export type SafetyTrigger = 'schwanger_oder_stillend' | 'essstoerung' | 'untergewicht';

export type GoalWeight = {
  /** Eingegebenes Zielgewicht, sonst die Vorauswahl. */
  goalWeightG: number;
  preselectedG: number;
  /** 5–10 % unter dem aktuellen Gewicht, beschnitten an der Untergrenze; `null`, wenn davon nichts übrig bleibt. */
  suggestion: { fromG: number; toG: number } | null;
  /** Untergrenze ist das Gewicht bei BMI 18,5, auf 0,1 kg aufgerundet. */
  range: StepRange;
};

export type GoalCalculation = {
  type: 'berechnet';
  ageYears: number;
  /** BMI aus aktuellem Gewicht und Größe, ungerundet. */
  bmi: number;
  /** Leer, solange der Sicherheits-Check den Haltemodus nicht erzwingt. */
  safetyTriggers: SafetyTrigger[];
  maintenanceReason: MaintenanceReason | null;
  /** Gewähltes Tempo; im Haltemodus `null`. */
  pace: Pace | null;
  /** Faktor der Aktivitätsstufe (PAL) für die Herleitung. */
  activityFactor: number;
  basalMetabolicRate: KcalAmount;
  totalEnergyExpenditure: KcalAmount;
  deficit: KcalAmount | null;
  lowerBound: KcalAmount;
  calorieBudget: KcalAmount;
  budgetSource: 'berechnet' | 'manuell';
  /** Die Rechnung lag unter der Untergrenze; dazu gehört der Hinweis `budget_raised_to_lower_bound`. */
  budgetRaisedToLowerBound: boolean;
  goalWeight: GoalWeight;
  hints: GoalHintKey[];
};

/**
 * Hinweise, die die Oberfläche zur Berechnung anzeigt; den Text erzeugt die App aus dem Schlüssel.
 * - `maintenance_forced`: Der Sicherheits-Check erzwingt den Haltemodus, mit Hinweis auf ärztliche Begleitung.
 * - `goal_weight_not_below_current`: Das Zielgewicht liegt nicht unter dem aktuellen Gewicht, daher Haltemodus.
 * - `budget_raised_to_lower_bound`: Das Budget wurde auf die Untergrenze angehoben, mit Verweis auf ärztliche Begleitung.
 */
export type GoalHintKey = 'maintenance_forced' | 'goal_weight_not_below_current' | 'budget_raised_to_lower_bound';

/** Verletzte Eingabegrenze: Wert außerhalb des Bereichs oder nicht im Raster der Eingabe. */
export type GoalInputError =
  | 'height_out_of_range'
  | 'height_not_on_step'
  | 'weight_out_of_range'
  | 'weight_not_on_step'
  | 'underage'
  | 'goal_weight_below_lower_limit'
  | 'goal_weight_out_of_range'
  | 'goal_weight_not_on_step';

/** Ergebnis des Zielrechners; Verstöße gegen die Eingabegrenzen sind Fehlerschlüssel, keine Ausnahmen. */
export type GoalCalculatorResult = GoalCalculation | { type: 'ungueltig'; errors: GoalInputError[] };

// Kalorien rechnet der Rechner exakt als Ganzzahl in 1/4000 kcal: 6,25 × cm ist ein Vielfaches von
// 1/4 kcal, 10 × kg bei ganzen Gramm eines von 1/100 kcal, und die Aktivitätsstufe multipliziert mit
// Zehnteln. Erst die Ausgabe rundet, sodass App und Server dieselben Werte erhalten und kein
// Gleitkomma-Rest eine Rundung auf ,5 kippt.
const UNITS_PER_KCAL = 4_000;
const kcalUnits = (kcal: number) => kcal * UNITS_PER_KCAL;

/** Aktivitätsstufe als PAL in Zehnteln (DGE: 1,4 / 1,6 / 1,8). */
const palTenths: Record<ActivityLevel, number> = { wenig_aktiv: 14, maessig_aktiv: 16, aktiv: 18 };

const deficitKcal: Record<Pace, number> = { entspannt: 500, zuegiger: 750 };

const minimumBudgetKcal = 1_200;

/** Kaufmännisch auf ganze kcal gerundet. */
function amount(units: number): KcalAmount {
  const kcal = Math.floor((units + UNITS_PER_KCAL / 2) / UNITS_PER_KCAL);
  return { kcal, milliKcal: kcal * 1_000 };
}

/** Kaufmännisch auf 10 kcal gerundet, in Einheiten. */
const roundToTen = (units: number) => Math.floor((units + kcalUnits(5)) / kcalUnits(10)) * kcalUnits(10);

/** Das kleinste Vielfache von 10 kcal, das nicht unter dem Wert liegt, in Einheiten. */
const ceilToTen = (units: number) => Math.ceil(units / kcalUnits(10)) * kcalUnits(10);

/**
 * Volle Jahre am Tag `onDate`: Der Geburtstag selbst zählt schon. Wer am 29. Februar geboren ist, wird
 * in Nichtschaltjahren am 1. März ein Jahr älter (Designwert).
 */
function ageInFullYears(birthDate: LocalDate, onDate: LocalDate): number {
  const years = Number(onDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return onDate.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

/** Eingabegrenzen (Designwerte): Bereich und Raster je Eingabe. */
const limits = {
  heightCm: { min: 120, max: 230, step: 1 },
  weightG: { min: 30_000, max: 300_000, step: 100 },
} as const satisfies Record<string, StepRange>;

const minimumAgeYears = 18;

function checkLimit<E extends GoalInputError>(value: number, limit: StepRange, outOfRange: E, notOnStep: E): E[] {
  if (value < limit.min || value > limit.max) return [outOfRange];
  return Number.isInteger(value / limit.step) ? [] : [notOnStep];
}

/**
 * Zielgewicht samt Vorschlag. Die Grenzen sind ganzzahlig gerechnet: Bei BMI 18,5 wiegt man
 * 18,5 × (cm / 100)² kg = 185 × cm² / 100 g. Der Vorschlag rundet auf 0,1 kg nach innen, damit er
 * im Bereich 5–10 % bleibt (Designwert); nach oben begrenzt die Gewichtseingabe.
 */
function goalWeightOf(input: GoalCalculatorInput): GoalWeight {
  const step = limits.weightG.step;
  const lowerLimitG = Math.ceil((185 * input.heightCm ** 2) / (100 * step)) * step;
  const fiveG = Math.floor((input.weightG * 95) / (100 * step)) * step;
  const tenG = Math.ceil((input.weightG * 90) / (100 * step)) * step;
  const suggestion = fiveG < lowerLimitG ? null : { fromG: Math.max(tenG, lowerLimitG), toG: fiveG };
  const preselectedG = suggestion?.toG ?? lowerLimitG;
  return {
    goalWeightG: input.goalWeightG ?? preselectedG,
    preselectedG,
    suggestion,
    range: { min: lowerLimitG, max: limits.weightG.max, step },
  };
}

function goalWeightErrors({ goalWeightG, range }: GoalWeight): GoalInputError[] {
  if (goalWeightG < range.min) return ['goal_weight_below_lower_limit'];
  return checkLimit(goalWeightG, range, 'goal_weight_out_of_range', 'goal_weight_not_on_step');
}

export function calculateGoals(input: GoalCalculatorInput): GoalCalculatorResult {
  const ageYears = ageInFullYears(input.birthDate, input.calculationDate);
  const bodyErrors: GoalInputError[] = [
    ...checkLimit(input.heightCm, limits.heightCm, 'height_out_of_range', 'height_not_on_step'),
    ...checkLimit(input.weightG, limits.weightG, 'weight_out_of_range', 'weight_not_on_step'),
    ...(ageYears < minimumAgeYears ? ['underage' as const] : []),
  ];
  if (bodyErrors.length > 0) return { type: 'ungueltig', errors: bodyErrors };

  const goalWeight = goalWeightOf(input);
  const errors = goalWeightErrors(goalWeight);
  if (errors.length > 0) return { type: 'ungueltig', errors };

  // BMI < 18,5 ⟺ 10 × g / cm² < 18,5 ⟺ 100 × g < 185 × cm², ganzzahlig und ohne Rundungsfehler.
  const safetyTriggers: SafetyTrigger[] = [];
  if (input.pregnantOrBreastfeeding) safetyTriggers.push('schwanger_oder_stillend');
  if (input.knownEatingDisorder) safetyTriggers.push('essstoerung');
  if (input.weightG * 100 < 185 * input.heightCm ** 2) safetyTriggers.push('untergewicht');

  const goalNotBelowCurrent = goalWeight.goalWeightG >= input.weightG;
  const maintenanceReason: MaintenanceReason | null =
    safetyTriggers.length > 0 ? 'sicherheits_check' : input.pace === null || goalNotBelowCurrent ? 'gewaehlt' : null;
  const pace = maintenanceReason === null ? input.pace : null;

  // Mifflin-St Jeor: 10 × kg + 6,25 × cm − 5 × Alter + 5 bzw. − 161, hier mal 4000.
  const basal =
    input.weightG * 40 + input.heightCm * 25_000 - ageYears * 20_000 + kcalUnits(input.calculationSex === 'maennlich' ? 5 : -161);
  const total = (basal * palTenths[input.activityLevel]) / 10;
  const lowerBound = Math.max(kcalUnits(minimumBudgetKcal), basal);
  const deficit = pace === null ? null : kcalUnits(deficitKcal[pace]);

  const raw = deficit === null ? total : total - deficit;
  const raised = raw < lowerBound;
  const rounded = roundToTen(Math.max(raw, lowerBound));
  const budget = rounded < lowerBound ? ceilToTen(lowerBound) : rounded;

  const hints: GoalHintKey[] = [];
  if (maintenanceReason === 'sicherheits_check') hints.push('maintenance_forced');
  else if (input.pace !== null && goalNotBelowCurrent) hints.push('goal_weight_not_below_current');
  if (raised) hints.push('budget_raised_to_lower_bound');

  return {
    type: 'berechnet',
    ageYears,
    bmi: (input.weightG * 10) / input.heightCm ** 2,
    safetyTriggers,
    maintenanceReason,
    pace,
    activityFactor: palTenths[input.activityLevel] / 10,
    basalMetabolicRate: amount(basal),
    totalEnergyExpenditure: amount(total),
    deficit: deficit === null ? null : amount(deficit),
    lowerBound: amount(lowerBound),
    calorieBudget: amount(budget),
    budgetSource: 'berechnet',
    budgetRaisedToLowerBound: raised,
    goalWeight,
    hints,
  };
}
