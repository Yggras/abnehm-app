import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { budgetSuggestionId, type BudgetSuggestionUpsert } from '@abnehm/contracts/plan';
import { PullResponse, PushResponse, type OutboxOperation, type PushResult } from '@abnehm/contracts/sync';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { budgetSuggestion as localBudgetSuggestion } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { budgetSuggestionEntity as localEntity } from '../../mobile/src/plan/index.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { policies } from '../src/authorization/authorization.ts';
import { budgetSuggestion } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, personWithSession, type AuthorizationWorld, type Outcome } from './support/authorization.ts';
import { deleteOp, pullRaw, push, pushRaw, upsertOp } from './support/sync.ts';

// Nachweis für #150: der Budgetvorschlag im Sync (Spezifikation 1, Abschnitte 7 und 11) gegen die echte
// Hono-App. Er reist als Upsert innerhalb der eigenen Eigentumsgrenze mit der deterministischen ID aus Person
// und Zeitraumende; ein zweites Gerät derselben Person erhält ihn mit dem Pull. Feste Felder bleiben,
// `angenommen` setzt nur `acceptBudgetSuggestion` (#151). Lesen und Schreiben darf nur der Eigentümer; das
// prüft das Negativtest-Gerüst aus #98 mit positiver Gegenprobe. Dass das Plan-Modul der App den Vorschlag
// anlegt und pusht, belegen die Seed-Szenarien `budgetvorschlag-*` in `seed-manifeste-app.test.ts`.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const periodTo = LocalDate.parse('2026-10-13');

const offen: BudgetSuggestionUpsert = {
  periodFrom: LocalDate.parse('2026-09-23'),
  periodTo,
  previousBudgetMilliKcal: 1_920_000,
  suggestedBudgetMilliKcal: 1_770_000,
  direction: 'senken',
  status: 'offen',
};

const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

/** Eine Installation mit SQLite und Sync wie im Composition Root, ohne Fachmodule. */
async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  closes.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const registry = createSyncRegistry([...foundationSyncEntities, localEntity]);
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: EntityId.parse(randomUUID()) });
  return { sync: () => engine.sync(), rows: () => database.read((tx) => sqliteOf(tx).select().from(localBudgetSuggestion).all()) };
}

const suggestionOp = (entityId: string, payload: Record<string, unknown>) => upsertOp(entityId, payload, { entityType: 'budget_suggestion' });
const serverRows = (backend: TestBackend) => backend.database.db.select().from(budgetSuggestion);

async function annaWithSuggestion() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const id = budgetSuggestionId(EntityId.parse(anna.personId), periodTo);
  return { backend, anna, id, personId: EntityId.parse(anna.personId) };
}

describe('Budgetvorschlag im Sync', () => {
  it('nimmt den offenen Vorschlag mit der deterministischen ID an; ein zweites Gerät derselben Person erhält ihn mit dem Pull', async () => {
    const { backend, anna, id, personId } = await annaWithSuggestion();

    const [result] = await push(backend, anna.device, [suggestionOp(id, offen)]);
    expect(result).toMatchObject({ type: 'applied' });
    expect(await serverRows(backend)).toEqual([expect.objectContaining({ id, personId, ...offen, deletedAt: null })]);

    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
    const ipad = await phone(backend, anna.accountId, second);
    await ipad.sync();
    expect(ipad.rows()).toEqual([expect.objectContaining({ id, personId, ...offen, serverVersion: expect.any(String) })]);
  });

  it('übernimmt Statuswechsel als Last-Write-Wins: zwei Geräte desselben Tags treffen dieselbe Zeile', async () => {
    const { backend, anna, id } = await annaWithSuggestion();
    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;

    await push(backend, anna.device, [suggestionOp(id, offen)]);
    // Das zweite Gerät hat am selben Tag denselben Vorschlag angelegt und dann eine neue Zielversion gespeichert.
    const [again, overtaken] = await push(backend, second, [suggestionOp(id, offen), suggestionOp(id, { ...offen, status: 'ueberholt' })]);
    expect(again).toMatchObject({ type: 'applied' });
    expect(overtaken).toMatchObject({ type: 'applied' });
    const [declined] = await push(backend, anna.device, [suggestionOp(id, { ...offen, status: 'abgelehnt' })]);
    expect(declined).toMatchObject({ type: 'applied' });

    expect(await serverRows(backend)).toEqual([expect.objectContaining({ id, status: 'abgelehnt' })]);
  });

  it('lehnt eine andere als die deterministische ID ab, ohne etwas anzulegen', async () => {
    const { backend, anna, personId } = await annaWithSuggestion();

    const [random, otherDay] = await push(backend, anna.device, [
      suggestionOp(randomUUID(), offen),
      suggestionOp(budgetSuggestionId(personId, LocalDate.parse('2026-10-12')), offen),
    ]);

    expect(random).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(otherDay).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await serverRows(backend)).toEqual([]);
  });

  it('lehnt angenommen per Upsert, geänderte feste Felder, unstimmige Beträge und Löschen ab', async () => {
    const { backend, anna, id } = await annaWithSuggestion();
    await push(backend, anna.device, [suggestionOp(id, offen)]);

    const results = await push(backend, anna.device, [
      suggestionOp(id, { ...offen, status: 'angenommen' }),
      suggestionOp(id, { ...offen, suggestedBudgetMilliKcal: 1_800_000 }),
      suggestionOp(id, { ...offen, previousBudgetMilliKcal: 2_000_000 }),
      suggestionOp(id, { ...offen, periodFrom: LocalDate.parse('2026-09-24') }),
      suggestionOp(id, { ...offen, direction: 'anheben' }),
      deleteOp(id, { entityType: 'budget_suggestion' }),
    ]);

    for (const result of results) expect(result).toMatchObject({ type: 'permanently_rejected' });
    expect(results.slice(0, 5).map((result) => result.type === 'permanently_rejected' && result.error.code)).toEqual(Array(5).fill('invalid_payload'));
    expect(await serverRows(backend)).toEqual([expect.objectContaining({ ...offen, deletedAt: null })]);
  });

  it('ein angenommener Vorschlag ändert sich per Upsert nicht mehr', async () => {
    const { backend, anna, id } = await annaWithSuggestion();
    await push(backend, anna.device, [suggestionOp(id, offen)]);
    // So hinterlässt ihn `acceptBudgetSuggestion` (#151).
    await backend.database.db.update(budgetSuggestion).set({ status: 'angenommen' }).where(eq(budgetSuggestion.id, id));

    const [overtaken] = await push(backend, anna.device, [suggestionOp(id, { ...offen, status: 'ueberholt' })]);

    expect(overtaken).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await serverRows(backend)).toEqual([expect.objectContaining({ status: 'angenommen' })]);
  });
});

// Negativtests des Autorisierungsgerüsts (#98): je Schutzdimension erst die positive Gegenprobe, dann
// die verweigerte Abwandlung.

type SuggestionWorld = AuthorizationWorld & { philippPersonId: EntityId; annaSuggestion: EntityId; philippSuggestion: EntityId };

async function arrange(): Promise<SuggestionWorld> {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const annaSuggestion = budgetSuggestionId(EntityId.parse(anna.personId), periodTo);
  const philippSuggestion = budgetSuggestionId(EntityId.parse(philipp.personId), periodTo);
  await push(backend, anna.device, [suggestionOp(annaSuggestion, offen)]);
  await push(backend, philipp.device, [suggestionOp(philippSuggestion, offen)]);
  return { backend, actor: anna.device, alsoForeign: [philipp.device], philippPersonId: EntityId.parse(philipp.personId), annaSuggestion, philippSuggestion };
}

async function operationOutcome(world: SuggestionWorld, device: Device, operation: OutboxOperation): Promise<Outcome> {
  const reply = await pushRaw(world.backend, device, [operation]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = PushResponse.parse(reply.body).results as [PushResult];
  if (result.type === 'applied' || result.type === 'already_applied') return 'erlaubt';
  if (result.error.code === 'forbidden' && result.canonical.type === 'absent') return 'verweigert';
  return `unerwartet: ${JSON.stringify(result)}`;
}

/** Verbotene Operation der Matrix: Den eigenen Vorschlag löschen; der Server verweigert sie vor jeder Fachprüfung. */
async function deleteOutcome(world: SuggestionWorld): Promise<Outcome> {
  const reply = await pushRaw(world.backend, world.actor, [deleteOp(world.annaSuggestion, { entityType: 'budget_suggestion' })]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = PushResponse.parse(reply.body).results as [PushResult];
  if (result.type === 'applied' || result.type === 'already_applied') return 'erlaubt';
  return result.error.code === 'forbidden' ? 'verweigert' : `unerwartet: ${JSON.stringify(result)}`;
}

async function pullOutcome(world: SuggestionWorld, device: Device, entityId: string): Promise<Outcome> {
  const reply = await pullRaw(world.backend, device);
  if (reply.status !== 200) return httpOutcome(reply);
  return PullResponse.parse(reply.body).changes.some((change) => change.entityId === entityId) ? 'erlaubt' : 'verweigert';
}

const cases = {
  'Push: eigenen Budgetvorschlag ablehnen': authorizationCases({
    policy: policies.resource('budget_suggestion', 'upsert'),
    arrange,
    attempt: (world, device) => operationOutcome(world, device, suggestionOp(world.annaSuggestion, { ...offen, status: 'abgelehnt' })),
    // Der Vorschlag des Partners und der eigene mit fremdem Eigentumsfeld.
    manipulierte_id: async (world) => {
      const foreignId = await operationOutcome(world, world.actor, suggestionOp(world.philippSuggestion, { ...offen, status: 'abgelehnt' }));
      const foreignOwner = await operationOutcome(world, world.actor, suggestionOp(world.annaSuggestion, { ...offen, personId: world.philippPersonId }));
      return foreignId === foreignOwner ? foreignId : `unerwartet: ${foreignId} / ${foreignOwner}`;
    },
    verbotene_operation: deleteOutcome,
  }),
  'Pull: eigenen Budgetvorschlag lesen': authorizationCases({
    policy: policies.resource('budget_suggestion', 'lesen'),
    arrange,
    attempt: (world, device) => pullOutcome(world, device, world.annaSuggestion),
    manipulierte_id: (world) => pullOutcome(world, world.actor, world.philippSuggestion),
    verbotene_operation: deleteOutcome,
  }),
};

for (const [name, list] of Object.entries(cases)) {
  describe(name, () => {
    for (const { name: caseName, run } of list) it(caseName, run);
  });
}
