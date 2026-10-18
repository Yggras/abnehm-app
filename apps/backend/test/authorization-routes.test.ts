import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { guard, policies } from '../src/authorization/authorization.ts';
import { createTestBackend } from './support/app.ts';

// Deny by default an der HTTP-Grenze (Spezifikation 0, Abschnitt 11; #98): Jede Route braucht eine
// Policy, sonst lehnt das Modul sie ab, bevor Body-Validierung oder Fachlogik laufen.

const forbidden = { code: 'forbidden', retryable: false };

describe('Routen ohne Policy', () => {
  it('lehnt eine Route ohne Policy generisch ab, bevor ihr Handler läuft', async () => {
    const backend = await createTestBackend();
    let ran = false;
    const app = new Hono().use('*', backend.authorization.enforce).post('/v1/ohne-policy', (c) => {
      ran = true;
      return c.text('ok');
    });

    const response = await app.request('/v1/ohne-policy', { method: 'POST' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbidden);
    expect(ran).toBe(false);
  });

  it('lehnt eine Route ab, deren Guard nicht als erster Handler läuft', async () => {
    const backend = await createTestBackend();
    let ran = false;
    const app = new Hono().use('*', backend.authorization.enforce).get(
      '/v1/guard-zu-spaet',
      async (_c, next) => {
        ran = true;
        await next();
      },
      guard(policies.public()),
      (c) => c.text('ok'),
    );

    const response = await app.request('/v1/guard-zu-spaet');

    expect(response.status).toBe(403);
    expect(ran).toBe(false);
  });

  it('lehnt einen Guard ab, wenn die App-weite Prüfung fehlt', async () => {
    const app = new Hono().get('/v1/ohne-pruefung', guard(policies.public()), (c) => c.text('ok'));

    const response = await app.request('/v1/ohne-pruefung');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbidden);
  });

  it('lässt eine öffentliche Route durch und beantwortet unbekannte Pfade weiter mit 404', async () => {
    const backend = await createTestBackend();
    const app = new Hono().use('*', backend.authorization.enforce).get('/v1/offen', guard(policies.public()), (c) => c.text('ok'));

    expect((await app.request('/v1/offen')).status).toBe(200);
    expect((await app.request('/v1/gibt-es-nicht')).status).toBe(404);
  });
});
