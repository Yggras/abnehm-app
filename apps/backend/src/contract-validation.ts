import { validator } from 'hono/validator';
import type { z } from 'zod';

import type { ContractError } from '@abnehm/contracts/errors';

const invalidPayload = { code: 'invalid_payload', retryable: false } as const satisfies ContractError;

/**
 * Validiert den JSON-Body eines Endpunkts mit einem Schema aus `@abnehm/contracts`. Ungültige
 * Nutzlasten beantwortet er mit `400` und dem `ContractError` `invalid_payload`, ohne Details aus
 * der Validierung; der Handler erhält über `c.req.valid('json')` den geprüften Wert.
 */
export function jsonBody<S extends z.ZodType>(schema: S) {
  return validator('json', (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) return c.json(invalidPayload, 400);
    return result.data as z.output<S>;
  });
}
