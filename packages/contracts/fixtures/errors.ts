import { ContractError, ContractErrorCode } from '../src/errors.ts';
import { fixtures } from './define.ts';
import { now, philipp } from './ids.ts';

export const errorFixtures = {
  ContractErrorCode: fixtures(ContractErrorCode, {
    valid: {
      'Vertragsfehler': 'invalid_payload',
      'Einladungscode': 'invite_rate_limited',
      'Fotocode': 'photo_analysis_limit_reached',
    },
    invalid: { 'unbekannt': 'not_found', 'HTTP-Status': 404 },
  }),
  ContractError: fixtures(ContractError, {
    valid: {
      'ohne Kontext': { code: 'forbidden', retryable: false },
      'mit strukturiertem Kontext': {
        code: 'operation_conflict',
        context: { operationId: philipp, receivedAt: now, attempts: 2, paths: ['payload.localDate'], final: true },
        retryable: false,
      },
    },
    invalid: {
      'sichtbarer Text im Kontext': {
        code: 'invite_invalid',
        context: { hint: 'Dieser Code passt nicht.' },
        retryable: false,
      },
      'Nachricht statt Code': { code: 'forbidden', message: 'Kein Zugriff', retryable: false },
      'ohne retryable': { code: 'conflict' },
      'verschachtelter Kontext': { code: 'conflict', context: { entity: { id: philipp } }, retryable: true },
    },
  }),
};
