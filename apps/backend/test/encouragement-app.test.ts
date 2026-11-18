import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { NotificationIntent } from '@abnehm/contracts/notifications';
import { notificationTexts } from '@abnehm/contracts/notification-texts';

import { encouragement, energyBooking, notificationIntent } from '../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { authorizationCases, personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart, worldToday } from './support/coupled-world.ts';
import { sendEncouragementScenario, sendOp } from './support/encouragement.ts';
import { uncoupleAs } from './support/shared-actions.ts';
import { pullAll, push } from './support/sync.ts';

// Nachweis für #123: `sendEncouragement` (Spezifikation 5, Abschnitt 4) über Push und Pull der echten
// Hono-App mit isoliertem Postgres und Testuhr. Den Push selbst stellt #142 zu.

/** Philipp und Anna, gekoppelt über die echte Einladung. */
async function couple() {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const { couplingId } = await coupleByInvitation(backend, philipp.device, anna.device);
  return { backend, philipp, anna, couplingId: EntityId.parse(couplingId) };
}

async function intentsOf(backend: TestBackend) {
  const rows = await backend.database.db.select().from(notificationIntent).orderBy(notificationIntent.intentId);
  return rows.map((row) =>
    NotificationIntent.parse({
      intentId: row.intentId,
      sourceEventId: row.sourceEventId,
      recipientPersonId: row.recipientPersonId,
      type: row.type,
      messageKey: row.messageKey,
      createdAt: row.createdAt.toISOString(),
      payload: row.payload,
    }),
  );
}

const encouragementsOf = (backend: TestBackend) => backend.database.db.select().from(encouragement);

const pulledEncouragements = async (backend: TestBackend, device: Parameters<typeof pullAll>[1]) =>
  (await pullAll(backend, device)).changes.filter((change) => change.entityType === 'encouragement');

describe('Anfeuern senden', () => {
  it('Tracer Bullet: Philipp feuert Anna an; der Server nimmt Anna aus der Kopplung und legt den Intent an', async () => {
    const { backend, philipp, anna, couplingId } = await couple();
    const operation = sendOp({ messageKey: 'gemeinsam_fuer_momo' });
    const id = operation.payload.encouragementId;

    const [result] = await push(backend, philipp.device, [operation]);

    const record = {
      couplingId,
      senderPersonId: philipp.personId,
      recipientPersonId: anna.personId,
      messageKey: 'gemeinsam_fuer_momo',
      sentAt: worldStart.instant,
      localDate: worldToday,
      timeZone: worldStart.timeZone,
      utcOffsetMinutes: 120,
      pushStatus: 'ausstehend',
      thankedAt: null,
      createdAt: worldStart.instant,
      updatedAt: worldStart.instant,
    };
    expect(result).toMatchObject({ type: 'applied', changes: [{ type: 'record', entityType: 'encouragement', entityId: id, data: record }] });
    const [intent] = await intentsOf(backend);
    expect(intent).toEqual({
      intentId: `${id}:${anna.personId}:anfeuern`,
      sourceEventId: id,
      recipientPersonId: anna.personId,
      type: 'anfeuern',
      messageKey: 'anfeuern',
      createdAt: worldStart.instant,
      payload: { senderDisplayName: 'Philipp', encouragementKey: 'gemeinsam_fuer_momo' },
    });
    expect(notificationTexts.renderStored(intent!.messageKey, intent!.payload)).toEqual({
      type: 'rendered',
      text: { title: 'Philipp feuert dich an', body: 'Gemeinsam für Momo 🐣' },
    });
    // Lesbar für beide aktiven Mitglieder, über den Pull.
    expect(await pulledEncouragements(backend, anna.device)).toEqual([expect.objectContaining({ entityId: id, data: record })]);
    expect(await pulledEncouragements(backend, philipp.device)).toEqual([expect.objectContaining({ entityId: id, data: record })]);
    // Kein Anfeuern im Spiel: keine Energiebuchung.
    expect(await backend.database.db.select().from(energyBooking)).toEqual([]);
  });

  it('eine mitgeschickte Empfänger-ID ist wirkungslos: Die Operation ist ungültig, es entsteht nichts', async () => {
    const { backend, philipp } = await couple();
    const stranger = await personWithSession(backend, 'fremd@example.test', 'Fremd');

    const [result] = await push(backend, philipp.device, [sendOp({ recipientPersonId: stranger.personId })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await encouragementsOf(backend)).toEqual([]);
    expect(await intentsOf(backend)).toEqual([]);
  });

  it('eine Wiederholung ist idempotent: dieselbe Operation und ein neues Gerät mit demselben Schlüssel', async () => {
    const { backend, philipp } = await couple();
    const operation = sendOp();

    const [first] = await push(backend, philipp.device, [operation]);
    const [retry] = await push(backend, philipp.device, [operation]);
    const [again] = await push(backend, philipp.device, [{ ...operation, operationId: EntityId.parse(randomUUID()) }]);

    expect(retry).toEqual({ ...first, type: 'already_applied' });
    expect(again).toMatchObject({ type: 'already_applied', changes: first!.type === 'applied' ? first!.changes : [] });
    expect(await encouragementsOf(backend)).toHaveLength(1);
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('die vierte Anfeuerung des Absendertags bekommt keinen Intent; ein anderer Absendertag zählt neu', async () => {
    const { backend, philipp } = await couple();
    const today = [sendOp(), sendOp(), sendOp(), sendOp()];
    const tomorrow = sendOp({ localDate: LocalDate.parse('2026-10-15'), createdAt: Instant.parse('2026-10-14T22:30:00.000Z') });

    const results = await push(backend, philipp.device, [...today, tomorrow]);

    const statusOf = (result: (typeof results)[number]) => {
      const change = result.type === 'applied' ? result.changes?.[0] : undefined;
      return change?.type === 'record' ? change.data.pushStatus : result.type;
    };
    expect(results.map(statusOf)).toEqual([
      'ausstehend', 'ausstehend', 'ausstehend', 'ohne_push', 'ausstehend',
    ]);
    expect((await intentsOf(backend)).map((intent) => intent.sourceEventId).sort()).toEqual(
      [...today.slice(0, 3), tomorrow].map((operation) => operation.payload.encouragementId).sort(),
    );
  });

  it('gleichzeitig eingehende Anfeuerungen zählen der Reihe nach: höchstens drei Intents je Absendertag', async () => {
    const { backend, philipp } = await couple();
    await push(backend, philipp.device, [sendOp(), sendOp()]);

    await Promise.all([push(backend, philipp.device, [sendOp()]), push(backend, philipp.device, [sendOp()])]);

    expect((await encouragementsOf(backend)).map((row) => row.pushStatus).sort()).toEqual(['ausstehend', 'ausstehend', 'ausstehend', 'ohne_push']);
    expect(await intentsOf(backend)).toHaveLength(3);
  });

  it('eine Anfeuerung, die erst mehr als 24 Stunden nach createdAt eingeht, bleibt ohne Intent', async () => {
    const { backend, philipp } = await couple();
    const late = sendOp({ createdAt: Instant.parse('2026-10-13T11:59:59.999Z'), localDate: LocalDate.parse('2026-10-13') });
    const inTime = sendOp({ createdAt: Instant.parse('2026-10-13T12:00:00.000Z'), localDate: LocalDate.parse('2026-10-13') });

    const results = await push(backend, philipp.device, [late, inTime]);

    expect(results).toMatchObject([
      { type: 'applied', changes: [{ data: { pushStatus: 'ohne_push' } }] },
      { type: 'applied', changes: [{ data: { pushStatus: 'ausstehend' } }] },
    ]);
    expect((await intentsOf(backend)).map((intent) => intent.sourceEventId)).toEqual([inTime.payload.encouragementId]);
  });

  it('nach der Entkopplung lehnt der Server mit forbidden ab', async () => {
    const { backend, philipp, anna, couplingId } = await couple();
    await uncoupleAs(backend, { couplingId, requesterPersonId: anna.personId });

    const [result] = await push(backend, philipp.device, [sendOp()]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'forbidden' }, canonical: { type: 'absent' } });
    expect(await encouragementsOf(backend)).toEqual([]);
    // Den Intent `entkopplung` legt der Entkopplungs-Kern selbst an; eine Anfeuerung kommt nicht dazu.
    expect((await intentsOf(backend)).filter((intent) => intent.type === 'anfeuern')).toEqual([]);
  });

  it('einen unbekannten Botschaftsschlüssel lehnt der Server mit unknown_catalog_key ab', async () => {
    const { backend, philipp } = await couple();

    const [result] = await push(backend, philipp.device, [sendOp({ messageKey: 'kleiner_stups' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'unknown_catalog_key' } });
    expect(await encouragementsOf(backend)).toEqual([]);
    expect(await intentsOf(backend)).toEqual([]);
  });

  it('ein fachlicher Schlüssel, der nicht zur ID passt, ist ungültig', async () => {
    const { backend, philipp } = await couple();
    const operation = sendOp({}, { businessKey: `anfeuern:${randomUUID()}` });

    const [result] = await push(backend, philipp.device, [operation]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(encouragement).where(eq(encouragement.id, operation.payload.encouragementId))).toEqual([]);
  });
});

describe('Autorisierung von sendEncouragement', () => {
  for (const { name, run } of authorizationCases(sendEncouragementScenario)) it(name, run, 20_000);
});
