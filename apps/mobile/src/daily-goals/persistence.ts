import { and, asc, eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import {
  dailyGoalCompletionId,
  dailyGoalKey,
  DailyGoalSnapshot,
  planChangeDays,
  type DailyGoalCause,
} from '@abnehm/contracts/daily-goals';
import {
  CompleteDailyGoalPayload,
  dailyBonusKey,
  energyBookingId,
  GrantDailyBonusPayload,
} from '@abnehm/contracts/energy';

import { appendBooking, bookingByKey, energyBookingEntity, removeUnconfirmedBooking } from '../energy';
import type { TransactionContext } from '../local-db';
import { dailyGoal } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { AffectedDay, CanonicalChangesHook, LocalCommand, SyncEntityAdapter, SyncWriter } from '../sync';
import { completionsOfDay, dailyGoalCompletionEntity, insertCompletion, removeUnconfirmedCompletion } from './completion';
import { markDaysChanged, type DaysChangedDispatcher } from './days-changed';
import type { DailyGoalRegistry } from './registry';

// Persistenzdienst der Tagesziele (Spezifikation 0, Abschnitt 3). Jede lokale Änderung, Rückgängig-
// Aktion, Health-Import, Pull-Übernahme, App-Öffnung und jeder Tagesabschluss meldet die betroffenen Tage
// an `reevaluateDailyGoals`. Er läuft in derselben Transaktion, legt beim ersten dauerhaften Erfüllen
// genau eine Tageszielerfüllung samt `+1` an, sobald alle drei bestehen genau einmal den Tagesbonus, und
// schreibt die Dirty-Day-Marker für `onDaysChanged`. Eine spätere Korrektur nimmt nichts zurück.

/**
 * Legt fehlende Tagesziele an, bevor der Dienst auswertet. Spezifikation 1 registriert hier die
 * Materialisierung ihres 7-Tage-Nachholfensters und entscheidet selbst, welche der Tage sie anlegt.
 */
export type MissingDaysHook = (
  tx: TransactionContext,
  request: Readonly<{ personId: EntityId; localDates: readonly LocalDate[]; today: LocalDate }>,
) => void;

export type DailyGoalPersistence = {
  /**
   * Wertet die Tage in der Transaktion des Aufrufers aus. Tage nach heute legt er nicht an und bucht
   * dort nichts; sie gehen nur an das Nach-Commit-Signal. Haptik löst er nie aus: Darauf reagiert
   * Spezifikation 4 über die dauerhaften Schlüssel der Erfüllung bzw. Buchung.
   */
  reevaluateDailyGoals(tx: TransactionContext, personId: EntityId, localDates: readonly LocalDate[], cause: DailyGoalCause): void;
  /**
   * Haken der Sync-Engine: Nach einer Pull-Übernahme meldet er den alten und neuen Tag tagesbezogener
   * Entitäten mit `pull` und für neue Ziel- und Wochenplanversionen die Tage bis heute + 13 mit `planaenderung`.
   */
  onCanonicalChanges: CanonicalChangesHook;
  /** Genau ein Haken für fehlende Tage; Spezifikation 1 meldet ihn im Composition Root an. */
  registerMissingDaysHook(hook: MissingDaysHook): void;
};

export function createDailyGoalPersistence({
  registry,
  clock,
  writer,
  dispatcher,
}: {
  registry: DailyGoalRegistry;
  clock: Clock;
  writer: SyncWriter;
  dispatcher: Pick<DaysChangedDispatcher, 'deliver'>;
}): DailyGoalPersistence {
  let missingDays: MissingDaysHook | null = null;

  function reevaluateDailyGoals(tx: TransactionContext, personId: EntityId, localDates: readonly LocalDate[], cause: DailyGoalCause) {
    const reading = clock.read();
    const at = Instant.parse(reading.instant);
    const today = LocalDate.parse(reading.localDate);
    // Lokale Tage `YYYY-MM-DD` ordnen sich als Zeichenfolgen kalendarisch.
    const days = [...new Set(localDates)].sort();
    const due = days.filter((day) => day <= today);
    if (due.length > 0) missingDays?.(tx, { personId, localDates: due, today });
    for (const day of due) evaluateDay(tx, personId, day, at);
    markDaysChanged(tx, { personId, localDates: days, cause }, at);
    tx.afterCommit(() => void dispatcher.deliver());
  }

  function evaluateDay(tx: TransactionContext, personId: EntityId, localDate: LocalDate, at: Instant) {
    const goals = sqliteOf(tx)
      .select({ id: dailyGoal.id, snapshot: dailyGoal.snapshot })
      .from(dailyGoal)
      .where(and(eq(dailyGoal.personId, personId), eq(dailyGoal.localDate, localDate)))
      .orderBy(asc(dailyGoal.slot))
      .all();
    for (const goal of goals) {
      const snapshot = DailyGoalSnapshot.parse(goal.snapshot);
      const evaluation = registry.evaluateDailyGoal(tx, snapshot, at);
      // Ein Vertragsfehler eines Bereichs erzeugt nie Energie; die Oberfläche zeigt ihn über dieselbe Auswertung.
      if (evaluation.type === 'evaluated' && evaluation.currentState === 'erfuellt' && evaluation.completion.type === 'nie') {
        completeDailyGoal(tx, EntityId.parse(goal.id), snapshot, at);
      }
    }
    const completions = completionsOfDay(tx, personId, localDate);
    if (completions.length === 3 && bookingByKey(tx, dailyBonusKey(personId, localDate)) === null) {
      grantDailyBonus(tx, personId, localDate, completions.map((completion) => completion.id) as [EntityId, EntityId, EntityId], at);
    }
  }

  /** Tageszielerfüllung plus Gutschrift als ein Fachbefehl; IDs folgen aus dem Schlüssel. */
  function completeDailyGoal(tx: TransactionContext, dailyGoalId: EntityId, snapshot: DailyGoalSnapshot, at: Instant) {
    const { personId, localDate, slot, type: baustein } = snapshot;
    const key = dailyGoalKey(personId, localDate, slot);
    const completionId = dailyGoalCompletionId(key);
    const bookingId = energyBookingId(key);
    insertCompletion(tx, { id: completionId, dailyGoalId, personId, localDate, slot, baustein, firstCompletedAt: at, completionKey: key, createdAt: at });
    appendBooking(tx, { type: 'daily_goal_credit', id: bookingId, personId, amount: 1, localDate, bookingKey: key, createdAt: at,
      trigger: { dailyGoalCompletionId: completionId, slot } });
    writer.command(tx, {
      type: 'completeDailyGoal',
      businessKey: key,
      payload: CompleteDailyGoalPayload.parse({ dailyGoalId, localDate, slot, baustein, completedAt: at }),
      knownServerVersion: null,
      affectedRefs: [
        { entityType: dailyGoalCompletionEntity.entityType, entityId: completionId },
        { entityType: energyBookingEntity.entityType, entityId: bookingId },
      ],
      referencePaths: [],
    });
  }

  function grantDailyBonus(tx: TransactionContext, personId: EntityId, localDate: LocalDate, completionIds: [EntityId, EntityId, EntityId], at: Instant) {
    const key = dailyBonusKey(personId, localDate);
    const bookingId = energyBookingId(key);
    appendBooking(tx, { type: 'daily_bonus_credit', id: bookingId, personId, amount: 1, localDate, bookingKey: key, createdAt: at,
      trigger: { dailyGoalCompletionIds: completionIds } });
    writer.command(tx, {
      type: 'grantDailyBonus',
      businessKey: key,
      payload: GrantDailyBonusPayload.parse({ localDate, grantedAt: at }),
      knownServerVersion: null,
      affectedRefs: [{ entityType: energyBookingEntity.entityType, entityId: bookingId }],
      referencePaths: [],
    });
  }

  const onCanonicalChanges: CanonicalChangesHook = (tx, changes) => {
    const today = LocalDate.parse(clock.read().localDate);
    const reports = new Map<string, { personId: EntityId; cause: DailyGoalCause; days: Set<LocalDate> }>();
    const report = (personId: EntityId, cause: DailyGoalCause, days: readonly LocalDate[]) => {
      const key = `${personId}:${cause}`;
      const entry = reports.get(key) ?? { personId, cause, days: new Set<LocalDate>() };
      for (const day of days) entry.days.add(day);
      reports.set(key, entry);
    };
    for (const day of changes.flatMap((change): readonly AffectedDay[] => change.days)) {
      if (day.type === 'tag') report(day.personId, 'pull', [day.localDate]);
      else report(day.personId, 'planaenderung', planChangeDays(day.validFrom, today));
    }
    for (const { personId, cause, days } of reports.values()) reevaluateDailyGoals(tx, personId, [...days], cause);
  };

  return {
    reevaluateDailyGoals,
    onCanonicalChanges,
    registerMissingDaysHook(hook) {
      if (missingDays !== null) throw new Error('Der Haken für fehlende Tage ist schon angemeldet');
      missingDays = hook;
    },
  };
}

/**
 * Die beiden Fachbefehle für die lokale Befehls-Registry. Erzeugen darf sie nur der Persistenzdienst;
 * die Registry braucht sie für die Reconciliation einer dauerhaften Ablehnung. Dann verschwinden die
 * unbestätigten Zeilen; die nächste Auswertung des Tags legt sie gegebenenfalls neu an.
 */
export const dailyGoalCommands: readonly LocalCommand[] = [
  {
    type: 'completeDailyGoal',
    payload: CompleteDailyGoalPayload,
    referencePaths: [],
    apply: onlyThePersistenceService('completeDailyGoal'),
    reconcileRejected(tx, operation) {
      removeUnconfirmedBooking(tx, energyBookingId(operation.businessKey));
      removeUnconfirmedCompletion(tx, dailyGoalCompletionId(operation.businessKey));
    },
  },
  {
    type: 'grantDailyBonus',
    payload: GrantDailyBonusPayload,
    referencePaths: [],
    apply: onlyThePersistenceService('grantDailyBonus'),
    reconcileRejected(tx, operation) {
      removeUnconfirmedBooking(tx, energyBookingId(operation.businessKey));
    },
  },
];

/** Die Sync-Entitäten der Tagesziele und Energie; Spezifikation 4 liest sie, ohne sie zu schreiben. */
export const dailyGoalSyncEntities: readonly SyncEntityAdapter[] = [dailyGoalCompletionEntity, energyBookingEntity];

function onlyThePersistenceService(type: string): () => never {
  return () => {
    throw new Error(`${type} erzeugt nur der Persistenzdienst der Tagesziele`);
  };
}
