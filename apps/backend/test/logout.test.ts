import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { onlineRequest, session } from '../src/db/schema/index.ts';
import type { LogoutHook } from '../src/logout/logout.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { call, defaultPassword, newDevice, securityLogEntries, sessionIsValid, signIn, signUp, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';

// Serverseitiger Abmeldeablauf (Spezifikation 0, Abschnitt 9; #111) über HTTP gegen die echte Hono-App:
// Haken in Reihenfolge, Sicherheitslog, Widerruf und das an die Sitzung gebundene Ergebnis.

const logout = (backend: TestBackend, device: Device, requestId: string) => call(backend, 'POST', '/v1/session/logout', device, { requestId });

/** Ein Test-Haken, der mitschreibt, ob die Sitzung in seiner Transaktion noch besteht. */
function recordingHook(backend: TestBackend, name: string, calls: string[]): LogoutHook {
  return {
    name,
    async run(tx, actor) {
      const [current] = await tx.select({ id: session.id }).from(session).where(eq(session.id, actor.sessionId));
      calls.push(`${name}:${actor.accountId}:${current === undefined ? 'widerrufen' : 'aktiv'}`);
    },
  };
}

describe('Abmelden auf dem Server', () => {
  it('führt die Haken in Reihenfolge aus, protokolliert und widerruft genau die aktuelle Sitzung', async () => {
    const backend = await createTestBackend();
    const { device: phone, accountId } = await signUp(backend, 'anna@example.test');
    const { device: tablet } = await signIn(backend, 'anna@example.test', defaultPassword);
    const calls: string[] = [];
    backend.logout.registerHook(recordingHook(backend, 'erster', calls));
    backend.logout.registerHook(recordingHook(backend, 'zweiter', calls));

    const reply = await logout(backend, phone, randomUUID());

    expect(reply).toMatchObject({ status: 200, body: { loggedOutAt: expect.any(String) } });
    expect(calls).toEqual([`erster:${accountId}:aktiv`, `zweiter:${accountId}:aktiv`]);
    expect(await sessionIsValid(backend, phone)).toBe(false);
    expect(await sessionIsValid(backend, tablet)).toBe(true);
    expect((await securityLogEntries(backend)).filter((entry) => entry.eventType !== 'anmeldung')).toEqual([
      { eventType: 'abmeldung', accountId, details: { accountId } },
      { eventType: 'sitzungswiderruf', accountId, details: { accountId, scope: 'aktuelle', cause: 'abmeldung' } },
    ]);
  });

  it('liefert einem identischen Retry mit der widerrufenen Sitzung dasselbe Ergebnis, ohne den Ablauf zu wiederholen', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');
    const calls: string[] = [];
    backend.logout.registerHook(recordingHook(backend, 'haken', calls));
    const requestId = randomUUID();

    const first = await logout(backend, device, requestId);
    const retry = await logout(backend, device, requestId);

    expect(retry).toMatchObject({ status: 200, body: first.body });
    expect(calls).toHaveLength(1);
    expect((await securityLogEntries(backend)).filter((entry) => entry.eventType === 'abmeldung')).toHaveLength(1);
  });

  it('gewährt der widerrufenen Sitzung sonst keinen Zugriff', async () => {
    const backend = await createTestBackend();
    const { device } = await personWithSession(backend, 'anna@example.test', 'Anna');
    const requestId = randomUUID();
    await logout(backend, device, requestId);

    expect(await logout(backend, device, randomUUID())).toMatchObject({ status: 401, body: null });
    expect(await call(backend, 'POST', '/v1/person/bootstrap', device, { displayName: 'Anna', timeZone: 'Europe/Berlin' })).toMatchObject({
      status: 401,
      body: null,
    });
    expect(await call(backend, 'POST', '/v1/invitations', device, { requestId })).toMatchObject({ status: 401, body: null });
    expect(await call(backend, 'GET', '/v1/auth/get-session', device)).toMatchObject({ status: 200, body: null });
  });

  it('gibt das Ergebnis keiner anderen Sitzung heraus, auch nicht derselben Person', async () => {
    const backend = await createTestBackend();
    const { device: phone } = await signUp(backend, 'anna@example.test');
    const { device: tablet } = await signIn(backend, 'anna@example.test', defaultPassword);
    const { device: stranger } = await signUp(backend, 'fremd@example.test');
    const requestId = randomUUID();
    await logout(backend, phone, requestId);

    expect(await logout(backend, tablet, requestId)).toMatchObject({ status: 409, body: { code: 'operation_conflict' } });
    expect(await logout(backend, stranger, requestId)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    expect(await logout(backend, { ...newDevice(), token: 'gefaelscht' }, requestId)).toMatchObject({ status: 401, body: null });
    expect(await logout(backend, newDevice(), requestId)).toMatchObject({ status: 401, body: null });
    expect(await sessionIsValid(backend, tablet)).toBe(true);
    expect(await sessionIsValid(backend, stranger)).toBe(true);
  });

  it('lässt bei einem Fehler vor dem Widerruf alles unverändert; der Retry gelingt danach', async () => {
    const backend = await createTestBackend();
    const { device, accountId } = await signUp(backend, 'anna@example.test');
    let failing = true;
    backend.logout.registerHook({
      name: 'stoerung',
      async run() {
        if (failing) throw new Error('Push-Dienst nicht erreichbar');
      },
    });
    const requestId = randomUUID();

    expect((await logout(backend, device, requestId)).status).toBe(500);
    expect(await sessionIsValid(backend, device)).toBe(true);
    expect(await backend.database.db.select().from(onlineRequest)).toEqual([]);
    expect((await securityLogEntries(backend)).map((entry) => entry.eventType)).toEqual([]);

    failing = false;
    expect(await logout(backend, device, requestId)).toMatchObject({ status: 200 });
    expect(await sessionIsValid(backend, device)).toBe(false);
    expect((await securityLogEntries(backend)).map((entry) => [entry.eventType, entry.accountId])).toEqual([
      ['abmeldung', accountId],
      ['sitzungswiderruf', accountId],
    ]);
  });

  it('meldet gleichzeitige identische Anfragen genau einmal ab', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');
    const requestId = randomUUID();

    const replies = await Promise.all([logout(backend, device, requestId), logout(backend, device, requestId)]);

    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(replies[1]!.body).toEqual(replies[0]!.body);
    expect((await securityLogEntries(backend)).filter((entry) => entry.eventType === 'abmeldung')).toHaveLength(1);
  });

  it('lehnt einen doppelt angemeldeten Haken ab', async () => {
    const backend = await createTestBackend();
    backend.logout.registerHook({ name: 'push', run: async () => {} });

    expect(() => backend.logout.registerHook({ name: 'push', run: async () => {} })).toThrow('push');
  });
});
