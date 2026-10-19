import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import type { SyncCursor } from '@abnehm/contracts/base';

import { coupling, couplingMember, invitation, island, partnerSharing, photoSharing } from '../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { call, securityLogEntries, signUp, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { worldStart } from './support/coupled-world.ts';
import { pullAll, push, upsertOp } from './support/sync.ts';

// Einladung, Code prüfen und Annahme über die echte Hono-App mit Postgres (Spezifikation 0, Abschnitt 9;
// #103).

const HOUR_MS = 60 * 60 * 1000;

async function setup() {
  const clock = createTestClock(worldStart);
  const backend = await createTestBackend({ clock });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  return { backend, clock, philipp, anna };
}

function createInvitation(backend: TestBackend, device: Device, requestId: string = randomUUID()) {
  return call(backend, 'POST', '/v1/invitations', device, { requestId });
}

describe('Code erzeugen', () => {
  it('liefert sechs Ziffern, 24 Stunden gültig, und speichert nur einen HMAC', async () => {
    const { backend, philipp } = await setup();

    const reply = await createInvitation(backend, philipp.device);

    expect(reply.status).toBe(200);
    const { code, expiresAt } = reply.body as { code: string; expiresAt: string };
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(expiresAt).toBe(new Date(Date.parse(worldStart.instant) + 24 * HOUR_MS).toISOString());
    const stored = await backend.database.db.select().from(invitation);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it('liefert bei verlorener Antwort und identischem Retry denselben Code, ohne eine zweite Einladung', async () => {
    const { backend, clock, philipp } = await setup();
    const requestId = randomUUID();

    const first = await createInvitation(backend, philipp.device, requestId);
    clock.advanceBy(HOUR_MS);
    const retry = await createInvitation(backend, philipp.device, requestId);

    expect(retry).toMatchObject({ status: 200, body: first.body });
    expect(await backend.database.db.select().from(invitation)).toHaveLength(1);
    const next = await createInvitation(backend, philipp.device);
    expect((next.body as { code: string }).code).not.toBe((first.body as { code: string }).code);
  });

  it('übersetzt gleichzeitige identische Anfragen nach der Unique-Verletzung in dasselbe Ergebnis', async () => {
    const { backend, philipp } = await setup();
    const requestId = randomUUID();

    // Die Sperre lässt beide Transaktionen lesen, aber erst schreiben, wenn beide am Insert in
    // `online_request` warten. Dann scheitert die zweite am Primärschlüssel, wiederholt und liefert das
    // gespeicherte Ergebnis der ersten.
    const { pending } = await backend.database.db.transaction(async (tx) => {
      await tx.execute(sql`lock table online_request in exclusive mode`);
      const both = Promise.all([createInvitation(backend, philipp.device, requestId), createInvitation(backend, philipp.device, requestId)]);
      await vi.waitFor(async () => expect(await waitingOnOnlineRequest(backend)).toBe(2), { timeout: 5_000 });
      return { pending: both };
    });
    const replies = await pending;

    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(new Set(replies.map((reply) => JSON.stringify(reply.body))).size).toBe(1);
    expect(await backend.database.db.select().from(invitation)).toHaveLength(1);
  });

  it('weist eine fremde oder anders verwendete requestId ab', async () => {
    const { backend, philipp, anna } = await setup();
    const requestId = randomUUID();
    await createInvitation(backend, philipp.device, requestId);

    expect(await createInvitation(backend, anna.device, requestId)).toMatchObject({ status: 403, body: { code: 'forbidden', retryable: false } });
    const asAccept = await call(backend, 'POST', '/v1/invitations/accept', philipp.device, { requestId, code: '123456' });
    expect(asAccept).toMatchObject({ status: 409, body: { code: 'operation_conflict', retryable: false } });
  });
});

/** Wie viele Transaktionen gerade auf eine Sperre von `online_request` warten. */
async function waitingOnOnlineRequest(backend: TestBackend) {
  const result = await backend.database.db.execute<{ waiting: number }>(
    sql`select count(*)::int as waiting from pg_locks where not granted and relation = 'online_request'::regclass`,
  );
  return result.rows[0]!.waiting;
}

function check(backend: TestBackend, device: Device, code: string) {
  return call(backend, 'POST', '/v1/invitations/check', device, { code });
}

function accept(backend: TestBackend, device: Device, code: string, requestId: string = randomUUID()) {
  return call(backend, 'POST', '/v1/invitations/accept', device, { requestId, code });
}

async function codeOf(backend: TestBackend, device: Device) {
  const reply = await createInvitation(backend, device);
  if (reply.status !== 200) throw new Error(`Code erzeugen fehlgeschlagen: ${reply.status}`);
  return (reply.body as { code: string }).code;
}

/** Ein Code, der zu keiner Einladung gehört. */
function unknownCode(...known: string[]) {
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, '0');
    if (!known.includes(candidate)) return candidate;
  }
}

const rejected = (code: string) => ({ status: 422, body: { code, retryable: false } });

describe('Code prüfen', () => {
  it('nennt die einladende Person und verbraucht den Code nicht', async () => {
    const { backend, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);

    expect(await check(backend, anna.device, code)).toMatchObject({ status: 200, body: { inviterDisplayName: 'Philipp', reactivates: false } });
    expect(await check(backend, anna.device, code)).toMatchObject({ status: 200 });
    expect((await accept(backend, anna.device, code)).status).toBe(200);
  });

  it('weist ungültige, abgelaufene, verbrauchte und eigene Codes mit ihrem Fehlercode ab', async () => {
    const { backend, clock, philipp, anna } = await setup();
    const third = await personWithSession(backend, 'dritte@example.test', 'Dritte');
    const fourth = await personWithSession(backend, 'vierte@example.test', 'Vierte');

    const own = await codeOf(backend, philipp.device);
    expect(await check(backend, philipp.device, own)).toMatchObject(rejected('invite_self'));
    expect(await accept(backend, philipp.device, own)).toMatchObject(rejected('invite_self'));
    expect(await check(backend, anna.device, unknownCode(own))).toMatchObject(rejected('invite_invalid'));

    expect((await accept(backend, anna.device, own)).status).toBe(200);
    expect(await check(backend, third.device, own)).toMatchObject(rejected('invite_consumed'));
    expect(await accept(backend, third.device, own)).toMatchObject(rejected('invite_consumed'));

    const expiring = await codeOf(backend, third.device);
    clock.advanceBy(24 * HOUR_MS);
    expect(await check(backend, fourth.device, expiring)).toMatchObject(rejected('invite_expired'));
    expect(await accept(backend, fourth.device, expiring)).toMatchObject(rejected('invite_expired'));
  });

  it('meldet already_coupled, wenn eine der beiden Personen schon gekoppelt ist', async () => {
    const { backend, philipp, anna } = await setup();
    const third = await personWithSession(backend, 'dritte@example.test', 'Dritte');
    const fromThird = await codeOf(backend, third.device);
    expect((await accept(backend, anna.device, await codeOf(backend, philipp.device))).status).toBe(200);

    expect(await check(backend, anna.device, fromThird)).toMatchObject(rejected('already_coupled'));
    expect(await accept(backend, anna.device, fromThird)).toMatchObject(rejected('already_coupled'));
    expect(await createInvitation(backend, philipp.device)).toMatchObject(rejected('already_coupled'));
    const fourth = await personWithSession(backend, 'vierte@example.test', 'Vierte');
    expect(await check(backend, fourth.device, fromThird)).toMatchObject({ status: 200 });
  });
});

const limited = { status: 429, body: { code: 'invite_rate_limited', retryable: true } };

describe('Begrenzung', () => {
  it('sperrt ein Konto nach fünf Fehlversuchen in 15 Minuten, auch für gültige Codes, mit demselben generischen Fehler', async () => {
    const { backend, clock, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);

    for (let n = 0; n < 5; n++) expect(await check(backend, anna.device, unknownCode(code))).toMatchObject(rejected('invite_invalid'));

    expect(await check(backend, anna.device, code)).toMatchObject(limited);
    expect(await accept(backend, anna.device, code)).toMatchObject(limited);
    clock.advanceBy(15 * 60 * 1000);
    expect(await check(backend, anna.device, code)).toMatchObject({ status: 200 });
  });

  it('sperrt einen Code nach fünf Fehlversuchen beliebiger Konten', async () => {
    const { backend, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);
    const guessed = unknownCode(code);
    for (let n = 0; n < 5; n++) {
      const guesser = await personWithSession(backend, `rater-${n}@example.test`, 'Rater');
      expect(await check(backend, guesser.device, guessed)).toMatchObject(rejected('invite_invalid'));
    }

    expect(await check(backend, anna.device, guessed)).toMatchObject(limited);
    expect(await check(backend, anna.device, code)).toMatchObject({ status: 200 });
  });

  it('sperrt eine IP nach 20 Versuchen in der Stunde, auch erfolgreichen', async () => {
    const { backend, clock, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);
    for (let n = 0; n < 20; n++) expect(await check(backend, anna.device, code)).toMatchObject({ status: 200 });

    expect(await check(backend, anna.device, code)).toMatchObject(limited);
    expect(await check(backend, { ...anna.device, ip: '203.0.113.7' }, code)).toMatchObject({ status: 200 });
    clock.advanceBy(60 * 60 * 1000);
    expect(await check(backend, anna.device, code)).toMatchObject({ status: 200 });
  });
});

describe('Sicherheitsgrenze', () => {
  it('verweigert Konten ohne Person generisch und weist mitgeschickte Konto- oder Personen-IDs ab', async () => {
    const { backend, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);
    const { device } = await signUp(backend, 'ohne-person@example.test');
    const forbidden = { status: 403, body: { code: 'forbidden', retryable: false } };

    expect(await createInvitation(backend, device)).toMatchObject(forbidden);
    expect(await check(backend, device, code)).toMatchObject(forbidden);
    expect(await accept(backend, device, code)).toMatchObject(forbidden);

    const invalid = { status: 400, body: { code: 'invalid_payload' } };
    const requestId = randomUUID();
    expect(await call(backend, 'POST', '/v1/invitations', anna.device, { requestId, personId: philipp.personId })).toMatchObject(invalid);
    expect(await call(backend, 'POST', '/v1/invitations/check', anna.device, { code, accountId: philipp.accountId })).toMatchObject(invalid);
    expect(await call(backend, 'POST', '/v1/invitations/accept', anna.device, { requestId, code, inviterPersonId: anna.personId })).toMatchObject(
      invalid,
    );
    expect(await backend.database.db.select().from(coupling)).toHaveLength(0);
  });
});

describe('Anzeigename', () => {
  it('zieht eine Namensänderung der Person in derselben Transaktion bei ihren Kopplungsmitgliedern nach', async () => {
    const { backend, philipp, anna } = await setup();
    await accept(backend, anna.device, await codeOf(backend, philipp.device));
    const before = await pullAll(backend, philipp.device);

    await push(backend, anna.device, [upsertOp(anna.personId, { ...newPerson(anna.personId), displayName: 'Anna B.' }, { entityType: 'person' })]);

    const { changes } = await pullAll(backend, philipp.device, before.cursor);
    expect(changes).toEqual([
      expect.objectContaining({ type: 'record', entityType: 'coupling_member', data: expect.objectContaining({ personId: anna.personId, displayName: 'Anna B.' }) }),
    ]);
  });
});

/** Upsert-Nutzlast einer Person direkt nach dem Bootstrap. */
function newPerson(id: string) {
  return {
    id,
    displayName: 'Anna',
    calculationSex: null,
    birthDate: null,
    heightCm: null,
    activityLevel: null,
    pregnantOrBreastfeeding: null,
    knownEatingDisorder: null,
    disclaimerAcceptedAt: null,
    onboardingStatus: 'begonnen',
    onboardingCompletedAt: null,
    goalWeightReachedG: null,
    goalWeightReachedAt: null,
  };
}

/**
 * Ausgangszustand einer Reaktivierung, bis Spezifikation 4 und 5 Schlüpfen und Entkoppeln liefern: Rollen
 * gesetzt, Insel geschlüpft und mit der Kopplung archiviert.
 */
async function hatchAndUncouple(backend: TestBackend, couplingId: string, { roleOf }: { roleOf: Record<string, 'bauen' | 'natur'> }) {
  const at = new Date(worldStart.instant);
  await backend.database.db.transaction(async (tx) => {
    for (const [personId, role] of Object.entries(roleOf)) {
      await tx.update(couplingMember).set({ role }).where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, personId)));
    }
    await tx.update(island).set({ state: 'archiviert', hatchedAt: at, timeZone: 'Europe/Berlin' }).where(eq(island.couplingId, couplingId));
    await tx.update(coupling).set({ status: 'archiviert', endedAt: at }).where(eq(coupling.id, couplingId));
  });
}

/** Was die Person im Pull (ohne Cursor vollständig) über Kopplung, Mitglieder, Insel und Freigaben erhält. */
async function coupledRows(backend: TestBackend, device: Device, cursor: SyncCursor | null = null) {
  const { changes } = await pullAll(backend, device, cursor);
  return changes.flatMap((change) =>
    change.type === 'record' && change.entityType !== 'person' ? [{ entityType: change.entityType, data: change.data }] : [],
  );
}

describe('Einladung annehmen', () => {
  it('koppelt atomar: Kopplung, rollenlose Mitglieder, wartende Insel und Startfreigaben kommen per Pull an', async () => {
    const { backend, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);

    const reply = await accept(backend, anna.device, code);

    expect(reply).toMatchObject({ status: 200, body: { reactivated: false } });
    const { couplingId } = reply.body as { couplingId: string };
    const [low, high] = [philipp.personId, anna.personId].sort();
    const shared = [
      { entityType: 'coupling', data: expect.objectContaining({ personLowId: low, personHighId: high, status: 'aktiv', endedAt: null, reactivatedAt: null }) },
      { entityType: 'coupling_member', data: expect.objectContaining({ couplingId, personId: philipp.personId, displayName: 'Philipp', role: null }) },
      { entityType: 'coupling_member', data: expect.objectContaining({ couplingId, personId: anna.personId, displayName: 'Anna', role: null }) },
      { entityType: 'island', data: expect.objectContaining({ couplingId, state: 'wartet_auf_rollen', hatchedAt: null }) },
    ];
    const sharingsOf = (ownerPersonId: string) => [
      ...['ernaehrung', 'wasser', 'sport', 'gewicht'].map((area) => ({
        entityType: 'partner_sharing',
        data: expect.objectContaining({ ownerPersonId, couplingId, area, level: 'zusammengefasst' }),
      })),
      { entityType: 'photo_sharing', data: expect.objectContaining({ ownerPersonId, couplingId, level: 'geteilt' }) },
    ];
    for (const own of [philipp, anna]) {
      const rows = await coupledRows(backend, own.device);
      expect(rows).toEqual(expect.arrayContaining([...shared, ...sharingsOf(own.personId)]));
      expect(rows).toHaveLength(shared.length + 5);
    }
    expect((await securityLogEntries(backend)).filter((entry) => entry.eventType === 'kopplung')).toEqual([
      { eventType: 'kopplung', accountId: anna.accountId, details: { accountId: anna.accountId, couplingId, reactivated: false } },
    ]);
  });

  it('reaktiviert die archivierte Kopplung desselben Paars mit Insel, Rollen und Freigaben', async () => {
    const { backend, philipp, anna } = await setup();
    const { couplingId } = (await accept(backend, anna.device, await codeOf(backend, philipp.device))).body as { couplingId: string };
    const pulled = { anna: await pullAll(backend, anna.device), philipp: await pullAll(backend, philipp.device) };
    await hatchAndUncouple(backend, couplingId, { roleOf: { [philipp.personId]: 'bauen', [anna.personId]: 'natur' } });
    await backend.database.db
      .update(partnerSharing)
      .set({ level: 'privat' })
      .where(and(eq(partnerSharing.ownerPersonId, anna.personId), eq(partnerSharing.area, 'gewicht')));
    await backend.database.db.update(photoSharing).set({ level: 'privat' }).where(eq(photoSharing.ownerPersonId, philipp.personId));

    const code = await codeOf(backend, anna.device);
    expect(await check(backend, philipp.device, code)).toMatchObject({ status: 200, body: { inviterDisplayName: 'Anna', reactivates: true } });
    const reply = await accept(backend, philipp.device, code);

    expect(reply).toMatchObject({ status: 200, body: { couplingId, reactivated: true } });
    // Die Geräte kennen die Zeilen schon; sie kommen trotzdem im nächsten Pull ab ihrem Cursor erneut.
    const annaRows = await coupledRows(backend, anna.device, pulled.anna.cursor);
    expect(annaRows).toEqual(
      expect.arrayContaining([
        { entityType: 'coupling', data: expect.objectContaining({ status: 'aktiv', endedAt: null, reactivatedAt: worldStart.instant }) },
        { entityType: 'coupling_member', data: expect.objectContaining({ personId: philipp.personId, role: 'bauen' }) },
        { entityType: 'coupling_member', data: expect.objectContaining({ personId: anna.personId, role: 'natur' }) },
        { entityType: 'island', data: expect.objectContaining({ couplingId, state: 'aktiv', hatchedAt: worldStart.instant }) },
        { entityType: 'partner_sharing', data: expect.objectContaining({ area: 'gewicht', level: 'privat' }) },
      ]),
    );
    expect(annaRows).toHaveLength(9);
    expect(await coupledRows(backend, philipp.device, pulled.philipp.cursor)).toEqual(
      expect.arrayContaining([{ entityType: 'photo_sharing', data: expect.objectContaining({ level: 'privat' }) }]),
    );
    expect(await backend.database.db.select().from(island)).toHaveLength(1);
    expect((await securityLogEntries(backend)).filter((entry) => entry.eventType === 'kopplung').at(-1)).toMatchObject({
      accountId: philipp.accountId,
      details: { couplingId, reactivated: true },
    });
  });

  it('gibt einer anderen Paarung eine neue Kopplung und Insel', async () => {
    const { backend, philipp, anna } = await setup();
    const third = await personWithSession(backend, 'dritte@example.test', 'Dritte');
    const { couplingId } = (await accept(backend, anna.device, await codeOf(backend, philipp.device))).body as { couplingId: string };
    await hatchAndUncouple(backend, couplingId, { roleOf: {} });

    const code = await codeOf(backend, third.device);
    expect(await check(backend, anna.device, code)).toMatchObject({ status: 200, body: { reactivates: false } });
    const reply = await accept(backend, anna.device, code);

    expect(reply).toMatchObject({ status: 200, body: { reactivated: false } });
    expect((reply.body as { couplingId: string }).couplingId).not.toBe(couplingId);
    expect(await backend.database.db.select().from(island)).toHaveLength(2);
  });

  it('erzeugt bei überkreuzten gleichzeitigen Annahmen genau eine aktive Kopplung', async () => {
    const { backend, philipp, anna } = await setup();
    const [fromPhilipp, fromAnna] = [await codeOf(backend, philipp.device), await codeOf(backend, anna.device)];

    const replies = await Promise.all([accept(backend, anna.device, fromPhilipp), accept(backend, philipp.device, fromAnna)]);

    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 422]);
    expect(replies.find((reply) => reply.status === 422)).toMatchObject(rejected('already_coupled'));
    expect(await backend.database.db.select().from(coupling)).toHaveLength(1);
    expect(await backend.database.db.select().from(couplingMember)).toHaveLength(2);
    expect(await backend.database.db.select().from(island)).toHaveLength(1);
  });

  it('lässt von gleichzeitigen Annahmen desselben Codes und zweier Codes je nur eine gelingen', async () => {
    const { backend, philipp, anna } = await setup();
    const third = await personWithSession(backend, 'dritte@example.test', 'Dritte');
    const fourth = await personWithSession(backend, 'vierte@example.test', 'Vierte');
    const code = await codeOf(backend, philipp.device);

    const sameCode = await Promise.all([accept(backend, anna.device, code), accept(backend, third.device, code)]);
    expect(sameCode.map((reply) => reply.status).sort()).toEqual([200, 422]);
    expect(sameCode.find((reply) => reply.status === 422)).toMatchObject(rejected('invite_consumed'));

    const loser = sameCode[0]!.status === 200 ? third : anna;
    const [fromFourth, fifth] = [await codeOf(backend, fourth.device), await personWithSession(backend, 'fuenfte@example.test', 'Fünfte')];
    const twoCodes = await Promise.all([accept(backend, loser.device, fromFourth), accept(backend, loser.device, await codeOf(backend, fifth.device))]);
    expect(twoCodes.map((reply) => reply.status).sort()).toEqual([200, 422]);
    expect(twoCodes.find((reply) => reply.status === 422)).toMatchObject(rejected('already_coupled'));
    expect(await backend.database.db.select().from(coupling)).toHaveLength(2);
  });

  it('liefert bei verlorener Antwort und identischem Retry dasselbe Ergebnis', async () => {
    const { backend, philipp, anna } = await setup();
    const code = await codeOf(backend, philipp.device);
    const requestId = randomUUID();

    const first = await accept(backend, anna.device, code, requestId);
    const retry = await accept(backend, anna.device, code, requestId);

    expect(first.status).toBe(200);
    expect(retry).toMatchObject({ status: 200, body: first.body });
    expect(await accept(backend, anna.device, code)).toMatchObject(rejected('already_coupled'));
    expect(await accept(backend, anna.device, '000000', requestId)).toMatchObject({ status: 409, body: { code: 'operation_conflict' } });
  });
});
