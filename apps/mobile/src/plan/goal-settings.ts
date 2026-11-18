import type { Clock } from '@abnehm/clock';
import { EntityId, LocalDate, localDateAfter } from '@abnehm/contracts/base';
import {
  calculateGoals,
  type GoalCalculation,
  type GoalCalculatorResult,
  type GoalForecast,
  type GoalInputError,
  type SafetyTrigger,
} from '@abnehm/contracts/goal-calculator';
import type { LatestWeight, WeightTrendReader } from '@abnehm/contracts/ports';

import type { LocalDatabase, ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Refresh, Source } from '../shell/followed-source';
import { observeWithRefresh } from '../shell/observed-reading';
import { calculatorInput, goalDraftOf, keptSuggestedBudget, versionCalculatorInput, type GoalDraft, type PersonGoalFields } from './goal-draft';
import { readGoalVersionOn, type GoalVersionValues } from './plan-repository';

// Lesemodell der Einstellungsseite „Ziele“ (Spezifikation 1, Abschnitt 10; #147): die heute gültige
// Zielversion samt Herleitung des Kalorienbudgets, Prognose und Grund des Haltemodus, eine bevorstehende
// Fassung „ab morgen“ mit den geänderten Werten und der Ausgangsentwurf für „Ziele ändern“. Die
// Herleitung steht in der Zielversion; was sie nicht speichert (Anhebung, Sicherheitsgrund, Prognose),
// rechnet der Zielrechner aus ihren Werten nach. Das Basisgewicht der Prognose ist der Gewichtstrend,
// sonst das letzte Tagesgewicht, sonst das Gewicht der Berechnung (Abschnitt 3).

/** Feld einer Zielversion, das sich mit einer bevorstehenden Fassung ändern kann. */
export type GoalVersionField = Exclude<keyof GoalVersionValues, 'validFrom'>;

/** Eine Zielversion, wie die Seite sie zeigt. */
export type GoalVersionView = Readonly<{
  values: GoalVersionValues;
  /** Faktor der Aktivitätsstufe (PAL) für die Herleitung; `null`, wenn sich die Fassung nicht nachrechnen lässt. */
  activityFactor: number | null;
  /** Die Rechnung lag unter der Untergrenze; nur bei einem berechneten Budget. */
  budgetRaisedToLowerBound: boolean;
  /** Anlässe des erzwungenen Haltemodus; leer ohne ihn. */
  safetyTriggers: readonly SafetyTrigger[];
  /** Geschätzter Zeitpunkt des Zielgewichts ab heute bzw. ab Gültigkeit; nur mit Tempo. */
  forecast: GoalForecast | null;
}>;

export type GoalSettings = Readonly<{
  today: LocalDate;
  /** Die heute gültige Fassung; `null` vor dem ersten Plan. */
  current: GoalVersionView | null;
  /** Die Fassung ab morgen, sofern sie Werte ändert. */
  upcoming: Readonly<{ view: GoalVersionView; changed: readonly GoalVersionField[] }> | null;
  /** Die ab morgen gültigen Werte als Entwurf für „Ziele ändern“; `null` ohne Plan. */
  draft: GoalDraft | null;
  /**
   * Das Budget eines angenommenen Budgetvorschlags in der Fassung ab morgen, in kcal; `null` ohne. Der
   * Ausgangsentwurf nennt es als manuelles Budget, damit „Ziele ändern“ es samt Herkunft behält.
   */
  suggestedBudgetKcal: number | null;
  /** Prüft eine Änderung ab morgen, wie „Ziele ändern“ sie anlegen würde; schreibt nichts. */
  check(draft: GoalDraft, intent: GoalChangeIntent): GoalChangeCheck;
}>;

/** Was die Person mit einer Änderung will, über die Werte des Entwurfs hinaus. */
export type GoalChangeIntent = Readonly<{
  /** Freiwilliger Haltemodus; ohne ihn braucht der Entwurf ein Tempo und ein Zielgewicht unter dem Gewicht. */
  holding: boolean;
}>;

/** Prüfung einer Änderung ab morgen für die Bearbeitung der Seite „Ziele“. */
export type GoalChangeCheck = Readonly<{
  /** Vorschau ab morgen mit der Prognose vom Basisgewicht; ein behaltenes Vorschlagsbudget steht darin. */
  result: GoalCalculatorResult;
  /**
   * Rechnung ohne Zielgewicht und eigenes Budget: Grenzen, Vorschlag des Zielgewichts und Sicherheitsgrund
   * hängen an keinem von beiden und stehen so auch bei ungültigen Eingaben fest; `null` nur bei ungültigen
   * Körperdaten, Wasser- oder Sportziel.
   */
  reference: GoalCalculation | null;
  /** Der Sicherheits-Check erzwingt den Haltemodus; Tempo und eigenes Budget entfallen. */
  forced: boolean;
  goalWeightProblem: 'below_limit' | 'invalid' | null;
  manualBudgetInvalid: boolean;
  /** Der Haltemodus soll enden, aber es ist noch kein Tempo gewählt. */
  paceMissing: boolean;
  /** Der Haltemodus soll enden, aber das Zielgewicht liegt nicht unter dem Gewicht. */
  goalWeightNotBelowCurrent: boolean;
  /** Die Änderung ließe sich so anlegen. */
  valid: boolean;
}>;

export type GoalSettingsState =
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'ready'; settings: GoalSettings }>
  /** Der `WeightTrendReader` ist gescheitert oder hat seinen Vertrag verletzt. */
  | Readonly<{ type: 'error' }>;

/** Die heute und die ab morgen gültige Zielversion der Person. */
export type GoalVersionsAround = Readonly<{ current: GoalVersionValues | null; next: GoalVersionValues | null }>;

export function readGoalVersionsAround(tx: ReadContext, personId: EntityId, today: LocalDate): GoalVersionsAround {
  return {
    current: readGoalVersionOn(tx, personId, today)?.values ?? null,
    next: readGoalVersionOn(tx, personId, localDateAfter(today, 1))?.values ?? null,
  };
}

/** Die Fassung ab morgen samt geänderten Feldern, sofern sie erst morgen gilt und etwas ändert. */
export function upcomingGoalOf({ current, next }: GoalVersionsAround, today: LocalDate) {
  if (next === null || next.validFrom <= today) return null;
  const changed = changedGoalFields(current, next);
  return changed.length === 0 ? null : { version: next, changed };
}

/** Felder, in denen sich die bevorstehende Fassung von der heute gültigen unterscheidet; ohne diese alle. */
function changedGoalFields(current: GoalVersionValues | null, next: GoalVersionValues): GoalVersionField[] {
  return (Object.keys(next) as (keyof GoalVersionValues)[])
    .filter((field): field is GoalVersionField => field !== 'validFrom' && (current === null || current[field] !== next[field]));
}

type GoalSettingsReading = Readonly<{ personId: EntityId; today: LocalDate; person: PersonGoalFields; versions: GoalVersionsAround }>;

/**
 * Beobachtet das Lesemodell: neu bei jedem Commit der Kontodatenbank und auf Anstoß von `refresh`, etwa
 * am Tageswechsel. Ohne eigene Person lädt es; scheitert der `WeightTrendReader`, meldet es `error`.
 */
export function goalSettingsSource(
  { database, clock }: Readonly<{ database: Pick<LocalDatabase, 'observe' | 'read'>; clock: Clock }>,
  weightTrendReader: Pick<WeightTrendReader, 'latest'>,
  refresh: Refresh,
): Source<GoalSettingsState> {
  const read = (tx: ReadContext): GoalSettingsReading | null => {
    const own = readOwnPerson(tx);
    if (own === undefined) return null;
    const personId = EntityId.parse(own.id);
    const today = LocalDate.parse(clock.read().localDate);
    return { personId, today, person: own, versions: readGoalVersionsAround(tx, personId, today) };
  };
  return {
    subscribe(listener) {
      let latest = 0;
      let active = true;
      const stop = observeWithRefresh(database, refresh, read, (reading) => {
        const request = ++latest;
        if (reading === null) return listener({ type: 'loading' });
        settingsOf(reading, weightTrendReader).then(
          (settings) => active && request === latest && listener({ type: 'ready', settings }),
          () => active && request === latest && listener({ type: 'error' }),
        );
      });
      return () => {
        active = false;
        stop();
      };
    },
  };
}

async function settingsOf({ personId, today, person, versions }: GoalSettingsReading, weightTrendReader: Pick<WeightTrendReader, 'latest'>): Promise<GoalSettings> {
  const tomorrow = localDateAfter(today, 1);
  const latest = versions.next === null ? null : await weightTrendReader.latest(personId);
  const baseOf = (version: GoalVersionValues) => forecastBaseG(latest) ?? version.weightG;
  const view = (version: GoalVersionValues) => viewOf(version, person, version.validFrom > today ? version.validFrom : today, baseOf(version));
  const upcoming = upcomingGoalOf(versions, today);
  const draft = versions.next === null ? null : goalDraftOf(versions.next, person);
  const previewBase = versions.next === null ? null : baseOf(versions.next);
  const preview = (next: GoalDraft) => previewOf(next, tomorrow, previewBase ?? next.weightG, versions.next ?? undefined);
  return {
    today,
    current: versions.current === null ? null : view(versions.current),
    upcoming: upcoming === null ? null : { view: view(upcoming.version), changed: upcoming.changed },
    draft,
    suggestedBudgetKcal: versions.next?.budgetSource === 'budgetvorschlag' ? versions.next.calorieBudgetMilliKcal / 1_000 : null,
    check: (next, intent) => checkOf(next, intent, preview),
  };
}

/**
 * Vorschau ab morgen wie `changeGoals`: Behält der Entwurf das Budget eines angenommenen Budgetvorschlags,
 * gilt es statt der Rechnung, solange es zwischen Untergrenze und Gesamtumsatz liegt und der Haltemodus
 * nicht erzwungen ist.
 */
function previewOf(draft: GoalDraft, tomorrow: LocalDate, baseG: number, inForce: GoalVersionValues | undefined): GoalCalculatorResult {
  const suggested = keptSuggestedBudget(draft, inForce);
  const result = calculateGoals(calculatorInput({ ...draft, manualBudgetKcal: suggested === null ? draft.manualBudgetKcal : null }, tomorrow, baseG));
  if (suggested === null || result.type === 'ungueltig') return result;
  if (result.manualBudgetRange === null) return { type: 'ungueltig', errors: ['manual_budget_in_forced_maintenance'] };
  if (suggested < result.lowerBound.milliKcal || suggested > result.totalEnergyExpenditure.milliKcal) return { type: 'ungueltig', errors: ['manual_budget_out_of_range'] };
  return { ...result, calorieBudget: { kcal: suggested / 1_000, milliKcal: suggested }, budgetRaisedToLowerBound: false, hints: result.hints.filter((hint) => hint !== 'budget_raised_to_lower_bound') };
}

function checkOf(draft: GoalDraft, { holding }: GoalChangeIntent, preview: (draft: GoalDraft) => GoalCalculatorResult): GoalChangeCheck {
  const result = preview(draft);
  const referenceResult = preview({ ...draft, goalWeightG: null, manualBudgetKcal: null });
  const reference = referenceResult.type === 'berechnet' ? referenceResult : null;
  const forced = reference?.maintenanceReason === 'sicherheits_check';
  const errors: readonly GoalInputError[] = result.type === 'ungueltig' ? result.errors : [];
  const goalWeightProblem = errors.includes('goal_weight_below_lower_limit')
    ? 'below_limit'
    : errors.some((error) => error.startsWith('goal_weight')) ? 'invalid' : null;
  const leavesHolding = !forced && !holding;
  const paceMissing = leavesHolding && draft.pace === null;
  const goalWeightNotBelowCurrent = leavesHolding && draft.pace !== null && result.type === 'berechnet' && result.hints.includes('goal_weight_not_below_current');
  return {
    result,
    reference,
    forced,
    goalWeightProblem,
    manualBudgetInvalid: errors.some((error) => error.startsWith('manual_budget')),
    paceMissing,
    goalWeightNotBelowCurrent,
    valid: result.type === 'berechnet' && !paceMissing && !goalWeightNotBelowCurrent,
  };
}

/** Basisgewicht der Prognose: Gewichtstrend, sonst letztes Tagesgewicht; ohne beides `null`. */
function forecastBaseG(latest: LatestWeight | null): number | null {
  if (latest === null) return null;
  return latest.trend.type === 'verfuegbar' ? latest.trend.trendG : (latest.lastDayWeight?.dayWeightG ?? null);
}

/**
 * Rechnet eine gespeicherte Fassung mit dem Zielrechner nach, für das, was sie nicht speichert. Ein Budget
 * der Person oder aus einem Budgetvorschlag ist nie angehoben; die Sicherheitsangaben stammen von der
 * Person, die Körperdaten aus der Fassung.
 */
function viewOf(values: GoalVersionValues, person: PersonGoalFields, calculationDate: LocalDate, baseG: number): GoalVersionView {
  const calculation = calculateGoals(versionCalculatorInput(values, person, calculationDate, baseG));
  if (calculation.type === 'ungueltig') return { values, activityFactor: null, budgetRaisedToLowerBound: false, safetyTriggers: [], forecast: null };
  return {
    values,
    activityFactor: calculation.activityFactor,
    budgetRaisedToLowerBound: values.budgetSource === 'berechnet' && calculation.budgetRaisedToLowerBound,
    safetyTriggers: values.maintenanceReason === 'sicherheits_check' ? calculation.safetyTriggers : [],
    forecast: values.pace === null ? null : calculation.forecast,
  };
}
