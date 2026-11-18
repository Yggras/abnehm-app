import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, localDateAfter, Weekday } from '@abnehm/contracts/base';
import { planChangeDays } from '@abnehm/contracts/daily-goals';
import type { ContractError } from '@abnehm/contracts/errors';
import { ageOn, calculateGoals, type GoalCalculatorInput, type GoalCalculatorResult, type GoalInputError } from '@abnehm/contracts/goal-calculator';
import type { ActivityLevel, CalculationSex } from '@abnehm/contracts/person';
import {
  CreateGoalVersion,
  CreateWeeklyPlanVersion,
  goalVersionId,
  goalVersionOf,
  planVersionKey,
  weeklyPlanVersionId,
  type WeeklyPlanDays,
} from '@abnehm/contracts/plan';
import type { Pace, WeightRecorder } from '@abnehm/contracts/ports';

import type { DailyGoalPersistence, MissingDaysHook } from '../daily-goals';
import type { LocalDatabase, ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson, requireOwnPerson } from '../local-db/person-header';
import { updateOwnPerson, type SyncWriter } from '../sync';
import { createDailyGoalMaterialization } from './daily-goals';
import { goalVersionEntity, weeklyPlanVersionEntity } from './plan-entities';
import { readGoalVersionOn, readWeeklyPlanOn, writeGoalVersion, writeWeeklyPlan, type GoalVersionValues, type StoredGoalVersion } from './plan-repository';
import { createPlanToday, type DailyGoalEvaluator, type PlanToday } from './today-contributions';
import { freeWeeklyPlan, standardWeeklyPlan, type WeekChoice, type WeekChoiceError, type WeeklyPlanDayError, type WeeklyPlanInput } from './weekly-plan';

export type PlanDependencies = Readonly<{
  /** Die geöffnete Kontodatenbank; jeder Befehl schreibt in genau einer Transaktion darin. */
  database: LocalDatabase;
  /** Zeitpunkt und lokaler Tag des Speicherns in der Zone des Geräts. */
  clock: Clock;
  /** Schreibt Person-Upsert und Fachbefehle in der Transaktion des Befehls. */
  writer: SyncWriter;
  /** Persistenzdienst der Tagesziele; neue Fassungen melden ihre Tage in derselben Transaktion. */
  persistence: Pick<DailyGoalPersistence, 'reevaluateDailyGoals'>;
  /** Port aus Spezifikation 3: legt das Startgewicht in seiner eigenen Transaktion an. */
  weightRecorder: WeightRecorder;
  newId: () => EntityId;
}>;

/**
 * Eingaben des Zielrechners: im Onboarding aus den Schritten 3–7, in den Einstellungen die bisherigen
 * Werte samt Änderung. `null` übernimmt jeweils den Vorschlag des Zielrechners.
 */
export type GoalDraft = Readonly<{
  calculationSex: CalculationSex;
  birthDate: LocalDate;
  heightCm: number;
  /** Aktuelles Gewicht; im Onboarding aus Schritt 3 und zugleich das Startgewicht. */
  weightG: number;
  activityLevel: ActivityLevel;
  pregnantOrBreastfeeding: boolean;
  knownEatingDisorder: boolean;
  goalWeightG: number | null;
  /** `null` wählt den Haltemodus. */
  pace: Pace | null;
  manualBudgetKcal: number | null;
  waterTargetMl: number | null;
  weeklySportTargetMinutes: number | null;
}>;

/** Der lokale Onboarding-Entwurf bei „Plan speichern“ in Schritt 8. */
export type InitialPlanDraft = GoalDraft &
  WeekChoice &
  Readonly<{
    /** In Schritt 3 einmal erzeugt; jedes erneute Speichern trifft dasselbe Startgewicht. */
    startWeightEntryId: EntityId;
  }>;

export type InitialPlanResult =
  | Readonly<{ type: 'gespeichert'; validFrom: LocalDate; goalVersionId: EntityId; weeklyPlanVersionId: EntityId }>
  /** Der Entwurf verletzt eine Eingabegrenze oder die Wahl der Wochentage; geschrieben wurde nichts. */
  | Readonly<{ type: 'ungueltig'; errors: (GoalInputError | WeekChoiceError)[] }>
  /** Der `WeightRecorder` hat das Startgewicht abgelehnt; geschrieben wurde nichts weiter. */
  | Readonly<{ type: 'startgewicht_abgelehnt'; error: ContractError }>;

export type GoalChangeResult =
  | Readonly<{ type: 'gespeichert'; validFrom: LocalDate; goalVersionId: EntityId }>
  /** Diese Werte gelten ab morgen ohnehin; es entstand keine Fassung. */
  | Readonly<{ type: 'unveraendert'; validFrom: LocalDate }>
  /** Der Entwurf verletzt eine Eingabegrenze; geschrieben wurde nichts. */
  | Readonly<{ type: 'ungueltig'; errors: GoalInputError[] }>;

export type WeeklyPlanChangeResult =
  | Readonly<{ type: 'gespeichert'; validFrom: LocalDate; weeklyPlanVersionId: EntityId }>
  | Readonly<{ type: 'unveraendert'; validFrom: LocalDate }>
  | Readonly<{ type: 'ungueltig'; errors: WeeklyPlanDayError[] }>;

/** Feld einer Zielversion, das sich mit einer bevorstehenden Fassung ändern kann. */
export type GoalVersionField = Exclude<keyof GoalVersionValues, 'validFrom'>;

/**
 * Einstellungsansicht (Spezifikation 1, Abschnitt 10): je Art die heute gültige Fassung und eine
 * bevorstehende „ab morgen“ samt den Werten, die sich ändern. Ändert sie nichts, gibt es keine.
 */
export type PlanSettings = Readonly<{
  today: LocalDate;
  goal: Readonly<{
    current: GoalVersionValues | null;
    upcoming: Readonly<{ version: GoalVersionValues; changed: readonly GoalVersionField[] }> | null;
  }>;
  weeklyPlan: Readonly<{
    current: Readonly<{ validFrom: LocalDate; days: WeeklyPlanDays }> | null;
    upcoming: Readonly<{ validFrom: LocalDate; days: WeeklyPlanDays; changedWeekdays: readonly Weekday[] }> | null;
  }>;
}>;

export type Plan = Readonly<{
  /** Reine Vorschau über den Zielrechner mit dem Alter am heutigen Tag; schreibt nichts. */
  preview(draft: GoalDraft): GoalCalculatorResult;
  /**
   * Erstplan speichern (Onboarding-Schritt 8): erst das Startgewicht über den `WeightRecorder`, dann in
   * einer lokalen Transaktion samt Outbox die Personenfelder, die Zielversion und die Wochenplanversion ab
   * heute sowie die Meldung der Tage bis heute + 13 mit `planaenderung`. Der Onboarding-Stand bleibt
   * `begonnen`. Gilt heute schon ein Plan, etwa nach „Zurück“, legt erneutes Speichern wie jede spätere
   * Änderung nur geänderte Fassungen ab morgen an; die heutigen Tagesziele behalten die Werte des ersten
   * Speicherns ([Entscheidung in #134](https://github.com/Yggras/abnehm-app/issues/134#issuecomment-6976513509)).
   */
  saveInitialPlan(draft: InitialPlanDraft): Promise<InitialPlanResult>;
  /**
   * Ziele ändern (Spezifikation 1, Abschnitte 4 und 10): eine vollständige Zielversion ab morgen mit
   * denselben Prüfungen wie beim Erstplan, in einer lokalen Transaktion samt `createGoalVersion` und der
   * Meldung der Tage von morgen bis heute + 13 mit `planaenderung`. Eine weitere Änderung am selben Tag
   * ersetzt die noch nicht wirksame Fassung. Gleichen die Werte der ab morgen ohnehin gültigen Fassung,
   * entsteht nichts. Nennt der Entwurf als manuelles Budget genau das Budget einer Fassung aus einem
   * angenommenen Budgetvorschlag, bleibt es samt Herkunft erhalten. Personenfelder schreibt der Befehl nicht.
   */
  changeGoals(draft: GoalDraft): GoalChangeResult;
  /**
   * Wochenplan ändern (Spezifikation 1, Abschnitte 4 und 10): jeder Wochentag frei mit drei verschiedenen
   * Bausteinen, mehrere oder keine Wiegetage. Gültig ab morgen, sonst wie „Ziele ändern“.
   */
  changeWeeklyPlan(days: WeeklyPlanInput): WeeklyPlanChangeResult;
  /** Einstellungsansicht der eigenen Person für die Seiten „Ziele“ und „Wochenplan“. */
  settings(): PlanSettings;
  /**
   * Tagesziele sicherstellen (Spezifikation 1, Abschnitt 5), bei jedem Auslöser: App-Start, Rückkehr in
   * den Vordergrund und lokaler Tageswechsel bei geöffneter App. In einer lokalen Transaktion legt es
   * heute und die fehlenden Tage der letzten 7 lokalen Tage an, nie vor dem ersten `valid_from`, und
   * meldet jeden materialisierten Tag des Fensters mit abgelaufenem `dayEndsAt` mit `tagesabschluss` an
   * `reevaluateDailyGoals`. Ohne eigene Person tut es nichts.
   */
  ensureDailyGoals(): void;
  /**
   * Materialisierung für den Haken fehlender Tage am Persistenzdienst; der Composition Root meldet sie
   * mit `registerMissingDaysHook` an. Ein Eintrag für einen fehlenden Tag im Nachholfenster legt den Tag
   * dann in derselben Transaktion an, bevor der Dienst ihn auswertet.
   */
  materializeMissingDays: MissingDaysHook;
  /**
   * „Heute“-Beiträge `momo.daily_goals` und `nutrition.budget` (Spezifikation 1, Abschnitt 6). Sie werten
   * mit derselben Registry aus wie der Persistenzdienst der Tagesziele.
   */
  today(dailyGoals: DailyGoalEvaluator): PlanToday;
}>;

/**
 * Befehle und Abfragen des Plan-Moduls (Spezifikation 1, Abschnitt 1) über der Datenbank eines Kontos;
 * die Abfrage des gültigen Plans ist `planReaderOf`. Uhr, Zeitzone, lokale Transaktion und Outbox kommen
 * über die Ports des Fundaments; Tabellen anderer Bereiche liest und schreibt es nicht.
 */
export function createPlan(dependencies: PlanDependencies): Plan {
  const { database, clock, writer, persistence, weightRecorder, newId } = dependencies;
  const dailyGoals = createDailyGoalMaterialization({ clock, writer, persistence });

  return {
    preview: (draft) => calculateGoals(calculatorInput(draft, readClock().today)),

    async saveInitialPlan(draft) {
      // Eine Ablesung für Messzeitpunkt, Tag und Zeitstempel, damit alles zum selben Moment gehört.
      const { today, tomorrow, at } = readClock();
      const { personId, validFrom, inForce } = database.read((tx) => {
        const own = EntityId.parse(requireOwnPerson(tx).id);
        const from = hasPlanOn(tx, own, today) ? tomorrow : today;
        return { personId: own, validFrom: from, inForce: readGoalVersionOn(tx, own, from) };
      });
      const goal = goalVersionFor(draft, validFrom, inForce);
      const week = standardWeeklyPlan(draft);
      const errors = [...(goal.type === 'ungueltig' ? goal.errors : []), ...(week.type === 'ungueltig' ? week.errors : [])];
      if (goal.type === 'ungueltig' || week.type === 'ungueltig') return { type: 'ungueltig', errors };
      const weeklyPlan = CreateWeeklyPlanVersion.parse({ validFrom, days: week.days });

      const recorded = await weightRecorder.recordManualWeight({ entryId: draft.startWeightEntryId, personId, weightG: draft.weightG, measuredAt: at });
      if (recorded.type === 'contract_error') return { type: 'startgewicht_abgelehnt', error: recorded.error };

      database.transaction((tx) => {
        updateOwnPerson(tx, writer, {
          calculationSex: draft.calculationSex,
          birthDate: draft.birthDate,
          heightCm: draft.heightCm,
          activityLevel: draft.activityLevel,
          pregnantOrBreastfeeding: draft.pregnantOrBreastfeeding,
          knownEatingDisorder: draft.knownEatingDisorder,
        }, at);
        const goalSaved = saveGoalVersion(tx, personId, goal.version, at);
        const weeklyPlanSaved = saveWeeklyPlan(tx, personId, weeklyPlan, at);
        // „Erstplan speichern“ ist ein Auslöser: Die heutigen Tagesziele entstehen mit den Fassungen und
        // werden sofort ausgewertet, sodass ein Startgewicht am Wiegetag „Gewogen“ erfüllt. Wie jeder
        // Auslöser holt er fehlende Tage nach und meldet abgelaufene mit `tagesabschluss` (#131). Die
        // Tage ab `validFrom` meldet die Planänderung.
        dailyGoals.ensure(tx, personId, { reportCreatedOpenDays: false });
        if (goalSaved || weeklyPlanSaved) persistence.reevaluateDailyGoals(tx, personId, planChangeDays(validFrom, today), 'planaenderung');
      });
      return {
        type: 'gespeichert',
        validFrom,
        goalVersionId: goalVersionId(personId, validFrom),
        weeklyPlanVersionId: weeklyPlanVersionId(personId, validFrom),
      };
    },

    changeGoals(draft) {
      const { today, tomorrow, at } = readClock();
      return database.transaction((tx): GoalChangeResult => {
        const personId = EntityId.parse(requireOwnPerson(tx).id);
        const goal = goalVersionFor(draft, tomorrow, readGoalVersionOn(tx, personId, tomorrow));
        if (goal.type === 'ungueltig') return goal;
        if (!saveGoalVersion(tx, personId, goal.version, at)) return { type: 'unveraendert', validFrom: tomorrow };
        persistence.reevaluateDailyGoals(tx, personId, planChangeDays(tomorrow, today), 'planaenderung');
        return { type: 'gespeichert', validFrom: tomorrow, goalVersionId: goalVersionId(personId, tomorrow) };
      });
    },

    changeWeeklyPlan(days) {
      const { today, tomorrow, at } = readClock();
      const week = freeWeeklyPlan(days);
      if (week.type === 'ungueltig') return week;
      const weeklyPlan = CreateWeeklyPlanVersion.parse({ validFrom: tomorrow, days: week.days });
      return database.transaction((tx): WeeklyPlanChangeResult => {
        const personId = EntityId.parse(requireOwnPerson(tx).id);
        if (!saveWeeklyPlan(tx, personId, weeklyPlan, at)) return { type: 'unveraendert', validFrom: tomorrow };
        persistence.reevaluateDailyGoals(tx, personId, planChangeDays(tomorrow, today), 'planaenderung');
        return { type: 'gespeichert', validFrom: tomorrow, weeklyPlanVersionId: weeklyPlanVersionId(personId, tomorrow) };
      });
    },

    settings() {
      const { today, tomorrow } = readClock();
      return database.read((tx) => {
        const personId = EntityId.parse(requireOwnPerson(tx).id);
        const currentGoal = readGoalVersionOn(tx, personId, today)?.values ?? null;
        const nextGoal = readGoalVersionOn(tx, personId, tomorrow)?.values;
        const changed = nextGoal === undefined || nextGoal.validFrom <= today ? [] : changedGoalFields(currentGoal, nextGoal);
        const currentPlan = readWeeklyPlanOn(tx, personId, today);
        const nextPlan = readWeeklyPlanOn(tx, personId, tomorrow);
        const changedWeekdays = nextPlan === undefined || nextPlan.validFrom <= today
          ? []
          : Weekday.options.filter((weekday) => currentPlan === undefined || !sameValues(currentPlan.days[weekday], nextPlan.days[weekday]));
        return {
          today,
          goal: { current: currentGoal, upcoming: nextGoal !== undefined && changed.length > 0 ? { version: nextGoal, changed } : null },
          weeklyPlan: {
            current: currentPlan === undefined ? null : { validFrom: currentPlan.validFrom, days: currentPlan.days },
            upcoming: nextPlan !== undefined && changedWeekdays.length > 0 ? { validFrom: nextPlan.validFrom, days: nextPlan.days, changedWeekdays } : null,
          },
        };
      });
    },

    ensureDailyGoals() {
      database.transaction((tx) => {
        const own = readOwnPerson(tx);
        if (own !== undefined) dailyGoals.ensure(tx, EntityId.parse(own.id));
      });
    },

    materializeMissingDays: dailyGoals.missingDaysHook,

    today: (evaluator) => createPlanToday({ database, clock, dailyGoals: evaluator }),
  };

  /** Heute, morgen und der Zeitpunkt aus einer Ablesung der Uhr. */
  function readClock() {
    const reading = clock.read();
    const today = LocalDate.parse(reading.localDate);
    return { today, tomorrow: localDateAfter(today, 1), at: Instant.parse(reading.instant) };
  }

  /**
   * Die vollständige Zielversion ab `validFrom` zu einem Entwurf. `inForce` ist die an diesem Tag ohne die
   * Änderung gültige Fassung: Trägt sie ein Budget aus einem angenommenen Budgetvorschlag und nennt der
   * Entwurf genau dieses als manuelles Budget, bleibt es samt Herkunft erhalten, auch außerhalb des
   * 10-kcal-Rasters. Der Server bindet die Herkunft ebenso an die vorige Fassung.
   */
  function goalVersionFor(
    draft: GoalDraft,
    validFrom: LocalDate,
    inForce: StoredGoalVersion | undefined,
  ): { type: 'gueltig'; version: CreateGoalVersion } | { type: 'ungueltig'; errors: GoalInputError[] } {
    const suggestedBudget = inForce?.values.budgetSource === 'budgetvorschlag' && draft.manualBudgetKcal !== null &&
      draft.manualBudgetKcal * 1_000 === inForce.values.calorieBudgetMilliKcal ? inForce.values.calorieBudgetMilliKcal : null;
    const input = calculatorInput({ ...draft, manualBudgetKcal: suggestedBudget === null ? draft.manualBudgetKcal : null }, validFrom);
    const calculation = calculateGoals(input);
    if (calculation.type === 'ungueltig') return calculation;
    const version = goalVersionOf({ validFrom, input, calculation });
    if (suggestedBudget === null) return { type: 'gueltig', version: CreateGoalVersion.parse(version) };
    if (calculation.manualBudgetRange === null) return { type: 'ungueltig', errors: ['manual_budget_in_forced_maintenance'] };
    const kept = CreateGoalVersion.safeParse({ ...version, calorieBudgetMilliKcal: suggestedBudget, budgetSource: 'budgetvorschlag' });
    return kept.success ? { type: 'gueltig', version: kept.data } : { type: 'ungueltig', errors: ['manual_budget_out_of_range'] };
  }

  /**
   * Legt die Zielversion an oder ersetzt die desselben Tags. Gleicht sie der an ihrem `validFrom` ohnehin
   * gültigen Fassung, entsteht nichts, und das Ergebnis ist `false`.
   */
  function saveGoalVersion(tx: TransactionContext, personId: EntityId, goal: CreateGoalVersion, at: Instant): boolean {
    const inForce = readGoalVersionOn(tx, personId, goal.validFrom);
    if (inForce !== undefined && sameValues({ ...inForce.values, validFrom: goal.validFrom }, goal)) return false;
    const id = goalVersionId(personId, goal.validFrom);
    writeGoalVersion(tx, id, personId, goal, at);
    writer.command(tx, {
      type: 'createGoalVersion',
      businessKey: planVersionKey('zielversion', personId, goal.validFrom, newId()),
      payload: goal,
      knownServerVersion: inForce?.values.validFrom === goal.validFrom ? inForce.serverVersion : null,
      affectedRefs: [{ entityType: goalVersionEntity.entityType, entityId: id }],
      referencePaths: [],
    });
    return true;
  }

  /** Wie `saveGoalVersion` für die Wochenplanversion samt ihrer sieben Tage. */
  function saveWeeklyPlan(tx: TransactionContext, personId: EntityId, weeklyPlan: CreateWeeklyPlanVersion, at: Instant): boolean {
    const inForce = readWeeklyPlanOn(tx, personId, weeklyPlan.validFrom);
    if (inForce !== undefined && sameValues(inForce.days, weeklyPlan.days)) return false;
    const id = weeklyPlanVersionId(personId, weeklyPlan.validFrom);
    writeWeeklyPlan(tx, id, personId, weeklyPlan, at);
    writer.command(tx, {
      type: 'createWeeklyPlanVersion',
      businessKey: planVersionKey('wochenplan', personId, weeklyPlan.validFrom, newId()),
      payload: weeklyPlan,
      knownServerVersion: inForce?.validFrom === weeklyPlan.validFrom ? inForce.serverVersion : null,
      affectedRefs: [{ entityType: weeklyPlanVersionEntity.entityType, entityId: id }],
      referencePaths: [],
    });
    return true;
  }
}

function calculatorInput(draft: GoalDraft, calculationDate: LocalDate): GoalCalculatorInput {
  return {
    calculationDate,
    calculationSex: draft.calculationSex,
    ageYears: ageOn(draft.birthDate, calculationDate),
    heightCm: draft.heightCm,
    weightG: draft.weightG,
    // Die Zielversion speichert keine Prognose; Basisgewicht der Berechnung ist die Eingabe.
    weightTrendG: null,
    activityLevel: draft.activityLevel,
    pregnantOrBreastfeeding: draft.pregnantOrBreastfeeding,
    knownEatingDisorder: draft.knownEatingDisorder,
    goalWeightG: draft.goalWeightG,
    pace: draft.pace,
    manualBudgetKcal: draft.manualBudgetKcal,
    waterTargetMl: draft.waterTargetMl,
    weeklySportTargetMinutes: draft.weeklySportTargetMinutes,
  };
}

/** Ob an diesem Tag schon Zielversion und Wochenplanversion der Person gelten. */
function hasPlanOn(tx: ReadContext, personId: EntityId, localDate: LocalDate): boolean {
  return readGoalVersionOn(tx, personId, localDate) !== undefined && readWeeklyPlanOn(tx, personId, localDate) !== undefined;
}

/** Felder, in denen sich die bevorstehende Fassung von der heute gültigen unterscheidet; ohne diese alle. */
function changedGoalFields(current: GoalVersionValues | null, next: GoalVersionValues): GoalVersionField[] {
  return (Object.keys(next) as (keyof GoalVersionValues)[])
    .filter((field): field is GoalVersionField => field !== 'validFrom' && (current === null || current[field] !== next[field]));
}

/** Gleiche fachliche Werte, unabhängig von der Reihenfolge der Felder. */
function sameValues(stored: object, next: object): boolean {
  const canonical = (value: object) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return canonical(stored) === canonical(next);
}
