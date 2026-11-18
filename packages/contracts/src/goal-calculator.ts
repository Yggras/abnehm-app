import type { LocalDate } from './base.ts';
import { addDays, fullYearsBetween, yearAndMonth } from './calendar.ts';
import type { ActivityLevel, CalculationSex } from './person.ts';
import type { MaintenanceReason, Pace } from './ports.ts';
import { forecastWeeklyLossG } from './tracker-rules.ts';
import { heightCmLimits } from './units.ts';

// Zielrechner (Spezifikation 1, Abschnitt 3): reine Funktionen für App und Server. Die App zeigt
// damit Vorschau, Ergebnis und Neuberechnung. Der Server rechnet eine Zielversion aus ihren
// gespeicherten Berechnungswerten nach und prüft so ihre Stimmigkeit. Quellen der Zahlen stehen in
// der Spezifikation; Werte ohne Quelle sind dort als Designwert markiert.

/** Eingaben des Zielrechners; Gewichte in g, Größe in cm (Spezifikation 0, Abschnitt 8). */
export type GoalCalculatorInput = {
  /** Tag der Berechnung; Ausgangspunkt der Prognose. */
  calculationDate: LocalDate;
  calculationSex: CalculationSex;
  /** Alter in vollen Jahren am Berechnungstag, siehe `ageOn`; so speichert es auch die Zielversion. */
  ageYears: number;
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
  /**
   * Im Haltemodus der Gesamtumsatz, mit manuellem Wert dieser, sonst Gesamtumsatz − Defizit. Ein
   * berechnetes Budget liegt nie unter der Untergrenze, auch im Haltemodus nicht.
   */
  calorieBudget: KcalAmount;
  /** Der Rechner kennt nur diese beiden; `budgetvorschlag` setzt erst das Annehmen eines Budgetvorschlags. */
  budgetSource: 'berechnet' | 'manuell';
  /** Die Rechnung lag unter der Untergrenze; dazu gehört der Hinweis `budget_raised_to_lower_bound`. */
  budgetRaisedToLowerBound: boolean;
  /**
   * Erlaubtes manuelles Budget in kcal: vom auf die Untergrenze angehobenen Budget bis zum größten
   * Vielfachen von 10, das den Gesamtumsatz nicht übersteigt. Im erzwungenen Haltemodus gibt es keines.
   */
  manualBudgetRange: StepRange | null;
  goalWeight: GoalWeight;
  /** Nur mit Defizit; die Oberfläche zeigt Monat und Jahr als „etwa …“. */
  forecast: GoalForecast | null;
  water: { targetMl: number; suggestedMl: number; range: StepRange; hintKey: 'water_need_higher_in_heat_and_sport' };
  sport: { weeklyTargetMinutes: number; suggestedMinutes: number; range: StepRange };
  /** Hinweise, die nur in bestimmten Lagen erscheinen, in der Reihenfolge des Onboardings. */
  hints: CalculationHint[];
};

/** Hinweise einer Berechnung, die nur in bestimmten Lagen erscheinen. */
type CalculationHint = 'maintenance_forced' | 'goal_weight_not_below_current' | 'budget_raised_to_lower_bound';

/**
 * Hinweise zur Berechnung; den Text erzeugt die App aus dem Schlüssel.
 * - `maintenance_forced`: Der Sicherheits-Check erzwingt den Haltemodus, mit Hinweis auf ärztliche Begleitung.
 * - `goal_weight_not_below_current`: Das Zielgewicht liegt nicht unter dem aktuellen Gewicht, daher Haltemodus.
 * - `budget_raised_to_lower_bound`: Das Budget wurde auf die Untergrenze angehoben, mit Verweis auf ärztliche Begleitung.
 * - `weight_loss_slows_after_three_months`: zur Prognose; die Abnahme verlangsamt sich nach etwa drei Monaten.
 * - `water_need_higher_in_heat_and_sport`: zum Wasserziel; bei Hitze und Sport braucht man mehr.
 */
export type GoalHintKey = CalculationHint | GoalForecast['hintKey'] | GoalCalculation['water']['hintKey'];

/** Eingaben mit Bereich und Raster; ihr Name ist der Anfang ihrer Fehlerschlüssel. */
type LimitedInput = 'height' | 'weight' | 'goal_weight' | 'manual_budget' | 'water_target' | 'sport_target';

/** Verletzte Eingabegrenze: Wert außerhalb des Bereichs, nicht im Raster oder im Zustand nicht erlaubt. */
export type GoalInputError =
  | `${LimitedInput}_out_of_range`
  | `${LimitedInput}_not_on_step`
  | 'underage'
  | 'goal_weight_below_lower_limit'
  | 'manual_budget_in_forced_maintenance';

/** Ergebnis des Zielrechners; Verstöße gegen die Eingabegrenzen sind Fehlerschlüssel, keine Ausnahmen. */
export type GoalCalculatorResult = GoalCalculation | { type: 'ungueltig'; errors: GoalInputError[] };

// Kalorien rechnet der Rechner exakt als Ganzzahl in Einheiten von 1/4000 kcal (Suffix `Units`):
// 6,25 × cm ist ein Vielfaches von 1/4 kcal, 10 × kg bei ganzen Gramm eines von 1/100 kcal, und die
// Aktivitätsstufe multipliziert mit Zehnteln. Erst die Ausgabe rundet, sodass App und Server dieselben
// Werte erhalten und kein Gleitkomma-Rest eine Rundung auf ,5 kippt.
const UNITS_PER_KCAL = 4_000;
const kcalUnits = (kcal: number) => kcal * UNITS_PER_KCAL;

/** Aktivitätsstufe als PAL in Zehnteln (DGE: 1,4 / 1,6 / 1,8). */
const palTenths: Record<ActivityLevel, number> = { wenig_aktiv: 14, maessig_aktiv: 16, aktiv: 18 };

/** Defizit je Tempo: S3-Leitlinie Adipositas 2024 (Empf. 5.11) bzw. AHA/ACC/TOS 2013. */
const deficitKcal: Record<Pace, number> = { entspannt: 500, zuegiger: 750 };

/** Erwartete Abnahme je Woche und Tempo in g (#14), aus den Tracker-Regeln wie die Prognose des Gewicht-Detailbildschirms. */
const weeklyLossG: Readonly<Record<Pace, number>> = forecastWeeklyLossG;

/** Feste Untergrenze des Kalorienbudgets (#14); höher ist sie, wenn der Grundumsatz darüber liegt. */
const minimumBudgetKcal = 1_200;

/** BMI 18,5 in Zehnteln (WHO): darunter Untergewicht, zugleich die Untergrenze des Zielgewichts. */
const underweightBmiTenths = 185;

/** Eingabegrenzen (Designwerte): Bereich und Raster je Eingabe. */
const limits = {
  heightCm: { ...heightCmLimits, step: 1 },
  weightG: { min: 30_000, max: 300_000, step: 100 },
  waterTargetMl: { min: 500, max: 5_000, step: 250 },
  weeklySportTargetMinutes: { min: 30, max: 600, step: 10 },
} as const satisfies Record<string, StepRange>;

const minimumAgeYears = 18;

/** Gerundete DGE-Richtwerte für Getränke; 18-Jährige erhalten ebenfalls 1.500 ml (Designwert). */
const suggestedWaterMl = (ageYears: number) => (ageYears <= 50 ? 1_500 : 1_250);

/** Wöchentliche aktive Minuten nach WHO 2020. */
const suggestedSportMinutes = 150;

/** Kaufmännisch auf ganze kcal gerundet, in kcal und `milli_kcal`. */
function roundedKcal(units: number): KcalAmount {
  const kcal = Math.floor((units + UNITS_PER_KCAL / 2) / UNITS_PER_KCAL);
  return { kcal, milliKcal: kcal * 1_000 };
}

/** Kaufmännisch auf 10 kcal gerundet. */
const roundToTenUnits = (units: number) => Math.floor((units + kcalUnits(5)) / kcalUnits(10)) * kcalUnits(10);

/** Das kleinste Vielfache von 10 kcal, das nicht unter dem Wert liegt. */
const ceilToTenUnits = (units: number) => Math.ceil(units / kcalUnits(10)) * kcalUnits(10);

function checkLimit(value: number, limit: StepRange, input: LimitedInput): GoalInputError[] {
  if (value < limit.min || value > limit.max) return [`${input}_out_of_range`];
  return Number.isInteger(value / limit.step) ? [] : [`${input}_not_on_step`];
}

/**
 * Zielgewicht samt Vorschlag, ganzzahlig gerechnet: Bei BMI 18,5 wiegt man 18,5 × (cm / 100)² kg
 * = 185 × cm² / 100 g. Der Vorschlag rundet auf 0,1 kg nach innen, damit er im Bereich 5–10 % bleibt
 * (Designwert); nach oben begrenzt die Gewichtseingabe.
 */
function goalWeightOf(input: GoalCalculatorInput): GoalWeight {
  const step = limits.weightG.step;
  const lowerLimitG = Math.ceil((underweightBmiTenths * input.heightCm ** 2) / (100 * step)) * step;
  const fivePercentBelowG = Math.floor((input.weightG * 95) / (100 * step)) * step;
  const tenPercentBelowG = Math.ceil((input.weightG * 90) / (100 * step)) * step;
  const suggestion =
    fivePercentBelowG < lowerLimitG ? null : { fromG: Math.max(tenPercentBelowG, lowerLimitG), toG: fivePercentBelowG };
  const preselectedG = suggestion?.toG ?? lowerLimitG;
  return {
    goalWeightG: input.goalWeightG ?? preselectedG,
    preselectedG,
    suggestion,
    range: { min: lowerLimitG, max: limits.weightG.max, step },
  };
}

function goalWeightErrors({ goalWeightG, range }: GoalWeight): GoalInputError[] {
  return goalWeightG < range.min ? ['goal_weight_below_lower_limit'] : checkLimit(goalWeightG, range, 'goal_weight');
}

function manualBudgetErrors(manualBudgetKcal: number | null, range: StepRange | null): GoalInputError[] {
  if (manualBudgetKcal === null) return [];
  return range === null ? ['manual_budget_in_forced_maintenance'] : checkLimit(manualBudgetKcal, range, 'manual_budget');
}

/** Basisgewicht ist der Gewichtstrend, sonst das aktuelle Gewicht. */
function forecastOf(input: GoalCalculatorInput, goalWeightG: number, pace: Pace): GoalForecast {
  const lossG = Math.max(0, (input.weightTrendG ?? input.weightG) - goalWeightG);
  const estimate = addDays(input.calculationDate, Math.ceil((lossG * 7) / weeklyLossG[pace]));
  return {
    type: 'schaetzung',
    weeks: lossG / weeklyLossG[pace],
    ...yearAndMonth(estimate),
    hintKey: 'weight_loss_slows_after_three_months',
  };
}

/**
 * Alter in vollen Jahren am Berechnungstag, die Eingabe `ageYears`. Der Geburtstag zählt schon mit,
 * ein 18. Geburtstag am Berechnungstag gilt also als volljährig.
 */
export function ageOn(birthDate: LocalDate, calculationDate: LocalDate): number {
  return fullYearsBetween(birthDate, calculationDate);
}

/**
 * Berechnet Kalorienbudget, Haltemodus, Zielgewicht, Prognose, Wasser- und Sportziel. Erst werden
 * Körperdaten und Alter geprüft, danach die Ziele gegen die daraus folgenden Grenzen.
 */
export function calculateGoals(input: GoalCalculatorInput): GoalCalculatorResult {
  const bodyErrors: GoalInputError[] = [
    ...checkLimit(input.heightCm, limits.heightCm, 'height'),
    ...checkLimit(input.weightG, limits.weightG, 'weight'),
    ...(input.ageYears < minimumAgeYears ? ['underage' as const] : []),
  ];
  if (bodyErrors.length > 0) return { type: 'ungueltig', errors: bodyErrors };

  const goalWeight = goalWeightOf(input);

  // BMI < 18,5 ⟺ 10 × g / cm² < 18,5 ⟺ 100 × g < 185 × cm², ganzzahlig und ohne Rundungsfehler.
  const safetyTriggers: SafetyTrigger[] = [];
  if (input.pregnantOrBreastfeeding) safetyTriggers.push('schwanger_oder_stillend');
  if (input.knownEatingDisorder) safetyTriggers.push('essstoerung');
  if (input.weightG * 100 < underweightBmiTenths * input.heightCm ** 2) safetyTriggers.push('untergewicht');

  const maintenance: { reason: MaintenanceReason | null; hint: CalculationHint | null } =
    safetyTriggers.length > 0
      ? { reason: 'sicherheits_check', hint: 'maintenance_forced' }
      : goalWeight.goalWeightG >= input.weightG
        ? { reason: 'gewaehlt', hint: 'goal_weight_not_below_current' }
        : { reason: input.pace === null ? 'gewaehlt' : null, hint: null };
  const pace = maintenance.reason === null ? input.pace : null;

  // Mifflin-St Jeor (1990): 10 × kg + 6,25 × cm − 5 × Alter + 5 bzw. − 161, hier in Einheiten.
  const sexTermUnits = kcalUnits(input.calculationSex === 'maennlich' ? 5 : -161);
  const basalUnits = input.weightG * 40 + input.heightCm * 25_000 - input.ageYears * 20_000 + sexTermUnits;
  const totalUnits = (basalUnits * palTenths[input.activityLevel]) / 10;
  const lowerBoundUnits = Math.max(kcalUnits(minimumBudgetKcal), basalUnits);
  const deficitUnits = pace === null ? null : kcalUnits(deficitKcal[pace]);
  const unraisedBudgetUnits = deficitUnits === null ? totalUnits : totalUnits - deficitUnits;

  // Das Budget wird auf 10 kcal gerundet; läge es danach unter der Untergrenze, gilt das nächste
  // Vielfache von 10 darüber.
  const budgetUnitsFrom = (units: number) => {
    const rounded = roundToTenUnits(Math.max(units, lowerBoundUnits));
    return rounded < lowerBoundUnits ? ceilToTenUnits(lowerBoundUnits) : rounded;
  };
  const manualMinKcal = budgetUnitsFrom(lowerBoundUnits) / UNITS_PER_KCAL;
  const manualBudgetRange =
    maintenance.reason === 'sicherheits_check'
      ? null
      : { min: manualMinKcal, max: Math.max(Math.floor(roundedKcal(totalUnits).kcal / 10) * 10, manualMinKcal), step: 10 };

  const water = { targetMl: input.waterTargetMl ?? suggestedWaterMl(input.ageYears), suggestedMl: suggestedWaterMl(input.ageYears) };
  const sport = {
    weeklyTargetMinutes: input.weeklySportTargetMinutes ?? suggestedSportMinutes,
    suggestedMinutes: suggestedSportMinutes,
  };

  const errors: GoalInputError[] = [
    ...goalWeightErrors(goalWeight),
    ...manualBudgetErrors(input.manualBudgetKcal, manualBudgetRange),
    ...checkLimit(water.targetMl, limits.waterTargetMl, 'water_target'),
    ...checkLimit(sport.weeklyTargetMinutes, limits.weeklySportTargetMinutes, 'sport_target'),
  ];
  if (errors.length > 0) return { type: 'ungueltig', errors };

  const budget: { units: number; source: GoalCalculation['budgetSource']; raised: boolean } =
    input.manualBudgetKcal === null
      ? { units: budgetUnitsFrom(unraisedBudgetUnits), source: 'berechnet', raised: unraisedBudgetUnits < lowerBoundUnits }
      : { units: kcalUnits(input.manualBudgetKcal), source: 'manuell', raised: false };

  const hints: CalculationHint[] = [];
  if (maintenance.hint !== null) hints.push(maintenance.hint);
  if (budget.raised) hints.push('budget_raised_to_lower_bound');

  return {
    type: 'berechnet',
    bmi: (input.weightG * 10) / input.heightCm ** 2,
    safetyTriggers,
    maintenanceReason: maintenance.reason,
    pace,
    activityFactor: palTenths[input.activityLevel] / 10,
    basalMetabolicRate: roundedKcal(basalUnits),
    totalEnergyExpenditure: roundedKcal(totalUnits),
    deficit: deficitUnits === null ? null : roundedKcal(deficitUnits),
    lowerBound: roundedKcal(lowerBoundUnits),
    calorieBudget: roundedKcal(budget.units),
    budgetSource: budget.source,
    budgetRaisedToLowerBound: budget.raised,
    manualBudgetRange,
    goalWeight,
    forecast: pace === null ? null : forecastOf(input, goalWeight.goalWeightG, pace),
    water: { ...water, range: { ...limits.waterTargetMl }, hintKey: 'water_need_higher_in_heat_and_sport' },
    sport: { ...sport, range: { ...limits.weeklySportTargetMinutes } },
    hints,
  };
}

/**
 * Mindestdauer einer Sporteinheit: Sportwochenziel ÷ Zahl der Wochentage mit Baustein Sporteinheit,
 * auf ganze Minuten aufgerundet (Rundung Designwert). Ohne Sporttag gibt es keine Schwelle.
 */
export function sportSessionThreshold(weeklySportTargetMinutes: number, sportDayCount: number): number | null {
  return sportDayCount === 0 ? null : Math.ceil(weeklySportTargetMinutes / sportDayCount);
}
