import { readingOf, type Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, localDateAfter } from '@abnehm/contracts/base';
import {
  budgetSuggestionId,
  BudgetSuggestionUpsert,
  kcalOfMilliKcal,
  minimumMealCategoriesPerDay,
  type BudgetSuggestionDirection,
} from '@abnehm/contracts/plan';
import type { IntakeReader, WeightTrendReader } from '@abnehm/contracts/ports';

import type { LocalDatabase, ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { readOwnPerson } from '../local-db/person-header';
import type { SyncWriter } from '../sync';
import { budgetSuggestionEntity } from './plan-entities';
import { readBudgetSuggestion, readLastDecisionAt, readOpenBudgetSuggestion, writeBudgetSuggestion } from './budget-suggestion-repository';
import { readGoalVersionsUntil, type GoalVersionValues } from './plan-repository';
import type { BudgetNoticeReader } from './today-contributions';

// Budgetvorschlag (Spezifikation 1, Abschnitt 7; Regel nach Vorentscheidung 2 in #57): Nach mindestens drei
// Wochen mit genügend Gewichtsdaten schlägt die App vor, das Kalorienbudget um 150 kcal zu senken oder
// anzuheben, wenn der Gewichtstrend deutlich vom gewählten Tempo abweicht. Den Rahmen (frühestens nach 3
// Wochen, ≥ 2 Gewichtseinträge je Woche, höchstens alle 2 Wochen, ±150 kcal, nur mit Bestätigung) setzt
// #14; alle übrigen Schwellen sind Designwerte. Gewichtstrend und Tagesaufnahme kommen ausschließlich über
// `WeightTrendReader` und `IntakeReader`.

/** Betrachtet werden die letzten 21 lokalen Tage bis gestern, in drei Abschnitten zu 7 Tagen. */
const windowDays = 21;
const sectionDays = 7;
/** Seit so vielen Tagen muss die erste Zielversion gelten. */
const firstGoalMinDays = 21;
/** Seit so vielen Tagen müssen das aktuelle Kalorienbudget gelten und die letzte Entscheidung zurückliegen. */
const budgetMinDays = 14;
const decisionMinDays = 14;
/** Tagesgewichte je Abschnitt laut `WeightTrendReader`. */
const minDayWeightsPerSection = 2;
/** Erfasste Tage (≥ 2 Mahlzeitenkategorien) laut `IntakeReader`, und davon der Anteil im Budget in Zehnteln. */
const minRecordedDays = 10;
const minTenthsWithinBudget = 7;
/** Schritt des Vorschlags: 150 kcal. */
const stepMilliKcal = 150_000;
/** Soll-Abnahme je Woche in g: 0,5 kg bei „entspannt“, 0,75 kg bei „zügiger“. */
const targetLossG = { entspannt: 500, zuegiger: 750 } as const;

/** Schlüssel im Gerätezustand: der lokale Tag der letzten Prüfung. Er wird nicht synchronisiert. */
const checkedOnKey = 'plan.budgetvorschlag_geprueft_am';

/** Die Ports, über die die Prüfung Gewichtstrend und Tagesaufnahme liest. */
export type BudgetSuggestionReaders = Readonly<{
  weightTrendReader: Pick<WeightTrendReader, 'series'>;
  intakeReader: IntakeReader;
}>;

/** Warum die Prüfung keinen Vorschlag angelegt hat. */
export type NoBudgetSuggestionReason =
  /** Es gibt noch keine eigene Person; die Prüfung zählt dann nicht als gelaufen. */
  | 'ohne_person'
  | 'ohne_zielversion'
  | 'haltemodus'
  | 'offener_vorschlag'
  /** Für dieses Zeitraumende gibt es schon einen Vorschlag, etwa von einem anderen Gerät. */
  | 'bereits_vorhanden'
  | 'zielversion_zu_neu'
  | 'budget_zu_neu'
  | 'entscheidung_zu_neu'
  | 'zu_wenige_tagesgewichte'
  /** Der Trendverlust liegt zwischen 0,5 × und 1,5 × Soll (jeweils einschließlich). */
  | 'im_tempo'
  | 'zu_wenige_erfasste_tage'
  | 'zu_selten_im_budget'
  | 'an_untergrenze'
  | 'am_gesamtumsatz'
  /** Während des Lesens hat sich die heute gültige Zielversion geändert; der nächste Auslöser prüft neu. */
  | 'plan_geaendert';

export type BudgetSuggestionCheck =
  | Readonly<{
      type: 'vorgeschlagen';
      suggestionId: EntityId;
      direction: BudgetSuggestionDirection;
      previousBudgetMilliKcal: number;
      suggestedBudgetMilliKcal: number;
    }>
  | Readonly<{ type: 'kein_vorschlag'; reason: NoBudgetSuggestionReason }>
  /** Heute hat die Prüfung schon stattgefunden. */
  | Readonly<{ type: 'bereits_geprueft' }>;

type Window = Readonly<{ from: LocalDate; to: LocalDate }>;

/** Was die Prüfung aus SQLite braucht, bevor sie die Ports liest. */
type Context = Readonly<{
  personId: EntityId;
  today: LocalDate;
  window: Window;
  goal: GoalVersionValues & Readonly<{ pace: NonNullable<GoalVersionValues['pace']> }>;
  /** Das an jedem Tag des Fensters gültige Kalorienbudget. */
  budgetOn: ReadonlyMap<LocalDate, number>;
}>;

type Prepared = { type: 'fertig'; check: BudgetSuggestionCheck; mark: boolean } | { type: 'pruefen'; context: Context };

type Decision =
  | Readonly<{ type: 'vorschlag'; direction: BudgetSuggestionDirection; suggestedBudgetMilliKcal: number }>
  | Readonly<{ type: 'kein_vorschlag'; reason: NoBudgetSuggestionReason }>;

export type BudgetSuggestions = Readonly<{
  check(readers: BudgetSuggestionReaders): Promise<BudgetSuggestionCheck>;
  /** Setzt einen offenen Vorschlag in der Transaktion einer neuen Zielversion auf `ueberholt`. */
  supersede(tx: TransactionContext, personId: EntityId, at: Instant): void;
  /** Hinweis `budget_suggestion` der Ernährungskarte, solange ein Vorschlag offen ist. */
  notice: BudgetNoticeReader<'budget_suggestion'>;
}>;

export function createBudgetSuggestions({ database, clock, writer }: Readonly<{ database: LocalDatabase; clock: Clock; writer: SyncWriter }>): BudgetSuggestions {
  /** Laufende Prüfung: App-Start und Vordergrund können sich überschneiden, es läuft nur eine. */
  let running: Promise<BudgetSuggestionCheck> | null = null;

  async function run(readers: BudgetSuggestionReaders): Promise<BudgetSuggestionCheck> {
    const reading = clock.read();
    const today = LocalDate.parse(reading.localDate);
    const at = Instant.parse(reading.instant);
    const prepared = database.read((tx) => prepare(tx, today, reading.timeZone));
    if (prepared.type === 'fertig') {
      if (prepared.mark) database.transaction((tx) => markChecked(tx, today, at));
      return prepared.check;
    }
    const { context } = prepared;
    const decision = await decide(context, readers);
    return database.transaction((tx): BudgetSuggestionCheck => {
      // Zwischen Lesen und Schreiben kann sich der Plan geändert haben; dann prüft der nächste Auslöser.
      const again = prepare(tx, today, reading.timeZone);
      if (again.type === 'fertig') {
        if (again.mark) markChecked(tx, today, at);
        return again.check;
      }
      if (!sameGoal(again.context.goal, context.goal)) return { type: 'kein_vorschlag', reason: 'plan_geaendert' };
      markChecked(tx, today, at);
      if (decision.type === 'kein_vorschlag') return decision;
      const id = budgetSuggestionId(context.personId, context.window.to);
      const payload = BudgetSuggestionUpsert.parse({
        periodFrom: context.window.from,
        periodTo: context.window.to,
        previousBudgetMilliKcal: context.goal.calorieBudgetMilliKcal,
        suggestedBudgetMilliKcal: decision.suggestedBudgetMilliKcal,
        direction: decision.direction,
        status: 'offen',
      });
      writeBudgetSuggestion(tx, id, context.personId, payload, at);
      writer.upsert(tx, { entityType: budgetSuggestionEntity.entityType, entityId: id, payload, knownServerVersion: null });
      return {
        type: 'vorgeschlagen',
        suggestionId: id,
        direction: decision.direction,
        previousBudgetMilliKcal: payload.previousBudgetMilliKcal,
        suggestedBudgetMilliKcal: payload.suggestedBudgetMilliKcal,
      };
    });
  }

  return {
    check(readers) {
      running ??= run(readers).finally(() => {
        running = null;
      });
      return running;
    },

    supersede(tx, personId, at) {
      const open = readOpenBudgetSuggestion(tx, personId);
      if (open === undefined) return;
      const { personId: _owner, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = open.record;
      const payload = BudgetSuggestionUpsert.parse({ ...values, status: 'ueberholt' });
      writeBudgetSuggestion(tx, open.id, personId, payload, at);
      writer.upsert(tx, { entityType: budgetSuggestionEntity.entityType, entityId: open.id, payload, knownServerVersion: open.serverVersion });
    },

    notice(tx, personId) {
      const open = readOpenBudgetSuggestion(tx, personId);
      if (open === undefined) return null;
      return {
        type: 'budget_suggestion',
        suggestionId: open.id,
        suggestedBudgetKcal: kcalOfMilliKcal(open.record.suggestedBudgetMilliKcal),
        action: { actionId: 'plan.open_budget_suggestion', target: { type: 'plan.budget_suggestion', suggestionId: open.id } },
      };
    },
  };

  function markChecked(tx: TransactionContext, today: LocalDate, at: Instant): void {
    writeDeviceState(tx, checkedOnKey, today, at);
  }

  /**
   * Die Voraussetzungen, die SQLite allein entscheidet: kein Haltemodus und kein offener Vorschlag, die
   * erste Zielversion seit ≥ 21 Tagen, das aktuelle Kalorienbudget seit ≥ 14 Tagen und die letzte
   * Entscheidung ≥ 14 Tage zurück. Jede verfehlte Voraussetzung zählt als Prüfung des Tags.
   */
  function prepare(tx: ReadContext, today: LocalDate, timeZone: Parameters<typeof readingOf>[1]): Prepared {
    const own = readOwnPerson(tx);
    if (own === undefined) return { type: 'fertig', check: { type: 'kein_vorschlag', reason: 'ohne_person' }, mark: false };
    if (readDeviceState(tx, checkedOnKey) === today) return { type: 'fertig', check: { type: 'bereits_geprueft' }, mark: false };
    const personId = EntityId.parse(own.id);
    const none = (reason: NoBudgetSuggestionReason): Prepared => ({ type: 'fertig', check: { type: 'kein_vorschlag', reason }, mark: true });

    const versions = readGoalVersionsUntil(tx, personId, today);
    const goal = versions.at(-1);
    if (goal === undefined) return none('ohne_zielversion');
    if (goal.maintenanceReason !== null || goal.pace === null) return none('haltemodus');
    if (readOpenBudgetSuggestion(tx, personId) !== undefined) return none('offener_vorschlag');
    const window = { from: localDateAfter(today, -windowDays), to: localDateAfter(today, -1) };
    if (readBudgetSuggestion(tx, budgetSuggestionId(personId, window.to)) !== undefined) return none('bereits_vorhanden');
    if (versions[0]!.validFrom > localDateAfter(today, -firstGoalMinDays)) return none('zielversion_zu_neu');
    if (budgetSince(versions) > localDateAfter(today, -budgetMinDays)) return none('budget_zu_neu');
    const decidedAt = readLastDecisionAt(tx, personId);
    if (decidedAt !== undefined && readingOf(decidedAt, timeZone).localDate > localDateAfter(today, -decisionMinDays)) return none('entscheidung_zu_neu');

    const budgetOn = new Map<LocalDate, number>();
    for (let day = window.from; day <= window.to; day = localDateAfter(day, 1)) {
      budgetOn.set(day, versions.findLast((version) => version.validFrom <= day)!.calorieBudgetMilliKcal);
    }
    return { type: 'pruefen', context: { personId, today, window, goal: { ...goal, pace: goal.pace }, budgetOn } };
  }
}

/**
 * Die Regel über die Ports: zuerst je Abschnitt ≥ 2 Tagesgewichte, dann der Trendverlust je Woche gegen das
 * Soll des Tempos; zum Senken außerdem ≥ 10 erfasste Tage, an ≥ 70 % davon beim jeweils gültigen Budget oder
 * darunter.
 */
async function decide({ personId, window, goal, budgetOn }: Context, { weightTrendReader, intakeReader }: BudgetSuggestionReaders): Promise<Decision> {
  const series = await weightTrendReader.series(personId, window.from, window.to);
  for (let section = 0; section < windowDays / sectionDays; section += 1) {
    const from = localDateAfter(window.from, section * sectionDays);
    const to = localDateAfter(from, sectionDays - 1);
    if (series.filter((day) => day.localDate >= from && day.localDate <= to).length < minDayWeightsPerSection) {
      return { type: 'kein_vorschlag', reason: 'zu_wenige_tagesgewichte' };
    }
  }
  const first = series[0]!;
  const last = series.at(-1)!;
  // Trendverlust je Woche = (Trend am ersten − Trend am letzten Tagesgewicht) ÷ Tage dazwischen × 7; positiv
  // ist Abnahme. Verglichen wird ganzzahlig über Kreuz, ohne Rundung an den Grenzen 0,5 × und 1,5 × Soll.
  const weeklyLossTimesDays = (first.trendG - last.trendG) * 7;
  const targetTimesDays = targetLossG[goal.pace] * daysFrom(first.localDate, last.localDate);
  const budget = goal.calorieBudgetMilliKcal;

  if (weeklyLossTimesDays * 2 < targetTimesDays) {
    const intake = await intakeReader.dailyIntake(personId, window.from, window.to);
    const recorded = intake.filter((day) => day.recordedMealCategories >= minimumMealCategoriesPerDay);
    if (recorded.length < minRecordedDays) return { type: 'kein_vorschlag', reason: 'zu_wenige_erfasste_tage' };
    const withinBudget = recorded.filter((day) => day.intakeMilliKcal <= budgetOn.get(day.localDate)!).length;
    if (withinBudget * 10 < recorded.length * minTenthsWithinBudget) return { type: 'kein_vorschlag', reason: 'zu_selten_im_budget' };
    if (budget <= goal.lowerBoundMilliKcal) return { type: 'kein_vorschlag', reason: 'an_untergrenze' };
    return { type: 'vorschlag', direction: 'senken', suggestedBudgetMilliKcal: Math.max(budget - stepMilliKcal, goal.lowerBoundMilliKcal) };
  }
  if (weeklyLossTimesDays * 2 > targetTimesDays * 3) {
    if (budget >= goal.totalEnergyExpenditureMilliKcal) return { type: 'kein_vorschlag', reason: 'am_gesamtumsatz' };
    return { type: 'vorschlag', direction: 'anheben', suggestedBudgetMilliKcal: Math.min(budget + stepMilliKcal, goal.totalEnergyExpenditureMilliKcal) };
  }
  return { type: 'kein_vorschlag', reason: 'im_tempo' };
}

/** Seit wann das aktuelle Kalorienbudget ununterbrochen gilt: `valid_from` der ältesten Fassung mit demselben Budget in Folge. */
function budgetSince(versions: readonly GoalVersionValues[]): LocalDate {
  const budget = versions.at(-1)!.calorieBudgetMilliKcal;
  let since = versions.at(-1)!.validFrom;
  for (let index = versions.length - 2; index >= 0 && versions[index]!.calorieBudgetMilliKcal === budget; index -= 1) since = versions[index]!.validFrom;
  return since;
}

/** Tage von `from` bis `to`; im Fenster höchstens 20. */
function daysFrom(from: LocalDate, to: LocalDate): number {
  let days = 0;
  for (let day = from; day < to; day = localDateAfter(day, 1)) days += 1;
  return days;
}

/** Dieselbe heute gültige Zielversion mit denselben Werten, die die Regel nutzt. */
function sameGoal(a: GoalVersionValues, b: GoalVersionValues): boolean {
  return (
    a.validFrom === b.validFrom &&
    a.calorieBudgetMilliKcal === b.calorieBudgetMilliKcal &&
    a.lowerBoundMilliKcal === b.lowerBoundMilliKcal &&
    a.totalEnergyExpenditureMilliKcal === b.totalEnergyExpenditureMilliKcal &&
    a.pace === b.pace
  );
}
