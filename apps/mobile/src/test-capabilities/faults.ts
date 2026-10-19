import { z } from 'zod';

import type { SessionStore } from '../auth/app-auth';

// Fehler-Adapter (Spezifikation 0, Abschnitt 12; #112): Transport-, Server-, Auth- und
// Storage-Fehler, ausschließlich deterministisch über diesen Schalter gesteuert, nie zufällig. Die
// Adapter umhüllen die echten Abhängigkeiten der App-Sitzung (`fetch`, SessionStore); es gibt sie
// nur im Development Build und in Tests, nie im Produktions-Bundle (Release-Test).

export const faultPlanSchema = z.strictObject({
  /** `offline`: keine Verbindung; `response_lost`: der Server verarbeitet, die Antwort geht verloren. */
  transport: z.enum(['ok', 'offline', 'response_lost']),
  /** `unavailable`: vorübergehender Serverfehler, `503` ohne Body wie beim echten Backend. */
  server: z.enum(['ok', 'unavailable']),
  /** `session_rejected`: der Server lehnt jede Sitzung ab (`401`). */
  auth: z.enum(['ok', 'session_rejected']),
  /** `unavailable`: der geschützte Speicher (SecureStore) liest und schreibt nicht. */
  storage: z.enum(['ok', 'unavailable']),
});
export type FaultPlan = z.infer<typeof faultPlanSchema>;

export const noFaults: FaultPlan = { transport: 'ok', server: 'ok', auth: 'ok', storage: 'ok' };

export type FaultController = {
  plan(): FaultPlan;
  set(change: Partial<FaultPlan>): void;
  reset(): void;
};

export function createFaultController(initial: Partial<FaultPlan> = {}): FaultController {
  let current = faultPlanSchema.parse({ ...noFaults, ...initial });
  return {
    plan: () => current,
    set: (change) => {
      current = faultPlanSchema.parse({ ...current, ...change });
    },
    reset: () => {
      current = noFaults;
    },
  };
}

/** Die Meldung, mit der `fetch` in React Native ohne Verbindung scheitert. */
const networkFailure = () => new TypeError('Network request failed');

/** `fetch` mit den Transport-, Server- und Auth-Fehlern des aktuellen Plans. */
export function faultyFetch(inner: typeof fetch, faults: FaultController): typeof fetch {
  return async (input, init) => {
    const plan = faults.plan();
    if (plan.transport === 'offline') throw networkFailure();
    if (plan.server === 'unavailable') return new Response(null, { status: 503 });
    if (plan.auth === 'session_rejected' && new Headers(init?.headers).has('authorization')) return new Response(null, { status: 401 });
    const response = await inner(input, init);
    if (plan.transport === 'response_lost') throw networkFailure();
    return response;
  };
}

/** SessionStore, der bei `storage: unavailable` wie ein gesperrter Schlüsselbund scheitert. */
export function faultySessionStore(inner: SessionStore, faults: FaultController): SessionStore {
  const guarded =
    <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      if (faults.plan().storage === 'unavailable') throw new Error('Geschützter Speicher nicht verfügbar (Fehler-Adapter)');
      return operation(...args);
    };
  return { read: guarded(() => inner.read()), write: guarded((session) => inner.write(session)), clear: guarded(() => inner.clear()) };
}
