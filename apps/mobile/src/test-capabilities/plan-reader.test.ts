import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { seedDays, seedIds, seedManifests, SeedManifest } from '@abnehm/contracts/seeds';

import { PortContractError } from '../area-ports';
import { seedPlanReader } from './plan-reader';

// Nachweis für #171: Die PlanReader-Attrappe der Test-Artefakte liefert Zielversion und Wochenplan
// aus den Seed-Manifesten, über dieselbe Vertragsprüfung wie die echten Ports.

const philipp = EntityId.parse(seedIds.person.philipp);

it('liefert für Philipp im Szenario solo das Wasserziel und den Wochenplantag', async () => {
  const plan = await seedPlanReader().effectivePlan(philipp, LocalDate.parse(seedDays.heute));

  expect(plan).toMatchObject({
    type: 'gueltig',
    localDate: seedDays.heute,
    goal: { id: seedIds.goalVersion.philipp, waterTargetMl: 2500, weeklySportTargetMinutes: 150, pace: 'entspannt', maintenanceReason: null },
    weeklyPlanDay: { weeklyPlanVersionId: seedIds.weeklyPlanVersion.philipp, bausteine: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'] },
  });
});

it('ist vor dem Zielstart und für unbekannte Personen leer', async () => {
  const reader = seedPlanReader();

  expect(await reader.effectivePlan(philipp, LocalDate.parse('2026-09-30'))).toEqual({ type: 'leer', localDate: '2026-09-30' });
  expect(await reader.effectivePlan(EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b99'), LocalDate.parse(seedDays.heute)))
    .toMatchObject({ type: 'leer' });
});

it('lehnt widersprüchliche Zielversionen derselben ID in zwei Manifesten ab', () => {
  const solo = seedManifests.solo;
  const goals = solo.initial.server.goal_version!.map((row) => ({ ...row, water_target_ml: 1 }));
  const other = SeedManifest.parse({ ...solo, initial: { ...solo.initial, server: { ...solo.initial.server, goal_version: goals } } });

  expect(() => seedPlanReader([solo, other])).toThrow('PlanReader-Attrappe');
});

it('prüft seine Rückgaben gegen den Port-Vertrag', async () => {
  const solo = seedManifests.solo;
  const goals = solo.initial.server.goal_version!.map((row) => ({ ...row, water_target_ml: -1 }));
  const broken = SeedManifest.parse({ ...solo, initial: { ...solo.initial, server: { ...solo.initial.server, goal_version: goals } } });

  await expect(seedPlanReader([broken]).effectivePlan(philipp, LocalDate.parse(seedDays.heute))).rejects.toThrow(PortContractError);
});
