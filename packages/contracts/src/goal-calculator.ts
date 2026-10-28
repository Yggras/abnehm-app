import type { LocalDate } from './base.ts';
import { addDays } from './calendar.ts';
import type { PersonUpsert } from './person.ts';
import type { EffectivePlan, MaintenanceReason } from './ports.ts';

// Zielrechner (Spezifikation 1, Abschnitt 3): reine Funktionen für App und Server. Die App zeigt
// damit Vorschau, Ergebnis und Neuberechnung, der Server prüft damit die Stimmigkeit einer Zielversion.
// Quellen der Zahlen stehen in der Spezifikation; Werte ohne Quelle sind dort als Designwert markiert.

type CalculationSex = NonNullable<PersonUpsert['calculationSex']>;
type ActivityLevel = NonNullable<PersonUpsert['activityLevel']>;
type Pace = NonNullable<Extract<EffectivePlan, { type: 'gueltig' }>['goal']['pace']>;

/** Eingaben des Zielrechners; Gewichte in g, Größe in cm (Spezifikation 0, Abschnitt 8). */
export type GoalCalculatorInput = {
  /** Tag, an dem gerechnet wird: Alter und Prognose beziehen sich darauf. */
  calculationDate: LocalDate;
  calculationSex: CalculationSex;
  birthDate: LocalDate;
  heightCm: number;
  /** Aktuelles Gewicht: im Onboarding die Eingabe, sonst das letzte Tagesgewicht. */
  weightG: number;
  /** Gewichtstrend, sobald es einen gibt; Basisgewicht der Prognose. */
  weightTrendG: number | null;
  activityLevel: ActivityLevel;
  pregnantOrBreastfeeding: boolean;
  knownEatingDisorder: boolean;
  /** `null` übernimmt die Vorauswahl. */
  goalWeightG: number | null;
  /** `null` wählt den Haltemodus. */
  pace: Pace | null;
  /** `null` übernimmt das berechnete Budget. */
  manualBudgetKcal: number | null;
  /** `null` übernimmt den Vorschlag. */
  waterTargetMl: number | null;
  /** `null` übernimmt den Vorschlag. */
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

/**
 * Geschätzter Zeitpunkt des Zielgewichts: Wochen = (Basisgewicht − Zielgewicht) ÷ Abnahme je Woche
 * des Tempos, ab dem Berechnungstag. Angebrochene Tage zählen als ganzer Tag (Designwert).
 */
export type GoalForecast = {
  type: 'schaetzung';
  weeks: number;
  year: number;
  month: number;
  hintKey: 'weight_loss_slows_after_three_months';
};

/** Vollständige Berechnung mit allen Zwischenwerten, wie sie die Oberfläche anzeigt. */
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
  /** Defizit des Tempos; im Haltemodus `null`. */
  deficit: KcalAmount | null;
  lowerBound: KcalAmount;
  calorieBudget: KcalAmount;
  budgetSource: 'berechnet' | 'manuell';
  /** Die Rechnung lag unter der Untergrenze; dazu gehört der Hinweis `budget_raised_to_lower_bound`. */
  budgetRaisedToLowerBound: boolean;
  /**
   * Erlaubtes manuelles Budget in kcal: vom auf die Untergrenze angehobenen Budget bis zum Budget im
   * Haltemodus. Im erzwungenen Haltemodus gibt es keines.
   */
  manualBudgetRange: StepRange | null;
  goalWeight: GoalWeight;
  /** Nur mit Defizit; die Oberfläche zeigt Monat und Jahr als „etwa …“. */
  forecast: GoalForecast | null;
  water: { targetMl: number; suggestedMl: number; range: StepRange; hintKey: 'water_need_higher_in_heat_and_sport' };
  sport: { weeklyTargetMinutes: number; suggestedMinutes: number; range: StepRange };
  /** Hinweise, die nur in bestimmten Lagen erscheinen, in der Reihenfolge des Onboardings. */
  hints: ('maintenance_forced' | 'goal_weight_not_below_current' | 'budget_raised_to_lower_bound')[];
};

/**
 * Hinweise zur Berechnung; den Text erzeugt die App aus dem Schlüssel.
 * - `maintenance_forced`: Der Sicherheits-Check erzwingt den Haltemodus, mit Hinweis auf ärztliche Begleitung.
 * - `goal_weight_not_below_current`: Das Zielgewicht liegt nicht unter dem aktuellen Gewicht, daher Haltemodus.
 * - `budget_raised_to_lower_bound`: Das Budget wurde auf die Untergrenze angehoben, mit Verweis auf ärztliche Begleitung.
 * - `weight_loss_slows_after_three_months`: zur Prognose; die Abnahme verlangsamt sich nach etwa drei Monaten.
 * - `water_need_higher_in_heat_and_sport`: zum Wasserziel; bei Hitze und Sport braucht man mehr.
 */
export type GoalHintKey =
  | GoalCalculation['hints'][number]
  | GoalForecast['hintKey']
  | GoalCalculation['water']['hintKey'];

/** Verletzte Eingabegrenze: Wert außerhalb des Bereichs oder nicht im Raster der Eingabe. */
export type GoalInputError =
  | 'height_out_of_range'
  | 'height_not_on_step'
  | 'weight_out_of_range'
  | 'weight_not_on_step'
  | 'underage'
  | 'goal_weight_below_lower_limit'
  | 'goal_weight_out_of_range'
  | 'goal_weight_not_on_step'
  | 'manual_budget_out_of_range'
  | 'manual_budget_not_on_step'
  | 'manual_budget_in_forced_maintenance'
  | 'water_target_out_of_range'
  | 'water_target_not_on_step'
  | 'sport_target_out_of_range'
  | 'sport_target_not_on_step';

/** Ergebnis des Zielrechners; Verstöße gegen die Eingabegrenzen sind Fehlerschlüssel, keine Ausnahmen. */
export type GoalCalculatorResult = GoalCalculation | { type: 'ungueltig'; errors: GoalInputError[] };

/** Körperdaten samt Alter, wie sie eine Zielversion als Berechnungswerte speichert. */
export type CalorieNeedsInput = Pick<GoalCalculatorInput, 'calculationSex' | 'heightCm' | 'weightG' | 'activityLevel'> & {
  ageYears: number;
};

export type CalorieNeeds = Pick<GoalCalculation, 'basalMetabolicRate' | 'totalEnergyExpenditure' | 'lowerBound'>;

// Kalorien rechnet der Rechner exakt als Ganzzahl in 1/4000 kcal: 6,25 × cm ist ein Vielfaches von
// 1/4 kcal, 10 × kg bei ganzen Gramm eines von 1/100 kcal, und die Aktivitätsstufe multipliziert mit
// Zehnteln. Erst die Ausgabe rundet, sodass App und Server dieselben Werte erhalten und kein
// Gleitkomma-Rest eine Rundung auf ,5 kippt.
const UNITS_PER_KCAL = 4_000;
const kcalUnits = (kcal: number) => kcal * UNITS_PER_KCAL;

/** Aktivitätsstufe als PAL in Zehnteln (DGE: 1,4 / 1,6 / 1,8). */
const palTenths: Record<ActivityLevel, number> = { wenig_aktiv: 14, maessig_aktiv: 16, aktiv: 18 };

/** Defizit je Tempo: S3-Leitlinie Adipositas 2024 (Empf. 5.11) bzw. AHA/ACC/TOS 2013. */
const deficitKcal: Record<Pace, number> = { entspannt: 500, zuegiger: 750 };

/** Erwartete Abnahme je Woche und Tempo in g (#14). */
const weeklyLossG: Record<Pace, number> = { entspannt: 500, zuegiger: 750 };

/** Feste Untergrenze des Kalorienbudgets (#14); höher ist sie, wenn der Grundumsatz darüber liegt. */
const minimumBudgetKcal = 1_200;

/** Eingabegrenzen (Designwerte): Bereich und Raster je Eingabe. */
const limits = {
  heightCm: { min: 120, max: 230, step: 1 },
  weightG: { min: 30_000, max: 300_000, step: 100 },
  waterTargetMl: { min: 500, max: 5_000, step: 250 },
  weeklySportTargetMinutes: { min: 30, max: 600, step: 10 },
} as const satisfies Record<string, StepRange>;

const minimumAgeYears = 18;

/** Gerundete DGE-Richtwerte für Getränke; 18-Jährige erhalten ebenfalls 1.500 ml (Designwert). */
const suggestedWaterMl = (ageYears: number) => (ageYears <= 50 ? 1_500 : 1_250);

/** Wöchentliche aktive Minuten nach WHO 2020. */
const suggestedSportMinutes = 150;

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

function checkLimit<E extends GoalInputError>(value: number, limit: StepRange, outOfRange: E, notOnStep: E): E[] {
  if (value < limit.min || value > limit.max) return [outOfRange];
  return Number.isInteger(value / limit.step) ? [] : [notOnStep];
}

/** Mifflin-St Jeor (1990): 10 × kg + 6,25 × cm − 5 × Alter + 5 bzw. − 161, hier mal 4000. */
function needsInUnits(body: CalorieNeedsInput) {
  const sexTerm = kcalUnits(body.calculationSex === 'maennlich' ? 5 : -161);
  const basal = body.weightG * 40 + body.heightCm * 25_000 - body.ageYears * 20_000 + sexTerm;
  const total = (basal * palTenths[body.activityLevel]) / 10;
  return { basal, total, lowerBound: Math.max(kcalUnits(minimumBudgetKcal), basal) };
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

function manualBudgetErrors(manualBudgetKcal: number | null, range: StepRange | null): GoalInputError[] {
  if (manualBudgetKcal === null) return [];
  if (range === null) return ['manual_budget_in_forced_maintenance'];
  return checkLimit(manualBudgetKcal, range, 'manual_budget_out_of_range', 'manual_budget_not_on_step');
}

/** Basisgewicht ist der Gewichtstrend, sonst das aktuelle Gewicht. */
function forecastOf(input: GoalCalculatorInput, goalWeightG: number, pace: Pace): GoalForecast {
  const lossG = Math.max(0, (input.weightTrendG ?? input.weightG) - goalWeightG);
  const estimate = addDays(input.calculationDate, Math.ceil((lossG * 7) / weeklyLossG[pace]));
  return {
    type: 'schaetzung',
    weeks: lossG / weeklyLossG[pace],
    year: Number(estimate.slice(0, 4)),
    month: Number(estimate.slice(5, 7)),
    hintKey: 'weight_loss_slows_after_three_months',
  };
}

/**
 * Berechnet Kalorienbudget, Haltemodus, Zielgewicht, Prognose, Wasser- und Sportziel aus den Eingaben.
 * Erst werden Körperdaten und Alter geprüft, danach die Ziele gegen die daraus folgenden Grenzen.
 */
export function calculateGoals(input: GoalCalculatorInput): GoalCalculatorResult {
  const ageYears = ageInFullYears(input.birthDate, input.calculationDate);
  const bodyErrors: GoalInputError[] = [
    ...checkLimit(input.heightCm, limits.heightCm, 'height_out_of_range', 'height_not_on_step'),
    ...checkLimit(input.weightG, limits.weightG, 'weight_out_of_range', 'weight_not_on_step'),
    ...(ageYears < minimumAgeYears ? ['underage' as const] : []),
  ];
  if (bodyErrors.length > 0) return { type: 'ungueltig', errors: bodyErrors };

  const goalWeight = goalWeightOf(input);

  // BMI < 18,5 ⟺ 10 × g / cm² < 18,5 ⟺ 100 × g < 185 × cm², ganzzahlig und ohne Rundungsfehler.
  const safetyTriggers: SafetyTrigger[] = [];
  if (input.pregnantOrBreastfeeding) safetyTriggers.push('schwanger_oder_stillend');
  if (input.knownEatingDisorder) safetyTriggers.push('essstoerung');
  if (input.weightG * 100 < 185 * input.heightCm ** 2) safetyTriggers.push('untergewicht');

  const goalNotBelowCurrent = goalWeight.goalWeightG >= input.weightG;
  const maintenanceReason: MaintenanceReason | null =
    safetyTriggers.length > 0 ? 'sicherheits_check' : input.pace === null || goalNotBelowCurrent ? 'gewaehlt' : null;
  const pace = maintenanceReason === null ? input.pace : null;

  const { basal, total, lowerBound } = needsInUnits({ ...input, ageYears });
  const deficit = pace === null ? null : kcalUnits(deficitKcal[pace]);
  const raw = deficit === null ? total : total - deficit;

  // Das Budget wird auf 10 kcal gerundet; läge es danach unter der Untergrenze, gilt das nächste
  // Vielfache von 10 darüber.
  const budgetFrom = (units: number) => {
    const rounded = roundToTen(Math.max(units, lowerBound));
    return rounded < lowerBound ? ceilToTen(lowerBound) : rounded;
  };
  const manualBudgetRange =
    maintenanceReason === 'sicherheits_check'
      ? null
      : { min: budgetFrom(lowerBound) / UNITS_PER_KCAL, max: budgetFrom(total) / UNITS_PER_KCAL, step: 10 };

  const water = { targetMl: input.waterTargetMl ?? suggestedWaterMl(ageYears), suggestedMl: suggestedWaterMl(ageYears) };
  const sport = {
    weeklyTargetMinutes: input.weeklySportTargetMinutes ?? suggestedSportMinutes,
    suggestedMinutes: suggestedSportMinutes,
  };

  const errors: GoalInputError[] = [
    ...goalWeightErrors(goalWeight),
    ...manualBudgetErrors(input.manualBudgetKcal, manualBudgetRange),
    ...checkLimit(water.targetMl, limits.waterTargetMl, 'water_target_out_of_range', 'water_target_not_on_step'),
    ...checkLimit(
      sport.weeklyTargetMinutes,
      limits.weeklySportTargetMinutes,
      'sport_target_out_of_range',
      'sport_target_not_on_step',
    ),
  ];
  if (errors.length > 0) return { type: 'ungueltig', errors };

  const raised = input.manualBudgetKcal === null && raw < lowerBound;
  const hints: GoalCalculation['hints'] = [];
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
    calorieBudget: amount(input.manualBudgetKcal === null ? budgetFrom(raw) : kcalUnits(input.manualBudgetKcal)),
    budgetSource: input.manualBudgetKcal === null ? 'berechnet' : 'manuell',
    budgetRaisedToLowerBound: raised,
    manualBudgetRange,
    goalWeight,
    forecast: pace === null ? null : forecastOf(input, goalWeight.goalWeightG, pace),
    water: { ...water, range: { ...limits.waterTargetMl }, hintKey: 'water_need_higher_in_heat_and_sport' },
    sport: { ...sport, range: { ...limits.weeklySportTargetMinutes } },
    hints,
  };
}

/**
 * Grundumsatz, Gesamtumsatz und Untergrenze aus den Berechnungswerten einer Zielversion, gerundet wie
 * in `calculateGoals`. Damit prüft der Server, ob eine Zielversion in sich stimmig ist; die Eingaben
 * prüft er vorher gegen ihre Grenzen.
 */
export function calorieNeeds(body: CalorieNeedsInput): CalorieNeeds {
  const { basal, total, lowerBound } = needsInUnits(body);
  return { basalMetabolicRate: amount(basal), totalEnergyExpenditure: amount(total), lowerBound: amount(lowerBound) };
}

/**
 * Mindestdauer einer Sporteinheit: Sportwochenziel ÷ Zahl der Wochentage mit Baustein Sporteinheit,
 * auf ganze Minuten aufgerundet (Rundung Designwert). Ohne Sporttag gibt es keine Schwelle.
 */
export function sportSessionThreshold(weeklySportTargetMinutes: number, sportDayCount: number): number | null {
  return sportDayCount === 0 ? null : Math.ceil(weeklySportTargetMinutes / sportDayCount);
}
