import { EntityId, Instant } from '@abnehm/contracts/base';
import {
  BudgetSuggestionRecord,
  BudgetSuggestionUpsert,
  CreateGoalVersion,
  CreateWeeklyPlanVersion,
  GoalVersionRecord,
  MaterializeDailyGoals,
  planVersionOfKey,
  type PlanVersionKind,
  WeeklyPlanVersionRecord,
} from '@abnehm/contracts/plan';
import type { EntityData } from '@abnehm/contracts/sync';

import { removeUnconfirmedDayCredits } from '../daily-goals';
import type { ReadContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { budgetSuggestion, goalVersion } from '../local-db/schema';
import { sqliteEntity, type AffectedDay, type LocalCommand, type SyncEntityAdapter } from '../sync';
import {
  applyWeeklyPlanRecord,
  planVersionValidity,
  removeUnconfirmedGoalVersion,
  removeUnconfirmedWeeklyPlan,
  tombstoneWeeklyPlan,
} from './plan-repository';
import { readBudgetSuggestion, writeBudgetSuggestion } from './budget-suggestion-repository';
import { removeUnconfirmedDailyGoals } from './daily-goal-repository';

// Ziel- und Wochenplanversion im App-Sync (Spezifikation 0, Abschnitt 10; Spezifikation 1, Abschnitt
// 11). Beide entstehen nur über die Fachbefehle `createGoalVersion` und `createWeeklyPlanVersion`, ohne
// generisches Upsert oder Löschen. Nach jeder Übernahme meldet die Engine ihre Gültigkeit an den
// Persistenzdienst; der meldet die Tage bis heute + 13 mit `planaenderung`.

const validityOf = (kind: PlanVersionKind) => (tx: ReadContext, entityId: EntityId): readonly AffectedDay[] => {
  const validity = planVersionValidity(tx, kind, entityId);
  return validity === undefined ? [] : [{ type: 'plan', ...validity }];
};

export const goalVersionEntity: SyncEntityAdapter = {
  ...sqliteEntity({
    entityType: 'goal_version',
    ownerField: 'personId',
    upsert: null,
    deletable: false,
    record: GoalVersionRecord,
    table: goalVersion,
    row: (entityId, data) => ({ ...data, id: entityId }),
    // Ohne generisches Upsert gibt es keine offene Operation dieser Entität, die erneut anzuwenden wäre.
    replay: () => {},
  }),
  affectedDays: validityOf('zielversion'),
};

/**
 * Eine Wochenplanversion ist eine Zeile samt ihren sieben Tagen; übernommen wird beides gemeinsam im
 * Repository. Deshalb passt `sqliteEntity` hier nicht, das genau eine Zeile kennt.
 */
export const weeklyPlanVersionEntity: SyncEntityAdapter<EntityData, WeeklyPlanVersionRecord> = {
  entityType: 'weekly_plan_version',
  ownerField: 'personId',
  upsert: null,
  deletable: false,
  record: WeeklyPlanVersionRecord,
  applyCanonical: (tx, record) => applyWeeklyPlanRecord(tx, record.entityId, record.data, record.serverVersion),
  applyTombstone: (tx, tombstone) => tombstoneWeeklyPlan(tx, tombstone.entityId, tombstone.deletedAt, tombstone.serverVersion),
  affectedDays: validityOf('wochenplan'),
  reconcileRejected(tx, { entityId, canonical }) {
    if (canonical === null) removeUnconfirmedWeeklyPlan(tx, entityId);
    else if (canonical.type === 'record') applyWeeklyPlanRecord(tx, entityId, canonical.data, canonical.serverVersion);
    else tombstoneWeeklyPlan(tx, entityId, canonical.deletedAt, canonical.serverVersion);
  },
};

/**
 * Budgetvorschlag (Spezifikation 1, Abschnitte 7 und 11): generisches Upsert innerhalb der eigenen
 * Eigentumsgrenze, Last-Write-Wins, ohne Löschen. Anlegen (`offen`), `abgelehnt` und `ueberholt` reisen so;
 * `angenommen` setzt nur der Fachbefehl `acceptBudgetSuggestion`. Einen Tag meldet er nicht: Der Hinweis
 * auf „Heute“ liest den Vorschlag bei jedem Commit neu.
 */
export const budgetSuggestionEntity = sqliteEntity({
  entityType: 'budget_suggestion',
  ownerField: 'personId',
  upsert: BudgetSuggestionUpsert,
  deletable: false,
  record: BudgetSuggestionRecord,
  table: budgetSuggestion,
  row: (entityId, data) => ({ ...data, id: entityId }),
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Prüfen oder Überholen.
  replay(tx, entityId, change) {
    if (change.type !== 'upsert_entity') return;
    const owner = readBudgetSuggestion(tx, entityId)?.record.personId ?? EntityId.parse(requireOwnPerson(tx).id);
    writeBudgetSuggestion(tx, entityId, owner, change.payload, Instant.parse(change.createdAt));
  },
});

/**
 * Die Fachbefehle für die lokale Befehls-Registry. Erzeugen darf sie nur das Plan-Modul, zusammen mit
 * Person und Tagesmeldung in einer Transaktion. Lehnt der Server eine Fassung oder eine Materialisierung
 * dauerhaft ab, verschwindet sie lokal, sofern er sie nie bestätigt hat.
 */
export const planCommands: readonly LocalCommand[] = [
  {
    type: 'createGoalVersion',
    payload: CreateGoalVersion,
    referencePaths: [],
    apply: onlyThePlanModule('createGoalVersion'),
    reconcileRejected(tx, operation) {
      const version = planVersionOfKey('zielversion', operation.businessKey);
      if (version !== null) removeUnconfirmedGoalVersion(tx, version.id);
    },
  },
  {
    type: 'createWeeklyPlanVersion',
    payload: CreateWeeklyPlanVersion,
    referencePaths: [],
    apply: onlyThePlanModule('createWeeklyPlanVersion'),
    reconcileRejected(tx, operation) {
      const version = planVersionOfKey('wochenplan', operation.businessKey);
      if (version !== null) removeUnconfirmedWeeklyPlan(tx, version.id);
    },
  },
  {
    type: 'materializeDailyGoals',
    payload: MaterializeDailyGoals,
    referencePaths: [],
    apply: onlyThePlanModule('materializeDailyGoals'),
    /**
     * Ohne angenommene Materialisierung gibt es den Tag auf dem Server nicht. Lokal verschwinden dann
     * seine unbestätigten Tagesziele samt Erfüllungen, Gutschriften und Tagesbonus (Spezifikation 0,
     * Abschnitt 10); der nächste Auslöser im Nachholfenster legt ihn neu an. Den Ersatz durch die
     * kanonische Fassung eines anderen Geräts liefert „Tagesziele auf dem Server“ (#133).
     */
    reconcileRejected(tx, operation) {
      const { localDate, goals } = MaterializeDailyGoals.parse(operation.payload);
      if (removeUnconfirmedDayCredits(tx, goals[0].snapshot.personId, localDate)) removeUnconfirmedDailyGoals(tx, goals.map(({ id }) => id));
    },
  },
];

function onlyThePlanModule(type: string): () => never {
  return () => {
    throw new Error(`${type} erzeugt nur das Plan-Modul`);
  };
}

