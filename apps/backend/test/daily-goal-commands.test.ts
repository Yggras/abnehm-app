import { describe, expect, it } from 'vitest';

import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { dailyGoalCompletionId, dailyGoalKey } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey, energyBookingId } from '@abnehm/contracts/energy';

import { dailyGoalCompletion, energyBooking, processedOperation } from '../src/db/schema/index.ts';
import { bookCounterBooking } from '../src/energy/bookings.ts';
import { createTestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { authorizationCases, personWithSession, registeredCommandCases } from './support/authorization.ts';
import { bonusOp, completeOp, dailyGoalCommandScenarios, insertDailyGoals } from './support/daily-goals.ts';
import { confirmPhotoDraftScenario } from './support/meal-photos.ts';
import { personTimeZoneScenario } from './support/person-time-zone.ts';
import { planCommandScenarios } from './support/plan.ts';
import { sharedActionCommandScenarios } from './support/shared-actions.ts';
import { installationB, pullAll, push } from './support/sync.ts';

// Nachweis für #105: `completeDailyGoal` und `grantDailyBonus` auf dem Server (Spezifikation 0,
// Abschnitte 3, 4 und 10). Der Server nimmt Erfüllung und Gutschrift atomar an, antwortet bei gleichem
// Schlüssel mit dem kanonischen Datensatz und lehnt ungültige Befehle dauerhaft ab.

const today = '2026-10-14';

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const goals = await insertDailyGoals(backend, anna.personId, today);
  const rows = async () => ({
    completions: await backend.database.db.select().from(dailyGoalCompletion),
    bookings: await backend.database.db.select().from(energyBooking),
  });
  return { backend, anna, goals, rows };
}

describe('completeDailyGoal', () => {
  it('legt Erfüllung und +1-Gutschrift atomar mit den aus dem Schlüssel abgeleiteten IDs an', async () => {
    const { backend, anna, goals, rows } = await setup();
    const [result] = await push(backend, anna.device, [completeOp(goals[1]!)]);
    const key = dailyGoalKey(EntityId.parse(anna.personId), LocalDate.parse(today), 2);

    expect(result).toMatchObject({ type: 'applied', changes: [
      { type: 'record', entityType: 'daily_goal_completion', entityId: dailyGoalCompletionId(key),
        data: { completionKey: key, slot: 2, baustein: 'wasserziel', firstCompletedAt: '2026-10-14T10:00:00.000Z' } },
      { type: 'record', entityType: 'energy_booking', entityId: energyBookingId(key),
        data: { type: 'daily_goal_credit', amount: 1, bookingKey: key, trigger: { dailyGoalCompletionId: dailyGoalCompletionId(key), slot: 2 } } },
    ] });
    const { completions, bookings } = await rows();
    expect(completions).toHaveLength(1);
    expect(bookings).toEqual([expect.objectContaining({ id: energyBookingId(key), amount: 1, dailyGoalCompletionId: dailyGoalCompletionId(key) })]);
  });

  it('zwei Geräte offline und Retry: genau eine Gutschrift, das zweite Gerät bekommt den kanonischen Datensatz', async () => {
    const { backend, anna, goals, rows } = await setup();
    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
    const fromA = completeOp(goals[1]!, { completedAt: '2026-10-14T10:00:00.000Z' });
    const fromB = completeOp(goals[1]!, { completedAt: '2026-10-14T10:05:00.000Z' });

    const [applied] = await push(backend, anna.device, [fromA]);
    const [duplicate] = await push(backend, second, [fromB], installationB);
    const [retry] = await push(backend, second, [fromB], installationB);

    expect(applied?.type).toBe('applied');
    expect(duplicate).toMatchObject({ type: 'already_applied', operationId: fromB.operationId, idMappings: [] });
    expect(duplicate?.type !== 'permanently_rejected' && duplicate?.changes).toEqual(applied?.type !== 'permanently_rejected' && applied?.changes);
    expect(retry).toEqual(duplicate);
    const { completions, bookings } = await rows();
    expect(completions).toEqual([expect.objectContaining({ firstCompletedAt: new Date('2026-10-14T10:00:00.000Z') })]);
    expect(bookings).toHaveLength(1);
    expect(await backend.database.db.select().from(processedOperation)).toHaveLength(2);
  });

  it('lehnt einen Schlüssel, der nicht zu Person, Tag und Platz passt, und ein fremdes Tagesziel dauerhaft ab', async () => {
    const { backend, anna, goals, rows } = await setup();
    const otherSlot = completeOp(goals[1]!, { businessKey: dailyGoalKey(EntityId.parse(anna.personId), LocalDate.parse(today), 1) });
    const wrongBaustein = completeOp(goals[1]!, { payload: { baustein: 'gewogen' } });
    const unknownGoal = completeOp({ ...goals[1]!, id: EntityId.parse('7a2e4c6b-1d3f-4b5a-8c9e-0f1a2b3c4d99') });
    const results = await push(backend, anna.device, [otherSlot, wrongBaustein, unknownGoal]);
    expect(results.map((result) => (result.type === 'permanently_rejected' ? result.error.code : result.type))).toEqual([
      'invalid_payload', 'invalid_payload', 'invalid_payload',
    ]);
    expect(await rows()).toEqual({ completions: [], bookings: [] });
  });

  it('liefert Erfüllung und Gutschrift per Pull auch an die zweite Installation', async () => {
    const { backend, anna, goals } = await setup();
    await push(backend, anna.device, [completeOp(goals[0]!)]);
    const { changes } = await pullAll(backend, anna.device);
    expect(changes.filter((change) => change.entityType !== 'person').map((change) => change.entityType)).toEqual([
      'daily_goal_completion', 'energy_booking',
    ]);
  });
});

describe('grantDailyBonus', () => {
  it('verlangt alle drei Erfüllungen des Tags', async () => {
    const { backend, anna, goals, rows } = await setup();
    await push(backend, anna.device, [completeOp(goals[0]!), completeOp(goals[1]!)]);
    const [early] = await push(backend, anna.device, [bonusOp(anna.personId, today)]);
    expect(early).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect((await rows()).bookings).toHaveLength(2);
  });

  it('bucht den Bonus genau einmal, auch von zwei Geräten', async () => {
    const { backend, anna, goals, rows } = await setup();
    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
    await push(backend, anna.device, goals.map((goal) => completeOp(goal)));
    const [applied] = await push(backend, anna.device, [bonusOp(anna.personId, today)]);
    const [duplicate] = await push(backend, second, [bonusOp(anna.personId, today)], installationB);
    const key = dailyBonusKey(EntityId.parse(anna.personId), LocalDate.parse(today));
    expect(applied).toMatchObject({ type: 'applied', changes: [{ entityType: 'energy_booking', entityId: energyBookingId(key),
      data: { type: 'daily_bonus_credit', amount: 1, bookingKey: key,
        trigger: { dailyGoalCompletionIds: ([1, 2, 3] as const).map((slot) => dailyGoalCompletionId(dailyGoalKey(EntityId.parse(anna.personId), LocalDate.parse(today), slot))) } } }] });
    expect(duplicate).toMatchObject({ type: 'already_applied' });
    expect((await rows()).bookings.filter((booking) => booking.type === 'daily_bonus_credit')).toHaveLength(1);
  });
});

describe('Gegenbuchung', () => {
  it('korrigiert mit exaktem Gegenzeichen, höchstens einmal, und lässt die Buchung unverändert', async () => {
    const { backend, anna, goals, rows } = await setup();
    await push(backend, anna.device, [completeOp(goals[0]!)]);
    const [credit] = (await rows()).bookings;
    const at = new Date('2026-10-15T08:00:00.000Z');
    const counter = await backend.database.db.transaction((tx) => bookCounterBooking(tx, { originalBookingId: EntityId.parse(credit!.id), at }));
    expect(counter.data).toMatchObject({ type: 'counter_booking', amount: -1, bookingKey: `gegenbuchung:${credit!.id}`,
      trigger: { originalBookingId: credit!.id, originalType: 'daily_goal_credit', originalAmount: 1 } });
    await expect(backend.database.db.transaction((tx) => bookCounterBooking(tx, { originalBookingId: EntityId.parse(credit!.id), at }))).rejects.toThrow();
    await expect(backend.database.db.transaction((tx) => bookCounterBooking(tx, { originalBookingId: counter.entityId, at }))).rejects.toThrow();
    const { bookings } = await rows();
    expect(bookings.map((booking) => booking.amount).reduce((sum, amount) => sum + amount, 0)).toBe(0);
    expect(bookings.find((booking) => booking.id === credit!.id)).toEqual(credit);
  });
});

describe('Autorisierung der Fachbefehle', () => {
  it('das Backend meldet genau diese Fachbefehle an; für jeden gibt es ein Szenario', async () => {
    const { backend } = await setup();
    // `updatePersonTimeZone` (#110), die gemeinsamen Aktionen (#107), die Fassungen (#128) und `confirmPhotoDraft` (#162) prüfen eigene Tests; hier stehen sie nur für die Vollständigkeit.
    const all = { ...dailyGoalCommandScenarios, ...planCommandScenarios, ...sharedActionCommandScenarios, updatePersonTimeZone: personTimeZoneScenario,
      confirmPhotoDraft: confirmPhotoDraftScenario } as unknown as Parameters<typeof registeredCommandCases>[1];
    expect(registeredCommandCases(backend, all).length).toBeGreaterThan(0);
  });

  for (const [command, scenario] of Object.entries(dailyGoalCommandScenarios)) {
    describe(command, () => {
      for (const testCase of authorizationCases({ ...scenario, command })) it(testCase.name, testCase.run, 20_000);
    });
  }
});
