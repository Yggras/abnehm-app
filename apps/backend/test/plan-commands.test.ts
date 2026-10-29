import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { goalVersionId, planVersionKey, weeklyPlanVersionId } from '@abnehm/contracts/plan';

import { goalVersion, person, projectionInvalidation, weeklyPlanDay, weeklyPlanVersion } from '../src/db/schema/index.ts';
import { postgresPlanReader } from '../src/plan/plan-reader.ts';
import { createTestBackend } from './support/app.ts';
import { call, defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { authorizationCases, personWithSession } from './support/authorization.ts';
import { coupledWorld } from './support/coupled-world.ts';
import { testSportProjector, testWaterProjector } from './support/partner-projectors.ts';
import { goalVersionOp, planCommandScenarios, referenceGoal, standardDays, weeklyPlanOp } from './support/plan.ts';
import { installationB, pullAll, push } from './support/sync.ts';

// Nachweis für #128: `createGoalVersion` und `createWeeklyPlanVersion` auf dem Server (Spezifikation 1,
// Abschnitte 4 und 11) sowie der `PlanReader` über Postgres, mit echter Hono-App und isoliertem Postgres.

const day = (value: string) => LocalDate.parse(value);
const codes = (results: readonly { type: string; error?: { code: string } }[]) =>
  results.map((result) => (result.type === 'permanently_rejected' ? result.error!.code : result.type));

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const rows = async () => ({
    goals: await backend.database.db.select().from(goalVersion),
    plans: await backend.database.db.select().from(weeklyPlanVersion),
    days: await backend.database.db.select().from(weeklyPlanDay),
  });
  return { backend, anna, personId: EntityId.parse(anna.personId), rows };
}

describe('createGoalVersion', () => {
  it('nimmt eine stimmige Zielversion an und antwortet mit dem kanonischen Datensatz', async () => {
    const { backend, anna, personId, rows } = await setup();

    const [result] = await push(backend, anna.device, [goalVersionOp(anna.personId)]);

    const id = goalVersionId(personId, day('2026-10-14'));
    expect(result).toMatchObject({
      type: 'applied',
      changes: [{ type: 'record', entityType: 'goal_version', entityId: id, data: { ...referenceGoal, personId } }],
    });
    expect((await rows()).goals).toEqual([expect.objectContaining({ id, personId, validFrom: '2026-10-14', calorieBudgetMilliKcal: 1_620_000 })]);
  });

  it('lehnt eine unstimmige Zielversion und ein Budget unter der Untergrenze dauerhaft ab', async () => {
    const { backend, anna, rows } = await setup();

    const results = await push(backend, anna.device, [
      goalVersionOp(anna.personId, { payload: { totalEnergyExpenditureMilliKcal: 2_423_000 } }),
      goalVersionOp(anna.personId, { payload: { calorieBudgetMilliKcal: 1_200_000 } }),
      goalVersionOp(anna.personId, { payload: { calorieBudgetMilliKcal: 1_400_000, budgetSource: 'manuell' } }),
      goalVersionOp(anna.personId, { payload: { calorieBudgetMilliKcal: 1_300_000, budgetSource: 'budgetvorschlag' } }),
      goalVersionOp(anna.personId, { payload: { waterTargetMl: 6_000 } }),
    ]);

    expect(codes(results)).toEqual(['invalid_payload', 'invalid_payload', 'invalid_payload', 'invalid_payload', 'invalid_payload']);
    expect((await rows()).goals).toEqual([]);
  });

  it('nimmt die Herkunft Budgetvorschlag nicht an; die entsteht nur mit acceptBudgetSuggestion', async () => {
    const { backend, anna, rows } = await setup();

    const [result] = await push(backend, anna.device, [
      goalVersionOp(anna.personId, { payload: { calorieBudgetMilliKcal: 1_765_000, budgetSource: 'budgetvorschlag' } }),
    ]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect((await rows()).goals).toEqual([]);
  });

  it('lehnt einen Schlüssel ab, dessen valid_from nicht zur Nutzlast passt', async () => {
    const { backend, anna, personId, rows } = await setup();

    const [result] = await push(backend, anna.device, [
      goalVersionOp(anna.personId, { businessKey: planVersionKey('zielversion', personId, day('2026-10-15'), EntityId.parse('4f6a8b0c-3d5e-4f7a-9b2c-4d6e8f0a2b01')) }),
    ]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect((await rows()).goals).toEqual([]);
  });

  it('hält genau eine Fassung je Person und valid_from; eine weitere desselben Tags ersetzt sie', async () => {
    const { backend, anna, personId, rows } = await setup();

    const [first] = await push(backend, anna.device, [goalVersionOp(anna.personId)]);
    const [second] = await push(backend, anna.device, [goalVersionOp(anna.personId, { payload: { waterTargetMl: 2_000 } })]);

    expect(codes([first!, second!])).toEqual(['applied', 'applied']);
    expect((await rows()).goals).toEqual([expect.objectContaining({ id: goalVersionId(personId, day('2026-10-14')), waterTargetMl: 2_000 })]);
  });

  it('wiederholt eine Operation nach verlorener Antwort mit demselben Ergebnis', async () => {
    const { backend, anna, rows } = await setup();
    const operation = goalVersionOp(anna.personId);

    const [applied] = await push(backend, anna.device, [operation]);
    const [retry] = await push(backend, anna.device, [operation]);

    expect(retry).toEqual({ ...applied, type: 'already_applied' });
    expect((await rows()).goals).toHaveLength(1);
  });

  it('invalidiert in derselben Transaktion die Partner-Zusammenfassungen aller Bereiche ab valid_from', async () => {
    const { backend, anna, personId } = await setup();

    await push(backend, anna.device, [goalVersionOp(anna.personId), weeklyPlanOp(anna.personId)]);

    const invalidations = await backend.database.db.select().from(projectionInvalidation);
    expect(invalidations).toEqual([
      expect.objectContaining({ ownerPersonId: personId, area: null, fromDate: '2026-10-14' }),
      expect.objectContaining({ ownerPersonId: personId, area: null, fromDate: '2026-10-14' }),
    ]);
  });
});

describe('createWeeklyPlanVersion', () => {
  it('nimmt sieben Wochentage mit je drei verschiedenen Bausteinen an', async () => {
    const { backend, anna, personId, rows } = await setup();

    const [result] = await push(backend, anna.device, [weeklyPlanOp(anna.personId)]);

    const id = weeklyPlanVersionId(personId, day('2026-10-14'));
    expect(result).toMatchObject({
      type: 'applied',
      changes: [{ type: 'record', entityType: 'weekly_plan_version', entityId: id, data: { validFrom: '2026-10-14', days: standardDays, personId } }],
    });
    const { plans, days } = await rows();
    expect(plans).toEqual([expect.objectContaining({ id, personId })]);
    expect(days).toHaveLength(7);
  });

  it('lehnt doppelte Bausteine, fehlende Tage und einen fremden valid_from im Schlüssel ab', async () => {
    const { backend, anna, rows } = await setup();
    const sechsTage = Object.fromEntries(Object.entries(standardDays).filter(([weekday]) => weekday !== 'sonntag'));

    const results = await push(backend, anna.device, [
      weeklyPlanOp(anna.personId, { days: { ...standardDays, montag: ['wasserziel', 'gewogen', 'wasserziel'] } }),
      weeklyPlanOp(anna.personId, { days: sechsTage }),
      weeklyPlanOp(anna.personId, { validFrom: '2026-10-15', businessKey: weeklyPlanOp(anna.personId).businessKey }),
    ]);

    expect(codes(results)).toEqual(['invalid_payload', 'invalid_payload', 'invalid_payload']);
    expect(await rows()).toEqual({ goals: [], plans: [], days: [] });
  });

  it('ersetzt die Tage einer weiteren Fassung desselben Tags', async () => {
    const { backend, anna, rows } = await setup();

    await push(backend, anna.device, [weeklyPlanOp(anna.personId)]);
    await push(backend, anna.device, [weeklyPlanOp(anna.personId, { days: { ...standardDays, mittwoch: ['gewogen', 'wasserziel', 'sporteinheit'] } })]);

    const { plans, days } = await rows();
    expect(plans).toHaveLength(1);
    expect(days.find((row) => row.weekday === 'mittwoch')).toMatchObject({ baustein1: 'gewogen', baustein3: 'sporteinheit' });
  });
});

describe('Sync der Fassungen', () => {
  it('liefert beide Fassungen per Pull an die zweite Installation derselben Person', async () => {
    const { backend, anna, personId } = await setup();
    await push(backend, anna.device, [goalVersionOp(anna.personId), weeklyPlanOp(anna.personId)]);
    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;

    const { changes } = await pullAll(backend, second);

    expect(changes.filter((change) => change.entityType !== 'person').map((change) => [change.entityType, change.entityId])).toEqual([
      ['goal_version', goalVersionId(personId, day('2026-10-14'))],
      ['weekly_plan_version', weeklyPlanVersionId(personId, day('2026-10-14'))],
    ]);
  });

  it('lehnt generisches Upsert und Löschen der Fassungen ab', async () => {
    const { backend, anna } = await setup();
    await push(backend, anna.device, [goalVersionOp(anna.personId)]);
    const id = goalVersionId(EntityId.parse(anna.personId), day('2026-10-14'));

    const reply = await call(backend, 'POST', '/v1/sync/push', anna.device, {
      schemaVersion: 3,
      installationId: installationB,
      operations: [{ type: 'delete_entity', operationId: EntityId.parse('c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e09'), entityType: 'goal_version', entityId: id,
        knownServerVersion: null, schemaVersion: 3, createdAt: '2026-10-14T12:00:00.000Z' }],
    });

    expect(reply.body).toMatchObject({ results: [{ type: 'permanently_rejected', error: { code: 'forbidden' } }] });
  });
});

describe('PlanReader über Postgres', () => {
  async function saved() {
    const context = await setup();
    await push(context.backend, context.anna.device, [goalVersionOp(context.anna.personId), weeklyPlanOp(context.anna.personId)]);
    const effectivePlan = (value: string) => context.backend.database.db.transaction((tx) => postgresPlanReader(tx).effectivePlan(context.personId, day(value)));
    return { ...context, effectivePlan };
  }

  it('liefert vor der ersten Fassung ausdrücklich den Leer-Zustand', async () => {
    const { backend, personId } = await setup();

    await expect(backend.database.db.transaction((tx) => postgresPlanReader(tx).effectivePlan(personId, day('2026-10-14')))).resolves.toEqual({
      type: 'leer',
      localDate: '2026-10-14',
    });
  });

  it('liefert an valid_from Zielversion und Wochenplantag, am Tag davor den Leer-Zustand', async () => {
    const { effectivePlan, personId } = await saved();

    await expect(effectivePlan('2026-10-13')).resolves.toEqual({ type: 'leer', localDate: '2026-10-13' });
    await expect(effectivePlan('2026-10-14')).resolves.toEqual({
      type: 'gueltig',
      localDate: '2026-10-14',
      goal: {
        id: goalVersionId(personId, day('2026-10-14')),
        validFrom: '2026-10-14',
        calorieBudgetMilliKcal: 1_620_000,
        lowerBoundMilliKcal: 1_514_000,
        maintenanceReason: null,
        pace: 'entspannt',
        goalWeightG: 76_000,
        waterTargetMl: 1_500,
        weeklySportTargetMinutes: 150,
      },
      weeklyPlanDay: {
        weeklyPlanVersionId: weeklyPlanVersionId(personId, day('2026-10-14')),
        validFrom: '2026-10-14',
        bausteine: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
      },
    });
  });

  it('folgt am Wochentagswechsel dem Wochenplantag und nimmt die Fassung mit dem größten valid_from ≤ Tag', async () => {
    const { backend, anna, effectivePlan } = await saved();
    await push(backend, anna.device, [goalVersionOp(anna.personId, { payload: { validFrom: '2026-10-19', waterTargetMl: 2_000 } })]);

    await expect(effectivePlan('2026-10-18')).resolves.toMatchObject({
      goal: { validFrom: '2026-10-14', waterTargetMl: 1_500 },
      weeklyPlanDay: { bausteine: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'] },
    });
    await expect(effectivePlan('2026-10-19')).resolves.toMatchObject({
      goal: { validFrom: '2026-10-19', waterTargetMl: 2_000 },
      weeklyPlanDay: { validFrom: '2026-10-14', bausteine: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] },
    });
  });
});

describe('Partnerdaten', () => {
  it('enthalten aus Zielversion und Personenfeldern nur das Sportwochenziel, keine Sicherheitsangaben', async () => {
    const world = await coupledWorld();
    for (const projector of [testWaterProjector({ planReader: postgresPlanReader }), testSportProjector({ planReader: postgresPlanReader })]) {
      world.backend.partnerProjections.registerProjector(projector as never);
    }
    const anna = world.anna;
    const pregnant = { ...referenceGoal, calorieBudgetMilliKcal: 2_120_000, deficitMilliKcal: null, maintenanceReason: 'sicherheits_check', pace: null,
      waterTargetMl: 2_250, weeklySportTargetMinutes: 210, goalWeightG: 77_700 };
    await world.backend.database.db.update(person).set({ pregnantOrBreastfeeding: true, knownEatingDisorder: true, heightCm: 168 })
      .where(eq(person.id, anna.personId));
    expect(codes(await push(world.backend, anna.device, [goalVersionOp(anna.personId, { payload: pregnant }), weeklyPlanOp(anna.personId)])))
      .toEqual(['applied', 'applied']);

    const reply = await call(world.backend, 'POST', '/v1/sync/pull', world.philipp.device, {
      schemaVersion: 3, installationId: installationB, cursor: null, pageToken: null,
    });
    expect(reply.status).toBe(200);
    // Philipps eigene Person gehört ihm; alles Übrige im Pull betrifft Anna.
    const { changes } = reply.body as { changes: { entityType: string; entityId: string }[] };
    const aboutAnna = changes.filter((change) => !(change.entityType === 'person' && change.entityId === world.philipp.personId));
    expect(aboutAnna.map((change) => change.entityType)).toEqual(['partner_summary', 'partner_summary', 'partner_daily_goal_status']);
    const serialized = JSON.stringify(aboutAnna);

    expect(serialized).toContain('"weeklyTargetMinutes":210');
    for (const forbidden of ['goal_version', 'weekly_plan_version', 'calorieBudget', 'lowerBound', 'basalMetabolicRate', 'totalEnergyExpenditure',
      'goalWeight', 'waterTarget', 'weeklySportTarget', 'maintenanceReason', 'pregnant', 'EatingDisorder', 'sicherheits_check', ':2250', ':77700']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe('Autorisierung der Fachbefehle', () => {
  for (const [command, scenario] of Object.entries(planCommandScenarios)) {
    describe(command, () => {
      for (const testCase of authorizationCases({ ...scenario, command })) it(testCase.name, testCase.run, 20_000);
    });
  }
});
