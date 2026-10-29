import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
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
} from '@abnehm/contracts/plan';
import type { Pace, WeightRecorder } from '@abnehm/contracts/ports';

import type { DailyGoalPersistence } from '../daily-goals';
import type { LocalDatabase, TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { updateOwnPerson, type SyncWriter } from '../sync';
import { goalVersionEntity, weeklyPlanVersionEntity } from './plan-entities';
import { readGoalVersion, readWeeklyPlan, writeGoalVersion, writeWeeklyPlan } from './plan-repository';
import { standardWeeklyPlan, type WeekChoice, type WeekChoiceError } from './weekly-plan';

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

/** Eingaben der Onboarding-Schritte 3–7; `null` übernimmt jeweils den Vorschlag des Zielrechners. */
export type GoalDraft = Readonly<{
  calculationSex: CalculationSex;
  birthDate: LocalDate;
  heightCm: number;
  /** Aktuelles Gewicht aus Schritt 3; zugleich das Startgewicht. */
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

export type Plan = Readonly<{
  /** Reine Vorschau über den Zielrechner mit dem Alter am heutigen Tag; schreibt nichts. */
  preview(draft: GoalDraft): GoalCalculatorResult;
  /**
   * Erstplan speichern (Onboarding-Schritt 8): erst das Startgewicht über den `WeightRecorder`, dann in
   * einer lokalen Transaktion samt Outbox die Personenfelder, die Zielversion und die Wochenplanversion ab
   * heute sowie die Meldung der Tage bis heute + 13 mit `planaenderung`. Der Onboarding-Stand bleibt
   * `begonnen`. Erneutes Speichern ersetzt die Fassungen desselben Tags und schreibt nur, was sich geändert hat.
   */
  saveInitialPlan(draft: InitialPlanDraft): Promise<InitialPlanResult>;
}>;

/**
 * Befehle des Plan-Moduls (Spezifikation 1, Abschnitt 1) über der Datenbank eines Kontos; die Abfrage des
 * gültigen Plans ist `planReaderOf`. Uhr, Zeitzone, lokale Transaktion und Outbox kommen über die Ports
 * des Fundaments; Tabellen anderer Bereiche liest und schreibt es nicht.
 */
export function createPlan(dependencies: PlanDependencies): Plan {
  const { database, clock, writer, persistence, weightRecorder, newId } = dependencies;

  const calculatorInput = (draft: GoalDraft, today: LocalDate): GoalCalculatorInput => ({
    calculationDate: today,
    calculationSex: draft.calculationSex,
    ageYears: ageOn(draft.birthDate, today),
    heightCm: draft.heightCm,
    weightG: draft.weightG,
    // Im Onboarding gibt es noch keinen Gewichtstrend; Basisgewicht der Prognose ist die Eingabe.
    weightTrendG: null,
    activityLevel: draft.activityLevel,
    pregnantOrBreastfeeding: draft.pregnantOrBreastfeeding,
    knownEatingDisorder: draft.knownEatingDisorder,
    goalWeightG: draft.goalWeightG,
    pace: draft.pace,
    manualBudgetKcal: draft.manualBudgetKcal,
    waterTargetMl: draft.waterTargetMl,
    weeklySportTargetMinutes: draft.weeklySportTargetMinutes,
  });

  return {
    preview: (draft) => calculateGoals(calculatorInput(draft, LocalDate.parse(clock.read().localDate))),

    async saveInitialPlan(draft) {
      // Eine Ablesung für Messzeitpunkt, Tag und Zeitstempel, damit alles zum selben Moment gehört.
      const reading = clock.read();
      const today = LocalDate.parse(reading.localDate);
      const at = Instant.parse(reading.instant);
      const input = calculatorInput(draft, today);
      const calculation = calculateGoals(input);
      const week = standardWeeklyPlan(draft);
      const errors = [...(calculation.type === 'ungueltig' ? calculation.errors : []), ...(week.type === 'ungueltig' ? week.errors : [])];
      if (calculation.type === 'ungueltig' || week.type === 'ungueltig') return { type: 'ungueltig', errors };

      const goal = CreateGoalVersion.parse(goalVersionOf({ validFrom: today, input, calculation }));
      const weeklyPlan = CreateWeeklyPlanVersion.parse({ validFrom: today, days: week.days });
      const personId = database.read((tx) => EntityId.parse(requireOwnPerson(tx).id));

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
        saveGoalVersion(tx, personId, goal, at);
        saveWeeklyPlan(tx, personId, weeklyPlan, at);
        persistence.reevaluateDailyGoals(tx, personId, planChangeDays(today, today), 'planaenderung');
      });
      return {
        type: 'gespeichert',
        validFrom: today,
        goalVersionId: goalVersionId(personId, today),
        weeklyPlanVersionId: weeklyPlanVersionId(personId, today),
      };
    },
  };

  /** Legt die Zielversion an oder ersetzt die desselben Tags; eine unveränderte bleibt ohne neuen Befehl. */
  function saveGoalVersion(tx: TransactionContext, personId: EntityId, goal: CreateGoalVersion, at: Instant) {
    const id = goalVersionId(personId, goal.validFrom);
    const stored = readGoalVersion(tx, id);
    if (stored !== undefined && sameValues(stored.values, goal)) return;
    writeGoalVersion(tx, id, personId, goal, at);
    writer.command(tx, {
      type: 'createGoalVersion',
      businessKey: planVersionKey('zielversion', personId, goal.validFrom, newId()),
      payload: goal,
      knownServerVersion: stored?.serverVersion ?? null,
      affectedRefs: [{ entityType: goalVersionEntity.entityType, entityId: id }],
      referencePaths: [],
    });
  }

  /** Legt die Wochenplanversion an oder ersetzt die desselben Tags; eine unveränderte bleibt ohne neuen Befehl. */
  function saveWeeklyPlan(tx: TransactionContext, personId: EntityId, weeklyPlan: CreateWeeklyPlanVersion, at: Instant) {
    const id = weeklyPlanVersionId(personId, weeklyPlan.validFrom);
    const stored = readWeeklyPlan(tx, id);
    if (stored !== undefined && sameValues(stored.days, weeklyPlan.days)) return;
    writeWeeklyPlan(tx, id, personId, weeklyPlan, at);
    writer.command(tx, {
      type: 'createWeeklyPlanVersion',
      businessKey: planVersionKey('wochenplan', personId, weeklyPlan.validFrom, newId()),
      payload: weeklyPlan,
      knownServerVersion: stored?.serverVersion ?? null,
      affectedRefs: [{ entityType: weeklyPlanVersionEntity.entityType, entityId: id }],
      referencePaths: [],
    });
  }
}

/** Gleiche fachliche Werte, unabhängig von der Reihenfolge der Felder. */
function sameValues(stored: object, next: object): boolean {
  const canonical = (value: object) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return canonical(stored) === canonical(next);
}

