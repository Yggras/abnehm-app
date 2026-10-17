import { describe, expect, it } from 'vitest';

import { StatusResponse } from '../src/status.ts';

describe('StatusResponse', () => {
  it.each([
    { type: 'ok', databaseTime: '2026-10-14T12:00:00.000Z' },
    { type: 'database_unavailable' },
  ])('akzeptiert %j', (value) => {
    expect(StatusResponse.safeParse(value).success).toBe(true);
  });

  it.each([
    { type: 'ok' },
    { type: 'ok', databaseTime: '14.10.2026 12:00' },
    { type: 'database_unavailable', message: 'Datenbank nicht erreichbar' },
    { status: 'ok' },
  ])('lehnt %j ab', (value) => {
    expect(StatusResponse.safeParse(value).success).toBe(false);
  });
});
