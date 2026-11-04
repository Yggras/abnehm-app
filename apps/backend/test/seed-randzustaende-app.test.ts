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

/** Auswertung eines Tagesziels von Philipp auf dem iPhone zur Uhr des Manifests. */
function evaluation({ phones }: SeedWorld, dailyGoalId: string) {
  const goal = dumpLocalDatabase(phones[iphone]!.database).rows.daily_goal!.find((row) => row.id === dailyGoalId)!;
  return phones[iphone]!.database.read((tx) =>
    seedDailyGoalRegistry().evaluateDailyGoal(tx, DailyGoalSnapshot.parse(goal.snapshot), Instant.parse(seedClock.instant)));
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

  it('nach_erfuellung_korrigiert: Wasser ist wieder teilweise, die Erfüllung bleibt festgehalten („bereits gutgeschrieben“)', async () => {
    const world = await seeded(seedManifests.nach_erfuellung_korrigiert);
    await runSteps(world);

    expect(evaluation(world, seedIds.dailyGoal.philippHeute[1])).toMatchObject({
      type: 'evaluated',
      currentState: 'teilweise',
      progress: { countedMl: 2_000, targetMl: 2_500 },
      completion: { type: 'festgehalten', firstCompletedAt: '2026-10-14T11:30:00.000Z' },
    });
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

describe('Randzustand veralteter_partnerstand', () => {
  it('Philipps Gerät zeigt nach dem Sync Annas neuen Tageszielstand mit aktuellem Datenstand', async () => {
    const world = await seeded(seedManifests.veralteter_partnerstand);
    const partner = () => world.phones[iphone]!.database.read((tx) => readPartnerCache(tx));
    expect(partner().dailyGoalStatus).toMatchObject({ stage: 'unterwegs', dataAsOf: '2026-10-14T06:30:00.000Z' });

    await runSteps(world);

    expect(partner().dailyGoalStatus).toMatchObject({ id: seedIds.partnerDailyGoalStatus.anna, stage: 'fast_geschafft', dataAsOf: seedClock.instant });
  });
});
