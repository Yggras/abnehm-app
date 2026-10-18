import { EntityId, Instant, LocalDate, type BausteinKey } from '@abnehm/contracts/base';
import type { DailyGoalEvaluation, DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';

import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import type { AnyBausteinEvaluator, BausteinEvaluator, DailyGoalSnapshotOf } from '../evaluators';
import { createDailyGoalRegistry } from '../registry';
import { insertCompletionForTest, insertDailyGoalForTest, insertPersonForTest } from './persisted';

// Konformitäts-Testkit, Teil 2: Erfüllung über den Orchestrator (Spezifikation 0, Abschnitt 3).
// Der Bereich nennt einen Snapshot, Fakten, die ihn erfüllen, und korrigierte Fakten danach; das Kit
// wertet über `evaluateDailyGoal` gegen eine echte SQLite-Datei aus und prüft, wie das Fundament die
// persistierte Tageszielerfüllung ergänzt. Die Fakten kommen aus dem Szenario statt aus dem
// Bereichsreader; den prüft der Bereich gegen seine Tabellen. Braucht `@jest-environment node`.

export type AsyncConformanceCase = { name: string; run(): Promise<void> };

export type CompletionScenario<K extends BausteinKey, Facts> = {
  evaluator: BausteinEvaluator<K, Facts>;
  snapshot: DailyGoalSnapshotOf<K>;
  /** Erfüllt den Baustein; beim Kalorienbudget nach `dayEndsAt`. */
  fulfilled: { at: Instant; facts: Facts };
  /** Später korrigierte Einträge, die den Baustein nicht mehr erfüllen. */
  corrected: { at: Instant; facts: Facts };
};

const uuid = (group: number, n: number) => `0d0a${group}000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GOAL = uuid(1, 1);
const COMPLETION = uuid(2, 1);
const OTHER_PERSON = EntityId.parse(uuid(3, 1));

export function completionConformanceCases<K extends BausteinKey, Facts>(
  scenario: CompletionScenario<K, Facts>,
): AsyncConformanceCase[] {
  const { snapshot } = scenario;
  const name = (text: string) => `${snapshot.type} · ${text}`;

  return [
    {
      name: name('ohne Tageszielerfüllung bleibt `completion` `nie`, auch wenn der Baustein erfüllt ist'),
      run: () =>
        withDailyGoal(scenario, ({ evaluate }) => {
          expectEvaluated(evaluate(scenario.fulfilled.at), 'erfuellt', { type: 'nie' });
        }),
    },
    {
      name: name('erstmals erfüllt: das Fundament ergänzt die festgehaltene Erfüllung'),
      run: () =>
        withDailyGoal(scenario, ({ evaluate, recordCompletion }) => {
          recordCompletion(scenario.fulfilled.at);
          expectEvaluated(evaluate(scenario.fulfilled.at), 'erfuellt', festgehalten(scenario.fulfilled.at));
        }),
    },
    {
      name: name('nach Erfüllung korrigiert: Zustand folgt den Einträgen, die Erfüllung bleibt'),
      run: () =>
        withDailyGoal(scenario, ({ evaluate, recordCompletion, setFacts }) => {
          recordCompletion(scenario.fulfilled.at);
          setFacts(scenario.corrected.facts);
          const evaluation = evaluate(scenario.corrected.at);
          if (evaluation.type !== 'evaluated' || evaluation.currentState === 'erfuellt') {
            fail(`Korrigierte Einträge erfüllen den Baustein noch: ${JSON.stringify(evaluation)}`);
          }
          expectEvaluated(evaluation, evaluation.currentState, festgehalten(scenario.fulfilled.at));
        }),
    },
    {
      name: name('erneute Auswertung: gleiches Ergebnis, erster Erfüllungszeitpunkt unverändert'),
      run: () =>
        withDailyGoal(scenario, ({ evaluate, recordCompletion, setFacts }) => {
          recordCompletion(scenario.fulfilled.at);
          setFacts(scenario.corrected.facts);
          const first = evaluate(scenario.corrected.at);
          setFacts(scenario.fulfilled.facts);
          evaluate(scenario.fulfilled.at);
          setFacts(scenario.corrected.facts);
          const again = evaluate(scenario.corrected.at);
          if (JSON.stringify(first) !== JSON.stringify(again)) fail(`Abweichende Auswertung: ${JSON.stringify([first, again])}`);
          setFacts(scenario.fulfilled.facts);
          expectEvaluated(evaluate(scenario.fulfilled.at), 'erfuellt', festgehalten(scenario.fulfilled.at));
        }),
    },
    {
      name: name('Erfüllungen anderer Plätze, Tage und Personen zählen nicht'),
      run: () =>
        withDailyGoal(scenario, ({ evaluate, recordOtherCompletions }) => {
          recordOtherCompletions(scenario.fulfilled.at);
          expectEvaluated(evaluate(scenario.fulfilled.at), 'erfuellt', { type: 'nie' });
        }),
    },
  ];
}

type Harness = {
  evaluate(at: Instant): DailyGoalEvaluation;
  setFacts(facts: unknown): void;
  recordCompletion(firstCompletedAt: Instant): void;
  recordOtherCompletions(firstCompletedAt: Instant): void;
};

async function withDailyGoal<K extends BausteinKey, Facts>(
  scenario: CompletionScenario<K, Facts>,
  work: (harness: Harness) => void,
): Promise<void> {
  const { snapshot, evaluator } = scenario;
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({
    openSqlite: files.openSqlite,
    onError: (error) => {
      throw error;
    },
  });
  try {
    const db: LocalDatabase = await databases.open('konformitaet');
    let facts: Facts = scenario.fulfilled.facts;
    const withScenarioFacts: BausteinEvaluator<K, Facts> = {
      baustein: evaluator.baustein,
      readFacts: () => facts,
      evaluate: (s, at, f) => evaluator.evaluate(s, at, f),
    };
    const registry = createDailyGoalRegistry({ bausteine: [withScenarioFacts as unknown as AnyBausteinEvaluator], checkIns: [] });
    db.transaction((tx) => {
      insertPersonForTest(tx, snapshot.personId);
      insertDailyGoalForTest(tx, GOAL, snapshot);
    });

    work({
      evaluate: (at) => db.read((tx) => registry.evaluateDailyGoal(tx, snapshot, at)),
      setFacts: (next) => {
        facts = next as Facts;
      },
      recordCompletion: (firstCompletedAt) =>
        db.transaction((tx) => insertCompletionForTest(tx, COMPLETION, GOAL, snapshot, firstCompletedAt)),
      recordOtherCompletions: (firstCompletedAt) =>
        db.transaction((tx) => {
          insertPersonForTest(tx, OTHER_PERSON);
          otherDailyGoals(snapshot).forEach((other, index) => {
            insertDailyGoalForTest(tx, uuid(1, index + 2), other);
            insertCompletionForTest(tx, uuid(2, index + 2), uuid(1, index + 2), other, firstCompletedAt);
          });
        }),
    });
  } finally {
    databases.lock();
    files.remove();
  }
}

/** Tagesziele derselben Person an einem anderen Platz und Tag und einer anderen Person am selben Tag. */
function otherDailyGoals(snapshot: DailyGoalSnapshot): DailyGoalSnapshot[] {
  const otherBaustein: DailyGoalSnapshot =
    snapshot.type === 'gewogen'
      ? { ...base(snapshot), type: 'wasserziel', targetMl: 1500 }
      : { ...base(snapshot), type: 'gewogen' };
  const nextDay = (iso: string) => new Date(Date.parse(iso) + 86_400_000).toISOString();
  return [
    { ...otherBaustein, slot: snapshot.slot === 3 ? 1 : ((snapshot.slot + 1) as 2 | 3) },
    {
      ...snapshot,
      localDate: LocalDate.parse(nextDay(`${snapshot.localDate}T00:00:00.000Z`).slice(0, 10)),
      dayEndsAt: Instant.parse(nextDay(snapshot.dayEndsAt)),
    },
    { ...snapshot, personId: OTHER_PERSON },
  ];
}

function base({ personId, localDate, slot, timeZone, dayEndsAt }: DailyGoalSnapshot) {
  return { personId, localDate, slot, timeZone, dayEndsAt };
}

const festgehalten = (firstCompletedAt: Instant) => ({ type: 'festgehalten' as const, firstCompletedAt });

function expectEvaluated(evaluation: DailyGoalEvaluation, state: string, completion: object): void {
  if (evaluation.type !== 'evaluated') fail(`Vertragsfehler statt Auswertung: ${JSON.stringify(evaluation)}`);
  if (evaluation.currentState !== state) fail(`Zustand ${evaluation.currentState} statt ${state}`);
  if (JSON.stringify(evaluation.completion) !== JSON.stringify(completion)) {
    fail(`completion ${JSON.stringify(evaluation.completion)} statt ${JSON.stringify(completion)}`);
  }
}

function fail(message: string): never {
  throw new Error(message);
}
