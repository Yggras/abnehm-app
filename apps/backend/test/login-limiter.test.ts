import { describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createLoginLimiter, loginLimits } from '../src/auth/login-limiter.ts';

// Grenzfall, den die HTTP-Tests nicht erreichen: In Tests ergänzt Better Auth eine fehlende IP mit
// 127.0.0.1, in Produktion bleibt sie ohne passenden Proxy-Header unbekannt.

const clock = () => createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('UTC') });

describe('Begrenzung der Anmeldeversuche', () => {
  it('teilt ohne erkennbare IP keinen gemeinsamen Zähler; es greift nur die Begrenzung pro Konto', () => {
    const limiter = createLoginLimiter({ clock: clock() });

    for (let n = 0; n <= loginLimits.perIp.maxFailures; n++) {
      limiter.recordFailure({ email: `opfer-${n}@example.test`, ipAddress: null });
    }

    expect(limiter.isBlocked({ email: 'anna@example.test', ipAddress: null })).toBe(false);
    for (let n = 0; n < loginLimits.perAccount.maxFailures; n++) limiter.recordFailure({ email: 'Anna@Example.test', ipAddress: null });
    expect(limiter.isBlocked({ email: 'anna@example.test', ipAddress: null })).toBe(true);
  });
});
