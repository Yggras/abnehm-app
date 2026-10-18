import { StatusResponse } from '../src/status.ts';
import { fixtures } from './define.ts';
import { now } from './ids.ts';

export const statusFixtures = {
  StatusResponse: fixtures(StatusResponse, {
    valid: { 'erreichbar': { type: 'ok', databaseTime: now }, 'Datenbank fehlt': { type: 'database_unavailable' } },
    invalid: {
      'ohne Datenbankzeit': { type: 'ok' },
      'mit Fehlertext': { type: 'database_unavailable', message: 'Datenbank nicht erreichbar' },
    },
  }),
};
