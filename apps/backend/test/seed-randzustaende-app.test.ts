import { describe, expect, it } from 'vitest';

import { Instant } from '@abnehm/contracts/base';
import { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { seedClock, seedIds, seedManifests, type SeedRow } from '@abnehm/contracts/seeds';

import { readPartnerCache } from '../../mobile/src/partner-cache/index.ts';
import { dumpLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { dumpServer } from '../dev/seed/server-seed.ts';
import { seedDailyGoalRegistry } from '../../mobile/src/daily-goals/testing/seed-evaluators.ts';
import { runSteps, seeded, type SeedWorld } from './support/seed-world.ts';

// Nachweis für #113, fachlich: Was die Randzustände nach ihren Schritten zeigen und dass ihre lokal
// angelegten Fachbefehle den Server unverändert erreichen. Ausgangs- und Sollzustand prüft für jedes
// Manifest `seed-manifeste-app.test.ts`.

const iphone = 'philipp-iphone';
const withoutVersion = (rows: readonly SeedRow[] = []) => rows.map((row) => ({ ...row, server_version: null }));

/** Auswertung eines Tagesziels von Philipp auf dem iPhone, ohne `at` zur Uhr des Manifests. */
function evaluation({ phones }: SeedWorld, dailyGoalId: string, at: string = seedClock.instant) {
  const goal = dumpLocalDatabase(phones[iphone]!.database).rows.daily_goal!.find((row) => row.id === dailyGoalId)!;
  return phones[iphone]!.database.read((tx) =>
    seedDailyGoalRegistry().evaluateDailyGoal(tx, DailyGoalSnapshot.parse(goal.snapshot), Instant.parse(at)));
}

describe('Randzustände der Tagesziele', () => {
  it.each(['erfuellt', 'tagesende_offen', 'tagesende_abgeschlossen'] as const)(
    '%s: Der nächste Sync bringt Erfüllungen und Buchungen unverändert auf den Server',
    async (scenario) => {
      const world = await seeded(seedManifests[scenario]);
      await runSteps(world);
      const local = dumpLocalDatabase(world.phones[iphone]!.database);

      await world.phones[iphone]!.sync();

      const server = await dumpServer(world.backend.database.db);
      for (const table of ['daily_goal_completion', 'energy_booking']) expect(withoutVersion(server[table])).toEqual(withoutVersion(local.rows[table]));
      expect(dumpLocalDatabase(world.phones[iphone]!.database).outbox).toEqual([]);
    },
  );

  it('nach_erfuellung_korrigiert: Wasser ist wieder teilweise, die Erfüllung bleibt festgehalten („bereits gutgeschrieben“), keine Gegenbuchung', async () => {
    // Mit dem echten Wasserziel-Evaluator aus #178; die Korrektur kommt über den Pull und `reevaluateDailyGoals`.
    const world = await seeded(seedManifests.nach_erfuellung_korrigiert);
    expect(evaluation(world, seedIds.dailyGoal.philippHeute[1])).toMatchObject({ currentState: 'erfuellt', progress: { countedMl: 2_500 } });
    const bookingsBefore = dumpLocalDatabase(world.phones[iphone]!.database).rows.energy_booking ?? [];
    expect(bookingsBefore.map((row) => row.type)).toEqual(['daily_goal_credit']);

    await runSteps(world);

    expect(evaluation(world, seedIds.dailyGoal.philippHeute[1])).toMatchObject({
      type: 'evaluated',
      currentState: 'teilweise',
      progress: { countedMl: 2_000, targetMl: 2_500 },
      completion: { type: 'festgehalten', firstCompletedAt: '2026-10-14T11:30:00.000Z' },
    });
    const local = dumpLocalDatabase(world.phones[iphone]!.database);
    expect(local.rows.daily_goal_completion).toHaveLength(1);
    expect(withoutVersion(local.rows.energy_booking)).toEqual(withoutVersion(bookingsBefore));
    expect(local.outbox).toEqual([]);
  });

  it('tagesende_offen: Das Kalorienbudget zeigt bis zum Tagesende „tagesende“ und ist nie erfüllt', async () => {
    const world = await seeded(seedManifests.tagesende_offen);
    await runSteps(world);

    expect(evaluation(world, seedIds.dailyGoal.philippHeute[0])).toMatchObject({ type: 'evaluated', currentState: 'tagesende', dayClosed: false, completion: { type: 'nie' } });
    expect(evaluation(world, seedIds.dailyGoal.philippHeute[2])).toMatchObject({ currentState: 'erfuellt', completion: { type: 'festgehalten' } });
  });

  it('tagesende_abgeschlossen: Nach dem Tagesende ist das Kalorienbudget von gestern erfüllt', async () => {
    const world = await seeded(seedManifests.tagesende_abgeschlossen);
    expect(evaluation(world, seedIds.dailyGoal.philippGestern[0])).toMatchObject({ currentState: 'erfuellt', dayClosed: true, completion: { type: 'nie' } });

    await runSteps(world);

    expect(evaluation(world, seedIds.dailyGoal.philippGestern[0])).toMatchObject({
      currentState: 'erfuellt',
      progress: { intakeKcal: 2_010 },
      completion: { type: 'festgehalten', firstCompletedAt: seedClock.instant },
    });
  });
});

describe('Randzustände der Ernährung (#166) mit den echten Evaluatoren der Ernährung', () => {
  const [mealsGoal] = seedIds.dailyGoal.philippHeute;
  const nachTagesende = '2026-10-14T22:30:00.000Z';

  it.each([
    ['ernaehrung-offen', 'offen', 0],
    ['ernaehrung-teilweise', 'teilweise', 1],
  ] as const)('%s: „Ernährung erfasst“ ist %s mit %i Mahlzeiten, ohne Erfüllung', async (scenario, currentState, meals) => {
    const world = await seeded(seedManifests[scenario]);
    await runSteps(world);

    expect(evaluation(world, mealsGoal)).toMatchObject({
      type: 'evaluated', currentState, progress: { recordedMealCategories: meals, minimumMealCategories: 2 }, completion: { type: 'nie' },
    });
  });

  it('ernaehrung-erfuellt: Die App-Öffnung erfüllt „Ernährung erfasst“; der nächste Sync bringt Erfüllung und +1 unverändert auf den Server', async () => {
    const world = await seeded(seedManifests['ernaehrung-erfuellt']);
    await runSteps(world);
    expect(evaluation(world, mealsGoal)).toMatchObject({
      currentState: 'erfuellt', progress: { recordedMealCategories: 2 }, completion: { type: 'festgehalten', firstCompletedAt: seedClock.instant },
    });
    const local = dumpLocalDatabase(world.phones[iphone]!.database);

    await world.phones[iphone]!.sync();

    const server = await dumpServer(world.backend.database.db);
    for (const table of ['daily_goal_completion', 'energy_booking']) expect(withoutVersion(server[table])).toEqual(withoutVersion(local.rows[table]));
    expect(dumpLocalDatabase(world.phones[iphone]!.database).outbox).toEqual([]);
  });

  it('ernaehrung-nach-erfuellung-korrigiert: wieder teilweise, die Erfüllung bleibt festgehalten, keine Gegenbuchung', async () => {
    const world = await seeded(seedManifests['ernaehrung-nach-erfuellung-korrigiert']);
    expect(evaluation(world, mealsGoal)).toMatchObject({ currentState: 'erfuellt', completion: { type: 'festgehalten' } });

    await runSteps(world);

    expect(evaluation(world, mealsGoal)).toMatchObject({
      currentState: 'teilweise',
      progress: { recordedMealCategories: 1 },
      completion: { type: 'festgehalten', firstCompletedAt: '2026-10-14T11:00:00.000Z' },
    });
    const bookings = dumpLocalDatabase(world.phones[iphone]!.database).rows.energy_booking ?? [];
    expect(bookings.map((row) => row.type)).toEqual(['daily_goal_credit']);
  });

  it.each([
    ['kalorienbudget-unter-untergrenze', 1_881, 'offen'],
    ['kalorienbudget-im-budget', 2_010, 'erfuellt'],
    ['kalorienbudget-ueber-budget', 2_418, 'offen'],
  ] as const)('%s: vor dem Tagesende „tagesende“ mit %i kcal, nach dem Tagesabschluss %s', async (scenario, intakeKcal, afterDayEnd) => {
    const world = await seeded(seedManifests[scenario]);
    const [budgetGoal] = seedIds.dailyGoal.philippHeute;
    expect(evaluation(world, budgetGoal)).toMatchObject({
      currentState: 'tagesende', dayClosed: false, progress: { intakeKcal, budgetKcal: 2_417, lowerBoundKcal: 1_882 }, completion: { type: 'nie' },
    });

    await runSteps(world);

    expect(evaluation(world, budgetGoal, nachTagesende)).toMatchObject({
      currentState: afterDayEnd,
      dayClosed: true,
      progress: { intakeKcal },
      completion: afterDayEnd === 'erfuellt' ? { type: 'festgehalten', firstCompletedAt: nachTagesende } : { type: 'nie' },
    });
  });

  it('kalorienbudget-im-budget: Der nächste Sync bringt die Tagesende-Erfüllung auf den Server', async () => {
    const world = await seeded(seedManifests['kalorienbudget-im-budget']);
    await runSteps(world);

    await world.phones[iphone]!.sync();

    const server = await dumpServer(world.backend.database.db);
    expect(server.daily_goal_completion).toEqual([
      expect.objectContaining({ id: expect.any(String), baustein: 'im_kalorienbudget', slot: 1, first_completed_at: nachTagesende }),
    ]);
    expect((server.energy_booking ?? []).map((row) => row.type)).toEqual(['daily_goal_credit']);
    expect(dumpLocalDatabase(world.phones[iphone]!.database).outbox).toEqual([]);
  });
});

describe('Randzustand veralteter_partnerstand', () => {
  it('Philipps Gerät zeigt nach dem Sync Annas neuen Tageszielstand mit aktuellem Datenstand', async () => {
    const world = await seeded(seedManifests.veralteter_partnerstand);
    const partner = () => world.phones[iphone]!.database.read((tx) => readPartnerCache(tx));
    expect(partner().dailyGoalStatus).toMatchObject({ stage: 'unterwegs', dataAsOf: '2026-10-14T06:30:00.000Z' });

    await runSteps(world);

    expect(partner().dailyGoalStatus).toMatchObject({ id: seedIds.partnerDailyGoalStatus.anna, stage: 'fast_geschafft', dataAsOf: seedClock.instant });
  });
});
