import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { RegisterPushInstallationRequest } from '@abnehm/contracts/notifications';
import { currentSyncSchemaVersion, InstallationId } from '@abnehm/contracts/sync';

import { policies } from '../src/authorization/authorization.ts';
import { pushInstallation } from '../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { call, defaultPassword, signIn, signUp, type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, personWithSession, resourceProbe, type AuthorizationWorld } from './support/authorization.ts';

// Push-Installation (Spezifikation 5, Abschnitt 9; #139) über die echte Hono-App mit Postgres:
// registrieren, aktualisieren, umhängen, deaktivieren, fremde Installation und der Abmelde-Haken.

const registration = (overrides: Partial<RegisterPushInstallationRequest> = {}): RegisterPushInstallationRequest => ({
  installationKey: InstallationId.parse(randomUUID()),
  platform: 'ios',
  expoPushToken: `ExponentPushToken[${randomUUID()}]`,
  permission: 'granted',
  ...overrides,
});

const register = (backend: TestBackend, device: Device, request: RegisterPushInstallationRequest) =>
  call(backend, 'POST', '/v1/push-installations', device, request);

const deactivate = (backend: TestBackend, device: Device, installationKey: string) =>
  call(backend, 'POST', `/v1/push-installations/${installationKey}/deactivate`, device);

async function installations(backend: TestBackend) {
  return backend.database.db.select().from(pushInstallation);
}

async function installationOf(backend: TestBackend, installationKey: string) {
  const [row] = await backend.database.db.select().from(pushInstallation).where(eq(pushInstallation.installationKey, installationKey));
  return row;
}

/** Die Sitzung eines Geräts, wie das Auth-Modul sie erkennt. */
async function sessionOf(backend: TestBackend, device: Device) {
  const session = await backend.auth.sessions.authenticate(new Headers({ authorization: `Bearer ${device.token ?? ''}` }));
  if (session === null) throw new Error('Gerät ohne gültige Sitzung');
  return session.sessionId;
}

/** Meldet dasselbe Konto auf einem weiteren Gerät an: eine zweite, eigene Sitzung. */
async function signInAgain(backend: TestBackend, email: string) {
  const { reply, device } = await signIn(backend, email, defaultPassword);
  if (reply.status !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${reply.status}`);
  return device;
}

async function twoPeople() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  return { backend, anna, philipp };
}

describe('registrieren oder aktualisieren', () => {
  it('legt die Installation für die Person der Sitzung an und bindet die aktuelle Sitzung', async () => {
    const { backend, philipp } = await twoPeople();
    const request = registration();

    const reply = await register(backend, philipp.device, request);

    expect(reply.status).toBe(204);
    expect(await installationOf(backend, request.installationKey)).toMatchObject({
      personId: philipp.personId,
      sessionId: await sessionOf(backend, philipp.device),
      expoPushToken: request.expoPushToken,
      platform: 'ios',
      permissionStatus: 'erlaubt',
      active: true,
    });
  });

  it('aktualisiert Token, Erlaubnis und Sitzung derselben Installationskennung, ohne eine zweite anzulegen', async () => {
    const { backend, philipp } = await twoPeople();
    const first = registration();
    await register(backend, philipp.device, first);
    // Neu angemeldet auf demselben Gerät: neue Sitzung, neues Token, Erlaubnis in den Einstellungen entzogen.
    const relogged = await signInAgain(backend, 'philipp@example.test');
    const second = { ...first, expoPushToken: `ExponentPushToken[${randomUUID()}]`, permission: 'denied' as const };

    expect((await register(backend, relogged, second)).status).toBe(204);

    expect(await installations(backend)).toHaveLength(1);
    expect(await installationOf(backend, first.installationKey)).toMatchObject({
      personId: philipp.personId,
      sessionId: await sessionOf(backend, relogged),
      expoPushToken: second.expoPushToken,
      permissionStatus: 'verweigert',
      active: true,
    });
  });

  it('aktiviert eine deaktivierte Installation bei der nächsten Registrierung wieder', async () => {
    const { backend, philipp } = await twoPeople();
    const request = registration();
    await register(backend, philipp.device, request);
    await deactivate(backend, philipp.device, request.installationKey);

    await register(backend, philipp.device, request);

    expect((await installationOf(backend, request.installationKey))?.active).toBe(true);
  });

  it('hängt eine Installationskennung, die einer anderen Person gehörte, um; für diese ist sie deaktiviert', async () => {
    const { backend, anna, philipp } = await twoPeople();
    const request = registration();
    await register(backend, anna.device, request);

    const reply = await register(backend, philipp.device, { ...request, expoPushToken: `ExponentPushToken[${randomUUID()}]` });

    expect(reply.status).toBe(204);
    const rows = await installations(backend);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: philipp.personId, sessionId: await sessionOf(backend, philipp.device), active: true });
    // Anna hat keine aktive Installation mehr und kann die umgehängte auch nicht mehr deaktivieren.
    expect(rows.filter((row) => row.personId === anna.personId && row.active)).toEqual([]);
    expect(httpOutcome(await deactivate(backend, anna.device, request.installationKey))).toBe('verweigert');
    expect((await installationOf(backend, request.installationKey))?.active).toBe(true);
  });

  it('nimmt die Person nie aus der Nutzlast', async () => {
    const { backend, anna, philipp } = await twoPeople();

    const reply = await register(backend, philipp.device, { ...registration(), personId: anna.personId } as RegisterPushInstallationRequest);

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ code: 'invalid_payload', retryable: false });
    expect(await installations(backend)).toEqual([]);
  });

  it('verweigert ein Konto ohne Person', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'ohne-person@example.test');

    expect(httpOutcome(await register(backend, device, registration()))).toBe('verweigert');
    expect(await installations(backend)).toEqual([]);
  });
});

describe('eigene Installation deaktivieren', () => {
  it('deaktiviert die eigene Installation und lässt sie bestehen', async () => {
    const { backend, philipp } = await twoPeople();
    const request = registration();
    await register(backend, philipp.device, request);

    const reply = await deactivate(backend, philipp.device, request.installationKey);

    expect(reply.status).toBe(204);
    expect(await installationOf(backend, request.installationKey)).toMatchObject({ personId: philipp.personId, active: false });
  });

  it('ist wiederholbar und für eine unbekannte eigene Kennung ohne Wirkung', async () => {
    const { backend, philipp } = await twoPeople();
    const request = registration();
    await register(backend, philipp.device, request);
    await deactivate(backend, philipp.device, request.installationKey);

    expect((await deactivate(backend, philipp.device, request.installationKey)).status).toBe(204);
    expect((await deactivate(backend, philipp.device, randomUUID())).status).toBe(204);
    expect(await installations(backend)).toHaveLength(1);
  });

  it('verbietet, eine fremde Installation zu deaktivieren', async () => {
    const { backend, anna, philipp } = await twoPeople();
    const request = registration();
    await register(backend, anna.device, request);

    const reply = await deactivate(backend, philipp.device, request.installationKey);

    expect(reply.status).toBe(403);
    expect(reply.body).toEqual({ code: 'forbidden', retryable: false });
    expect((await installationOf(backend, request.installationKey))?.active).toBe(true);
  });
});

describe('Abmelde-Haken', () => {
  it('das Abmelden deaktiviert die Installation dieser Sitzung, die eines anderen Geräts bleibt aktiv', async () => {
    const { backend, philipp } = await twoPeople();
    const iphone = registration();
    await register(backend, philipp.device, iphone);
    const tablet = await signInAgain(backend, 'philipp@example.test');
    const second = registration({ platform: 'android' });
    await register(backend, tablet, second);

    const reply = await call(backend, 'POST', '/v1/session/logout', philipp.device, { requestId: randomUUID() });

    expect(reply.status).toBe(200);
    expect((await installationOf(backend, iphone.installationKey))?.active).toBe(false);
    expect((await installationOf(backend, second.installationKey))?.active).toBe(true);
  });
});

describe('Tokens nie im Fach-Sync', () => {
  it('ein vollständiger Pull enthält weder Token noch Installation', async () => {
    const { backend, philipp } = await twoPeople();
    const request = registration();
    await register(backend, philipp.device, request);

    const pulled = await call(backend, 'POST', '/v1/sync/pull', philipp.device, {
      schemaVersion: currentSyncSchemaVersion,
      installationId: request.installationKey,
      cursor: null,
      pageToken: null,
    });

    expect(pulled.status).toBe(200);
    const text = JSON.stringify(pulled.body);
    expect(text).not.toContain(request.expoPushToken);
    expect(text).not.toContain('push_installation');
  });

});

// Negativtests des Autorisierungsgerüsts (#98), je mit positiver Gegenprobe.

type InstallationWorld = AuthorizationWorld & { installationKey: string; philippsKey: string };

async function installationWorld(): Promise<InstallationWorld> {
  const { backend, anna, philipp } = await twoPeople();
  const own = registration();
  const foreign = registration();
  await register(backend, anna.device, own);
  await register(backend, philipp.device, foreign);
  return { backend, actor: anna.device, alsoForeign: [philipp.device], installationKey: own.installationKey, philippsKey: foreign.installationKey };
}

const endpoints = {
  'POST /v1/push-installations': authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: '/v1/push-installations' },
    arrange: installationWorld,
    attempt: async ({ backend }, device) => httpOutcome(await register(backend, device, registration())),
  }),
  'POST /v1/push-installations/:installationKey/deactivate': authorizationCases({
    policy: policies.resource('push_installation', 'upsert'),
    route: { method: 'POST', path: '/v1/push-installations/:installationKey/deactivate' },
    arrange: installationWorld,
    attempt: async ({ backend, installationKey }, device) => httpOutcome(await deactivate(backend, device, installationKey)),
    manipulierte_id: async ({ backend, actor, philippsKey }) => httpOutcome(await deactivate(backend, actor, philippsKey)),
    // Löschen kennt die Matrix für Push-Installationen nicht; geprüft an derselben Installation.
    verbotene_operation: async ({ backend, actor, installationKey }) => {
      const row = await installationOf(backend, installationKey);
      return httpOutcome(await resourceProbe(backend, policies.resource('push_installation', 'loeschen'))(actor, { id: row?.id }));
    },
  }),
};

for (const [endpoint, cases] of Object.entries(endpoints)) {
  describe(endpoint, () => {
    for (const { name, run } of cases) it(name, run);
  });
}

