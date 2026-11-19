/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { budgetvorschlagReadings, seedManifests } from '@abnehm/contracts/seeds';
import { weightTrend } from '@abnehm/contracts/tracker-rules';

import { fakeIntakeReader, fakeWeightTrendReader } from '../area-ports/testing/fakes';
import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher } from '../daily-goals';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../sync';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { budgetSuggestionEntity, createPlan, goalVersionEntity, weeklyPlanVersionEntity } from '.';

// Nachweis für #150: Die Seed-Szenarien „Budgetvorschlag fällig“ erreichen ihren Sollzustand über das echte
// Plan-Modul auf der geseedeten Gerätedatenbank, mit den Fixture-Adaptern der Ports aus #104. Deren Eingaben
// stammen aus dem Manifest (`budgetvorschlagReadings`); den Trend rechnen die Tracker-Regeln wie im echten
// `WeightTrendReader`. Wiederholtes Seeden stellt den Ausgangszustand wieder her, und der Schritt erreicht
// erneut denselben Sollzustand. Mit den echten Readern prüft `apps/backend/test/seed-manifeste-app.test.ts`.

const scenarios = ['budgetvorschlag-senken', 'budgetvorschlag-anheben'] as const;
const iphone = 'philipp-iphone';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function seededPhone(key: (typeof scenarios)[number]) {
  const manifest = seedManifests[key];
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(manifest.accounts[0]!.accountId);
  seedLocalDatabase(database, manifest, iphone);
  const clock = createTestClock(manifest.clock);
  const operationIds: string[] = [];
  const newId = () => EntityId.parse(operationIds.shift() ?? 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  const writer = createSyncWriter({ registry: createSyncRegistry([...foundationSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, budgetSuggestionEntity]), clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const plan = createPlan({
    database, clock, writer, persistence, newId,
    weightRecorder: { recordManualWeight: async () => { throw new Error('Die Prüfung legt kein Gewicht an'); } },
  });

  const personId = manifest.accounts[0]!.personId;
  const { dayWeights, intake } = budgetvorschlagReadings(key);
  const readers = {
    weightTrendReader: fakeWeightTrendReader({
      series: { [personId]: weightTrend(dayWeights).map(({ localDate, dayWeightG, trendG }) => ({ localDate: LocalDate.parse(localDate), dayWeightG, trendG })) },
    }),
    intakeReader: fakeIntakeReader({ [personId]: intake }),
  };

  return {
    manifest,
    dump: () => dumpLocalDatabase(database),
    reseed: () => seedLocalDatabase(database, manifest, iphone),
    /** Schritt `budgetvorschlag_pruefen`: Der Writer vergibt genau die Operations-IDs des Schritts. */
    async step() {
      for (const step of manifest.steps) {
        if (step.type !== 'budgetvorschlag_pruefen') throw new Error(`unerwarteter Schritt ${step.type}`);
        operationIds.push(...step.operationIds);
        await plan.checkBudgetSuggestion(readers);
        expect(operationIds.splice(0)).toEqual([]);
      }
    },
  };
}

describe.each(scenarios)('Seed-Szenario %s', (key) => {
  it('erreicht mit den Fixture-Adaptern den Sollzustand; erneutes Seeden und Prüfen ergibt denselben Stand', async () => {
    const phone = await seededPhone(key);
    expect(phone.dump()).toEqual(canonicalDevice(phone.manifest.initial.devices[iphone]!));

    await phone.step();
    expect(phone.dump()).toEqual(canonicalDevice(phone.manifest.target.devices[iphone]!));

    phone.reseed();
    expect(phone.dump()).toEqual(canonicalDevice(phone.manifest.initial.devices[iphone]!));
    await phone.step();
    expect(phone.dump()).toEqual(canonicalDevice(phone.manifest.target.devices[iphone]!));
  });
});
