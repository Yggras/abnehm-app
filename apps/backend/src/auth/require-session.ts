import { createMiddleware } from 'hono/factory';

import type { AuthenticatedSession, SessionAuthenticator } from './auth-module.ts';

/**
 * Verlangt eine gültige Sitzung, bevor Body-Validierung oder Fachlogik laufen. Ohne Sitzung, bei
 * widerrufener oder abgelaufener antwortet der Endpunkt mit `401` ohne Body, also ohne Teilantwort.
 * Konto und Sitzung stehen danach in `c.var.session`; IDs aus dem Request begründen nie Zugriff.
 */
export function requireSession(sessions: SessionAuthenticator) {
  return createMiddleware<{ Variables: { session: AuthenticatedSession } }>(async (c, next) => {
    const current = await sessions.authenticate(c.req.raw.headers);
    if (current === null) return c.body(null, 401);
    c.set('session', current);
    await next();
  });
}
