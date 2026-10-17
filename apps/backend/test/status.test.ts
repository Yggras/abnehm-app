import { testClient } from 'hono/testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { StatusResponse } from '@abnehm/contracts/status';

import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/database.ts';
import { createTestDatabase, testServerSettings } from './support/postgres.ts';

describe('GET /v1/status', () => {
  it('antwortet nach einer Abfrage an Postgres mit der Datenbankzeit', async () => {
    const database = await createTestDatabase();
    onTestFinished(() => database.drop());
    const client = testClient(createApp({ database: database.handle }));

    const before = Date.now();
    const response = await client.v1.status.$get();

    expect(response.status).toBe(200);
    const body = StatusResponse.parse(await response.json());
    if (body.type !== 'ok') throw new Error(`Unerwartete Antwort: ${body.type}`);
    // Postgres' now() ist der Beginn der Abfrage-Transaktion, also nicht vor dem Aufruf.
    expect(Date.parse(body.databaseTime)).toBeGreaterThanOrEqual(before - 1_000);
    expect(Date.parse(body.databaseTime)).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('meldet eine nicht erreichbare Datenbank mit 503 und ohne Fehlertext', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = openDatabase({ ...testServerSettings(), database: 'gibt_es_nicht' });
    onTestFinished(() => handle.close());
    const client = testClient(createApp({ database: handle }));

    const response = await client.v1.status.$get();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ type: 'database_unavailable' });
  });

  it('kennt keine unversionierten Pfade', async () => {
    const database = await createTestDatabase();
    onTestFinished(() => database.drop());

    const response = await createApp({ database: database.handle }).request('/status');

    expect(response.status).toBe(404);
  });
});
