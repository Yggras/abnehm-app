import type { Clock } from '@abnehm/clock';
import { EntityId, LocalDate, localDateAfter } from '@abnehm/contracts/base';
import { calculateGoals, type GoalCalculatorResult, type GoalForecast, type SafetyTrigger } from '@abnehm/contracts/goal-calculator';
import type { LatestWeight, WeightTrendReader } from '@abnehm/contracts/ports';

import type { LocalDatabase, ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Refresh, Source } from '../shell/followed-source';
import { observeWithRefresh } from '../shell/observed-reading';
import { calculatorInput, goalDraftOf, type GoalDraft, type PersonGoalFields } from './goal-draft';
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
  /** Reine Vorschau einer Änderung ab morgen, mit der Prognose vom selben Basisgewicht; schreibt nichts. */
  preview(draft: GoalDraft): GoalCalculatorResult;
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
  return {
    today,
    current: versions.current === null ? null : view(versions.current),
    upcoming: upcoming === null ? null : { view: view(upcoming.version), changed: upcoming.changed },
    draft,
    preview: (next) => calculateGoals(calculatorInput(next, tomorrow, previewBase ?? next.weightG)),
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
  const calculation = calculateGoals({
    calculationDate,
    calculationSex: values.calculationSex,
    ageYears: values.ageYears,
    heightCm: values.heightCm,
    weightG: values.weightG,
    weightTrendG: baseG,
    activityLevel: values.activityLevel,
    pregnantOrBreastfeeding: person.pregnantOrBreastfeeding ?? false,
    knownEatingDisorder: person.knownEatingDisorder ?? false,
    goalWeightG: values.goalWeightG,
    pace: values.pace,
    manualBudgetKcal: null,
    waterTargetMl: values.waterTargetMl,
    weeklySportTargetMinutes: values.weeklySportTargetMinutes,
  });
  if (calculation.type === 'ungueltig') return { values, budgetRaisedToLowerBound: false, safetyTriggers: [], forecast: null };
  return {
    values,
    budgetRaisedToLowerBound: values.budgetSource === 'berechnet' && calculation.budgetRaisedToLowerBound,
    safetyTriggers: values.maintenanceReason === 'sicherheits_check' ? calculation.safetyTriggers : [],
    forecast: values.pace === null ? null : calculation.forecast,
  };
}
