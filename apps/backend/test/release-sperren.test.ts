import { describe, expect, it } from 'vitest';

import { testCapabilities } from '../../../test/test-capabilities.ts';
import { createTestBackend } from './support/app.ts';
import { call, newDevice } from './support/auth-client.ts';

// Release-Sperren am laufenden Backend (#112): Die App des Backends, wie `src/main.ts` sie startet,
// beantwortet keine Route einer registrierten Testfähigkeit. Dass das Produktions-Image ihren Code gar
// nicht enthält, prüft test/release-sperren.test.ts.

const routes = testCapabilities.flatMap(({ key, entries }) => (entries.backendRoutes ?? []).map((route) => [key, route] as const));

describe('Produktives Backend', () => {
  it('kennt die registrierten Routen der Testfähigkeiten', () => {
    expect(routes.map(([, route]) => route)).toContain('POST /dev/seed');
  });

  it.each(routes)('%s: %s fehlt (404)', async (_, route) => {
    const backend = await createTestBackend();
    const [method, path] = route.split(' ') as ['GET' | 'POST', string];
    expect((await call(backend, method, path, newDevice(), method === 'POST' ? { scenario: 'solo' } : undefined)).status).toBe(404);
    expect(backend.app.routes.some((candidate) => candidate.path === path)).toBe(false);
  });
});
