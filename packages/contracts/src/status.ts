import { z } from 'zod';

import { Instant } from './base.ts';

/**
 * Antwort des versionierten Status-Endpunkts (`GET /v1/status`). Das Backend
 * antwortet erst nach einer Abfrage an Postgres; `databaseTime` ist deren Ergebnis.
 */
export const StatusResponse = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ok'), databaseTime: Instant }),
  z.strictObject({ type: z.literal('database_unavailable') }),
]);
export type StatusResponse = z.infer<typeof StatusResponse>;
