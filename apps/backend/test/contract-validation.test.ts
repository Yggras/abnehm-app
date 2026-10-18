import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { fixtureCases } from '@abnehm/contracts/fixtures';
import { UpdatePersonTimeZone } from '@abnehm/contracts/person';

import { jsonBody } from '../src/contract-validation.ts';

// Vertragstests im Backend (#94): Jedes Fixture des Vertragsmoduls geht als JSON durch eine
// Hono-Validierung. Gültige kommen unverändert beim Handler an, ungültige enden mit `400` und
// `invalid_payload` – dieselben Ergebnisse wie in der Testumgebung der App.

async function post(schema: Parameters<typeof jsonBody>[0], value: unknown) {
  const app = new Hono().post('/', jsonBody(schema), (c) => c.json({ received: c.req.valid('json') }, 200));
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}

describe.each(fixtureCases())('$name', ({ schema, value, valid }) => {
  if (valid) {
    it('erreicht den Handler unverändert', async () => {
      const response = await post(schema, value);

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({ received: value });
    });
  } else {
    it('wird mit 400 und invalid_payload abgewiesen', async () => {
      const response = await post(schema, value);

      expect(response.status).toBe(400);
      expect(await response.json()).toStrictEqual({ code: 'invalid_payload', retryable: false });
    });
  }
});

describe('jsonBody', () => {
  it('weist einen Body ohne JSON ab, bevor das Schema greift', async () => {
    const app = new Hono().post('/', jsonBody(UpdatePersonTimeZone), (c) => c.json({}, 200));

    const response = await app.request('/', { method: 'POST', body: 'kein json' });

    expect(response.status).toBe(400);
  });
});
