import { randomUUID } from 'node:crypto';

import { describe, it } from 'vitest';

import { policies } from '../src/authorization/authorization.ts';
import { createTestBackend } from './support/app.ts';
import { call, defaultPassword, newDevice, signUp } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, personWithSession, type AuthorizationWorld } from './support/authorization.ts';

// Status-, Auth-, Bootstrap- und Einladungs-Endpunkte über das Autorisierungsmodul (#98, #103), jeweils
// mit den Fällen ihrer Policy aus dem Negativtest-Gerüst.

const world = async (): Promise<AuthorizationWorld> => {
  const backend = await createTestBackend();
  return { backend, actor: newDevice() };
};
const signedUp = async (): Promise<AuthorizationWorld> => {
  const backend = await createTestBackend();
  return { backend, actor: (await signUp(backend, 'anna@example.test')).device };
};

const endpoints = {
  'GET /v1/status': authorizationCases({
    policy: policies.public(),
    route: { method: 'GET', path: '/v1/status' },
    arrange: world,
    attempt: async ({ backend }, device) => httpOutcome(await call(backend, 'GET', '/v1/status', device)),
  }),
  'POST /v1/auth/sign-up/email': authorizationCases({
    policy: policies.public(),
    route: { method: 'POST', path: '/v1/auth/sign-up/email' },
    arrange: world,
    attempt: async ({ backend }, device) =>
      httpOutcome(await call(backend, 'POST', '/v1/auth/sign-up/email', device, { email: 'anna@example.test', password: defaultPassword, name: '' })),
  }),
  'POST /v1/auth/sign-in/email': authorizationCases({
    policy: policies.public(),
    route: { method: 'POST', path: '/v1/auth/sign-in/email' },
    arrange: signedUp,
    attempt: async ({ backend }, device) =>
      httpOutcome(await call(backend, 'POST', '/v1/auth/sign-in/email', device, { email: 'anna@example.test', password: defaultPassword })),
  }),
  'GET /v1/auth/get-session': authorizationCases({
    policy: policies.public(),
    route: { method: 'GET', path: '/v1/auth/get-session' },
    arrange: signedUp,
    attempt: async ({ backend }, device) => httpOutcome(await call(backend, 'GET', '/v1/auth/get-session', device)),
  }),
  'POST /v1/auth/change-password': authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: '/v1/auth/change-password' },
    arrange: signedUp,
    attempt: async ({ backend }, device) =>
      httpOutcome(
        await call(backend, 'POST', '/v1/auth/change-password', device, { currentPassword: defaultPassword, newPassword: defaultPassword }),
      ),
  }),
  'POST /v1/session/revoke': authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: '/v1/session/revoke' },
    arrange: signedUp,
    attempt: async ({ backend }, device) => httpOutcome(await call(backend, 'POST', '/v1/session/revoke', device)),
  }),
  'POST /v1/person/bootstrap': authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: '/v1/person/bootstrap' },
    arrange: async () => {
      const backend = await createTestBackend();
      return { backend, actor: (await personWithSession(backend, 'anna@example.test', 'Anna')).device };
    },
    attempt: async ({ backend }, device) =>
      httpOutcome(await call(backend, 'POST', '/v1/person/bootstrap', device, { displayName: 'Anna', timeZone: 'Europe/Berlin' })),
  }),
  ...invitationEndpoints(),
};

/** Die Einladungsabläufe: Anna handelt, Philipp hat einen offenen Code erzeugt. */
function invitationEndpoints() {
  type InvitationWorld = AuthorizationWorld & { code: string };
  const arrange = async (): Promise<InvitationWorld> => {
    const backend = await createTestBackend();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const created = await call(backend, 'POST', '/v1/invitations', philipp.device, { requestId: randomUUID() });
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    return { backend, actor: anna.device, code: (created.body as { code: string }).code };
  };
  return {
    'POST /v1/invitations': authorizationCases({
      policy: policies.authenticated(),
      route: { method: 'POST', path: '/v1/invitations' },
      arrange,
      attempt: async ({ backend }, device) => httpOutcome(await call(backend, 'POST', '/v1/invitations', device, { requestId: randomUUID() })),
    }),
    'POST /v1/invitations/check': authorizationCases({
      policy: policies.authenticated(),
      route: { method: 'POST', path: '/v1/invitations/check' },
      arrange,
      attempt: async ({ backend, code }, device) => httpOutcome(await call(backend, 'POST', '/v1/invitations/check', device, { code })),
    }),
    'POST /v1/invitations/accept': authorizationCases({
      policy: policies.authenticated(),
      route: { method: 'POST', path: '/v1/invitations/accept' },
      arrange,
      attempt: async ({ backend, code }, device) =>
        httpOutcome(await call(backend, 'POST', '/v1/invitations/accept', device, { requestId: randomUUID(), code })),
    }),
  };
}

for (const [endpoint, cases] of Object.entries(endpoints)) {
  describe(endpoint, () => {
    for (const { name, run } of cases) it(name, run);
  });
}
