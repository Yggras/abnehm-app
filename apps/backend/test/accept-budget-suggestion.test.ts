import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { acceptBudgetSuggestionKey, budgetSuggestionId, goalVersionId } from '@abnehm/contracts/plan';
import type { PushResult } from '@abnehm/contracts/sync';

import { budgetSuggestion, goalVersion } from '../src/db/schema/index.ts';
import { createTestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { insertDailyGoals } from './support/daily-goals.ts';
import { acceptedGoal, acceptOp, goalVersionOp, openSuggestion, referenceGoal, suggestionIdOf, suggestionOp } from './support/plan.ts';
import { installationB, pullAll, push, upsertOp } from './support/sync.ts';

// Nachweis für #151: der Fachbefehl `acceptBudgetSuggestion` (Spezifikation 1, Abschnitte 7 und 11) gegen
// die echte Hono-App mit isoliertem Postgres. Er legt atomar eine Zielversion ab morgen mit dem Budget des
// Vorschlags an und setzt den Vorschlag auf `angenommen`. Die Zielversion prüft er wie `createGoalVersion`;
// eine Wiederholung ist idempotent. Die Negativtests des Autorisierungsgerüsts aus #98 laufen mit den
// übrigen Fachbefehlen des Plans in `plan-commands.test.ts` (`planCommandScenarios`).

const day = (value: string) => LocalDate.parse(value);
const codeOf = (result: PushResult | undefined) => (result?.type === 'permanently_rejected' ? result.error.code : result?.type);

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const personId = EntityId.parse(anna.personId);
  const suggestionId = suggestionIdOf(anna.personId);
  // Erstplan von heute, dann der offene Vorschlag, wie ihn die App nacheinander pusht.
  await push(backend, anna.device, [goalVersionOp(anna.personId), suggestionOp(anna.personId)]);
  const rows = async () => ({
    goals: await backend.database.db.select().from(goalVersion).orderBy(goalVersion.validFrom),
    suggestions: await backend.database.db.select().from(budgetSuggestion).orderBy(budgetSuggestion.periodTo),
  });
  return { backend, anna, personId, suggestionId, rows };
}

describe('acceptBudgetSuggestion', () => {
  it('legt die Zielversion ab morgen mit dem Budget des Vorschlags an und setzt ihn in derselben Operation auf angenommen', async () => {
    const { backend, anna, personId, suggestionId, rows } = await setup();

    const [result] = await push(backend, anna.device, [acceptOp(anna.personId)]);

    expect(result).toMatchObject({ type: 'applied' });
    const changes = result!.type === 'applied' ? result!.changes ?? [] : [];
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'record', entityType: 'goal_version', entityId: goalVersionId(personId, day('2026-10-15')),
        data: expect.objectContaining({ validFrom: '2026-10-15', calorieBudgetMilliKcal: 1_770_000, budgetSource: 'budgetvorschlag' }) }),
      expect.objectContaining({ type: 'record', entityType: 'budget_suggestion', entityId: suggestionId, data: expect.objectContaining({ status: 'angenommen' }) }),
    ]));
    const { goals, suggestions } = await rows();
    expect(goals.map(({ validFrom, calorieBudgetMilliKcal, budgetSource }) => ({ validFrom, calorieBudgetMilliKcal, budgetSource }))).toEqual([
      { validFrom: '2026-10-14', calorieBudgetMilliKcal: 1_620_000, budgetSource: 'berechnet' },
      { validFrom: '2026-10-15', calorieBudgetMilliKcal: 1_770_000, budgetSource: 'budgetvorschlag' },
    ]);
    expect(goals[1]).toEqual(expect.objectContaining({ ...acceptedGoal, personId }));
    expect(suggestions).toEqual([expect.objectContaining({ id: suggestionId, ...openSuggestion, status: 'angenommen' })]);
  });

  it('ein zweites Gerät derselben Person erhält Zielversion und angenommenen Vorschlag mit dem Pull', async () => {
    const { backend, anna, personId, suggestionId } = await setup();
    await push(backend, anna.device, [acceptOp(anna.personId)]);

    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
    const { changes } = await pullAll(backend, second);

    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'goal_version', entityId: goalVersionId(personId, day('2026-10-15')) }),
      expect.objectContaining({ entityType: 'budget_suggestion', entityId: suggestionId, data: expect.objectContaining({ status: 'angenommen' }) }),
    ]));
  });

  it('ist bei Wiederholung idempotent: dieselbe Operation und die Annahme eines zweiten Geräts ergeben genau eine Zielversion', async () => {
    const { backend, anna, rows } = await setup();
    const operation = acceptOp(anna.personId);

    const [applied] = await push(backend, anna.device, [operation]);
    const [retry] = await push(backend, anna.device, [operation]);
    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
    const [fromSecond] = await push(backend, second, [acceptOp(anna.personId)], installationB);

    expect(retry).toEqual({ ...applied, type: 'already_applied' });
    expect(fromSecond).toMatchObject({ type: 'already_applied' });
    const { goals, suggestions } = await rows();
    expect(goals.filter((goal) => goal.validFrom === '2026-10-15')).toHaveLength(1);
    expect(suggestions).toEqual([expect.objectContaining({ status: 'angenommen' })]);
  });

  it('lehnt eine unstimmige Zielversion, ein anderes Budget, einen Tag im Zeitraum, einen fremden Schlüssel und einen unbekannten Vorschlag ab, ohne etwas zu ändern', async () => {
    const { backend, anna, personId, suggestionId, rows } = await setup();
    const before = await rows();

    const results = await push(backend, anna.device, [
      acceptOp(anna.personId, { goalVersion: { basalMetabolicRateMilliKcal: 1_600_000 } }),
      acceptOp(anna.personId, { goalVersion: { calorieBudgetMilliKcal: 1_720_000 } }),
      acceptOp(anna.personId, { goalVersion: { budgetSource: 'manuell' } }),
      acceptOp(anna.personId, { goalVersion: { validFrom: '2026-10-13' } }),
      acceptOp(anna.personId, { businessKey: acceptBudgetSuggestionKey(budgetSuggestionId(personId, day('2026-10-12'))) }),
      acceptOp(anna.personId, { suggestionId: budgetSuggestionId(personId, day('2026-10-12')) }),
    ]);

    expect(results.map(codeOf)).toEqual(Array(6).fill('invalid_payload'));
    expect(await rows()).toEqual(before);
    expect(before.suggestions).toEqual([expect.objectContaining({ id: suggestionId, status: 'offen' })]);
  });

  it.each(['abgelehnt', 'ueberholt'] as const)('lehnt einen Vorschlag im Status %s mit conflict samt kanonischem Stand ab', async (status) => {
    const { backend, anna, suggestionId, rows } = await setup();
    await push(backend, anna.device, [suggestionOp(anna.personId, { status })]);

    const [result] = await push(backend, anna.device, [acceptOp(anna.personId)]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' },
      canonical: { type: 'record', entityType: 'budget_suggestion', entityId: suggestionId, data: { status } } });
    expect((await rows()).goals.map((goal) => goal.validFrom)).toEqual(['2026-10-14']);
  });

  it('lehnt das Ersetzen einer wirksamen Fassung ab, nennt sie kanonisch und lässt den Vorschlag offen', async () => {
    const { backend, anna, personId, rows } = await setup();
    // Ein anderes Gerät hat Ziele ab morgen gespeichert und den Tag schon materialisiert. Den Vorschlag, den
    // diese Fassung überholt hat, setzt der Test zurück, als hätte dieses Gerät sie nicht gekannt.
    await push(backend, anna.device, [goalVersionOp(anna.personId, { payload: { validFrom: '2026-10-15', waterTargetMl: 2_000 } })]);
    await backend.database.db.update(budgetSuggestion).set({ status: 'offen' });
    await insertDailyGoals(backend, anna.personId, '2026-10-15');

    const [result] = await push(backend, anna.device, [acceptOp(anna.personId)]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' },
      canonical: { type: 'record', entityType: 'goal_version', entityId: goalVersionId(personId, day('2026-10-15')), data: { waterTargetMl: 2_000 } } });
    const { goals, suggestions } = await rows();
    expect(goals.at(-1)).toEqual(expect.objectContaining({ validFrom: '2026-10-15', calorieBudgetMilliKcal: referenceGoal.calorieBudgetMilliKcal, waterTargetMl: 2_000 }));
    expect(suggestions).toEqual([expect.objectContaining({ status: 'offen' })]);
  });

  it('überholt einen anderen offenen Vorschlag der Person, nicht aber den angenommenen', async () => {
    const { backend, anna, personId, suggestionId, rows } = await setup();
    const other = budgetSuggestionId(personId, day('2026-10-12'));
    await push(backend, anna.device, [upsertOp(other, { ...openSuggestion, periodFrom: '2026-09-22', periodTo: '2026-10-12' }, { entityType: 'budget_suggestion' })]);

    await push(backend, anna.device, [acceptOp(anna.personId)]);

    expect((await rows()).suggestions.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: other, status: 'ueberholt' },
      { id: suggestionId, status: 'angenommen' },
    ]);
  });

  it('ein Vorschlag mit dem Status angenommen ändert sich danach durch createGoalVersion nicht mehr', async () => {
    const { backend, anna, suggestionId } = await setup();
    await push(backend, anna.device, [acceptOp(anna.personId)]);

    await push(backend, anna.device, [goalVersionOp(anna.personId, { payload: { validFrom: '2026-10-16', waterTargetMl: 2_000 } })]);

    const [stored] = await backend.database.db.select().from(budgetSuggestion).where(eq(budgetSuggestion.id, suggestionId));
    expect(stored).toEqual(expect.objectContaining({ status: 'angenommen' }));
  });
});
