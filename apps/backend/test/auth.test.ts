import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BootstrapPersonResult } from '@abnehm/contracts/auth';

import { loginLimits } from '../src/auth/login-limiter.ts';
import { changeLog, person, user } from '../src/db/schema/index.ts';
import { createTestBackend } from './support/app.ts';
import {
  call,
  defaultPassword,
  newDevice,
  securityLogEntries,
  sessionIsValid,
  signIn,
  signUp,
} from './support/auth-client.ts';

// Auth-Modul über HTTP (Spezifikation 0, Abschnitt 9; #97): echte Hono-App, echtes Postgres.
// Better Auth rechnet Sitzungsablauf und eigene Begrenzung mit `Date`; die Tests stellen die Zeit
// deshalb mit `vi.setSystemTime`, die Systemuhr des Backends liest dieselbe Zeit.

const DAY_MS = 24 * 60 * 60 * 1000;

function useFakeDate(start = '2026-10-14T12:00:00.000Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(start));
}
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

afterEach(() => {
  vi.useRealTimers();
});

describe('Registrierung und Passwortregeln', () => {
  it.each([
    ['9 Zeichen', 'a1b2c3d4e', 400, 'PASSWORD_TOO_SHORT'],
    ['129 Zeichen', 'x'.repeat(129), 400, 'PASSWORD_TOO_LONG'],
    ['von der Blocklist', 'password123', 400, 'PASSWORD_COMPROMISED'],
    ['von der Blocklist, andere Schreibweise', 'PassWord123', 400, 'PASSWORD_COMPROMISED'],
  ])('lehnt ein Passwort mit %s ab', async (_name, password, status, code) => {
    const backend = await createTestBackend();

    const reply = await call(backend, 'POST', '/v1/auth/sign-up/email', newDevice(), { email: 'anna@example.test', password, name: '' });

    expect(reply.status).toBe(status);
    expect(reply.body).toMatchObject({ code });
    expect(await backend.database.db.select().from(user)).toEqual([]);
  });

  it.each([
    ['genau 10 Zeichen', 'k7#qPz!m2w'],
    ['64 Zeichen', 'Lagune-'.repeat(9) + 'x'],
    ['eine Passphrase ohne Ziffern und Sonderzeichen', 'grüne wiese am fluss'],
  ])('nimmt ein Passwort mit %s an, ohne starre Zeichengruppen', async (_name, password) => {
    const backend = await createTestBackend();

    const reply = await call(backend, 'POST', '/v1/auth/sign-up/email', newDevice(), { email: 'anna@example.test', password, name: '' });

    expect(reply.status).toBe(200);
  });

  it('legt das Konto ohne E-Mail-Verifikation an, meldet das Gerät an und speichert keinen Namen am Konto', async () => {
    const backend = await createTestBackend();

    const { device, accountId } = await signUp(backend, 'Anna@Example.test');

    expect(await sessionIsValid(backend, device)).toBe(true);
    const [row] = await backend.database.db.select().from(user).where(eq(user.id, accountId));
    expect(row).toMatchObject({ email: 'anna@example.test', name: '', emailVerified: false });
  });
});

describe('Bootstrap der Person', () => {
  const bootstrap = { displayName: 'Anna', timeZone: 'Europe/Berlin' };

  it('erzeugt genau eine Person mit servergesetztem Konto, Namen und Onboarding-Stand „begonnen“', async () => {
    const backend = await createTestBackend();
    const { device, accountId } = await signUp(backend, 'anna@example.test');

    const first = await call(backend, 'POST', '/v1/person/bootstrap', device, bootstrap);
    const second = await call(backend, 'POST', '/v1/person/bootstrap', device, { displayName: 'Anderer Name', timeZone: 'America/New_York' });

    expect(first.status).toBe(200);
    const created = BootstrapPersonResult.parse(first.body);
    expect(created).toMatchObject({ displayName: 'Anna', onboardingStatus: 'begonnen', timeZone: 'Europe/Berlin' });
    expect(second).toMatchObject({ status: 200, body: first.body });
    const people = await backend.database.db.select().from(person);
    expect(people).toEqual([expect.objectContaining({ id: created.personId, accountId, displayName: 'Anna' })]);
    expect(await backend.database.db.select().from(changeLog)).toEqual([
      expect.objectContaining({ entityType: 'person', entityId: created.personId, ownerPersonId: created.personId }),
    ]);
  });

  it('legt auch bei gleichzeitigen Aufrufen nur eine Person an', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');

    const replies = await Promise.all([1, 2, 3].map(() => call(backend, 'POST', '/v1/person/bootstrap', device, bootstrap)));

    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200]);
    expect(new Set(replies.map((reply) => (reply.body as BootstrapPersonResult).personId)).size).toBe(1);
    expect(await backend.database.db.select().from(person)).toHaveLength(1);
  });

  it('lässt sich durch mitgeschickte Konto- oder Personen-IDs nicht umbinden', async () => {
    const backend = await createTestBackend();
    const anna = await signUp(backend, 'anna@example.test');
    const annaPerson = BootstrapPersonResult.parse((await call(backend, 'POST', '/v1/person/bootstrap', anna.device, bootstrap)).body);
    const philipp = await signUp(backend, 'philipp@example.test');

    const manipulated = [
      { ...bootstrap, personId: annaPerson.personId },
      { ...bootstrap, accountId: anna.accountId },
      { ...bootstrap, account_id: anna.accountId, person_id: annaPerson.personId },
    ];
    for (const body of manipulated) {
      const reply = await call(backend, 'POST', '/v1/person/bootstrap', philipp.device, body);
      expect(reply).toMatchObject({ status: 400, body: { code: 'invalid_payload' } });
    }
    const viaQuery = await call(backend, 'POST', `/v1/person/bootstrap?accountId=${anna.accountId}`, philipp.device, {
      displayName: 'Philipp',
      timeZone: 'Europe/Berlin',
    });

    const philippPerson = BootstrapPersonResult.parse(viaQuery.body);
    expect(philippPerson.personId).not.toBe(annaPerson.personId);
    const rows = await backend.database.db.select({ id: person.id, accountId: person.accountId, displayName: person.displayName }).from(person);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: annaPerson.personId, accountId: anna.accountId, displayName: 'Anna' },
        { id: philippPerson.personId, accountId: philipp.accountId, displayName: 'Philipp' },
      ]),
    );
  });

  it('antwortet ohne gültige Sitzung mit 401 ohne Body, noch vor der Prüfung der Nutzlast', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');
    await call(backend, 'POST', '/v1/session/logout', device, { requestId: randomUUID() });

    for (const caller of [newDevice(), device, { ...newDevice(), token: 'gefaelscht' }]) {
      for (const body of [bootstrap, { kaputt: true }]) {
        expect(await call(backend, 'POST', '/v1/person/bootstrap', caller, body)).toMatchObject({ status: 401, body: null });
      }
    }
    expect(await backend.database.db.select().from(person)).toEqual([]);
  });
});

describe('Anmeldung', () => {
  it('liefert bei falschem Passwort und unbekannter E-Mail dieselbe sichtbare Antwort', async () => {
    const backend = await createTestBackend();
    await signUp(backend, 'anna@example.test');

    const wrongPassword = await signIn(backend, 'anna@example.test', 'falsches-passwort');
    const unknownEmail = await signIn(backend, 'niemand@example.test', 'falsches-passwort');

    expect(wrongPassword.reply.status).toBe(401);
    expect(unknownEmail.reply.status).toBe(wrongPassword.reply.status);
    expect(unknownEmail.reply.body).toEqual(wrongPassword.reply.body);
  });

  it('meldet ein weiteres Gerät an; beide Sitzungen gelten nebeneinander', async () => {
    const backend = await createTestBackend();
    const { device: phone } = await signUp(backend, 'anna@example.test');

    const { reply, device: tablet } = await signIn(backend, 'ANNA@example.test', defaultPassword);

    expect(reply.status).toBe(200);
    expect(await sessionIsValid(backend, phone)).toBe(true);
    expect(await sessionIsValid(backend, tablet)).toBe(true);
  });

  it('begrenzt Fehlversuche pro Konto, auch über wechselnde IPs, und gibt das Konto nach dem Fenster wieder frei', async () => {
    useFakeDate();
    const backend = await createTestBackend();
    const { accountId } = await signUp(backend, 'anna@example.test');

    for (let attempt = 0; attempt < loginLimits.perAccount.max; attempt++) {
      expect((await signIn(backend, 'anna@example.test', 'falsches-passwort')).reply.status).toBe(401);
    }
    const blocked = await signIn(backend, 'anna@example.test', defaultPassword);
    expect(blocked.reply).toMatchObject({ status: 429, body: { code: 'TOO_MANY_LOGIN_ATTEMPTS' } });

    advance(loginLimits.perAccount.windowMs);
    expect((await signIn(backend, 'anna@example.test', defaultPassword)).reply.status).toBe(200);

    const failures = (await securityLogEntries(backend)).filter((entry) => entry.eventType === 'anmeldung_fehlgeschlagen');
    expect(failures).toHaveLength(loginLimits.perAccount.max + 1);
    expect(failures.at(-1)).toMatchObject({ accountId, details: { reason: 'begrenzt' } });
  });

  it('sperrt eine unbekannte E-Mail genauso wie eine registrierte und verrät so keine Registrierung', async () => {
    const backend = await createTestBackend();
    await signUp(backend, 'anna@example.test');

    const replies = [];
    for (const email of ['anna@example.test', 'niemand@example.test']) {
      for (let attempt = 0; attempt < loginLimits.perAccount.max; attempt++) await signIn(backend, email, 'falsches-passwort');
      replies.push((await signIn(backend, email, 'falsches-passwort')).reply);
    }

    expect(replies[0]).toMatchObject({ status: 429 });
    expect(replies[1]!.status).toBe(replies[0]!.status);
    expect(replies[1]!.body).toEqual(replies[0]!.body);
  });

  it('begrenzt Fehlversuche pro IP über verschiedene Konten', async () => {
    useFakeDate();
    const backend = await createTestBackend();
    await signUp(backend, 'anna@example.test');
    const attacker = newDevice();

    for (let attempt = 0; attempt < loginLimits.perIp.max; attempt++) {
      // Je 11 Sekunden Abstand: Die eingebaute Begrenzung von Better Auth (3 Anfragen, Fenster ab der
      // letzten Anfrage 10 Sekunden) greift so nicht, die eigene pro IP schon.
      advance(11_000);
      const { reply } = await signIn(backend, `opfer-${attempt}@example.test`, 'falsches-passwort', { ...attacker });
      expect(reply.status).toBe(401);
    }
    advance(11_000);

    expect((await signIn(backend, 'anna@example.test', defaultPassword, { ...attacker })).reply).toMatchObject({
      status: 429,
      body: { code: 'TOO_MANY_LOGIN_ATTEMPTS' },
    });
    expect((await signIn(backend, 'anna@example.test', defaultPassword)).reply.status).toBe(200);
  });

  it('protokolliert Anmeldung und Fehlschlag ohne E-Mail oder Passwort', async () => {
    const backend = await createTestBackend();
    const { accountId } = await signUp(backend, 'anna@example.test');
    const device = newDevice();

    await signIn(backend, 'anna@example.test', 'falsches-passwort', device);
    await signIn(backend, 'niemand@example.test', 'falsches-passwort', device);
    await signIn(backend, 'anna@example.test', defaultPassword, device);

    const entries = await securityLogEntries(backend);
    expect(entries).toEqual(
      expect.arrayContaining([
        { eventType: 'anmeldung_fehlgeschlagen', accountId, details: { accountId, reason: 'zugangsdaten_falsch', ipAddress: device.ip } },
        { eventType: 'anmeldung_fehlgeschlagen', accountId: null, details: { accountId: null, reason: 'zugangsdaten_falsch', ipAddress: device.ip } },
        { eventType: 'anmeldung', accountId, details: { accountId, ipAddress: device.ip } },
      ]),
    );
    expect(entries).toHaveLength(3);
    const logged = JSON.stringify(entries);
    expect(logged).not.toMatch(/example\.test|passwort|passphrase/);
  });
});

describe('Sitzungen', () => {
  it('laufen nach 30 Tagen ohne Nutzung ab und verlängern sich bei Nutzung', async () => {
    useFakeDate();
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');

    advance(29 * DAY_MS);
    expect(await sessionIsValid(backend, device)).toBe(true);
    advance(29 * DAY_MS);
    expect(await sessionIsValid(backend, device)).toBe(true);
    advance(30 * DAY_MS + 60_000);
    expect(await sessionIsValid(backend, device)).toBe(false);
    expect(await call(backend, 'GET', '/v1/auth/get-session', device)).toMatchObject({ status: 200, body: null });
  });

  it('widerruft über das serverseitige Primitive genau die aktuelle Sitzung, idempotent', async () => {
    const backend = await createTestBackend();
    const { device: phone, accountId } = await signUp(backend, 'anna@example.test');
    const { device: tablet } = await signIn(backend, 'anna@example.test', defaultPassword);
    const current = await backend.auth.sessions.authenticate(new Headers({ authorization: `Bearer ${phone.token}` }));

    await backend.auth.revokeSession(current!, 'widerruf');
    await backend.auth.revokeSession(current!, 'widerruf');

    expect(await call(backend, 'GET', '/v1/auth/get-session', phone)).toMatchObject({ status: 200, body: null });
    expect(await sessionIsValid(backend, tablet)).toBe(true);
    expect((await securityLogEntries(backend)).filter((entry) => entry.eventType === 'sitzungswiderruf')).toEqual([
      { eventType: 'sitzungswiderruf', accountId, details: { accountId, scope: 'aktuelle', cause: 'widerruf' } },
    ]);
  });

  it('kennt nur die freigegebenen Better-Auth-Abläufe; einen öffentlichen Reset gibt es nicht', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');

    for (const path of [
      '/v1/auth/sign-out',
      '/v1/auth/revoke-sessions',
      '/v1/auth/revoke-other-sessions',
      '/v1/auth/update-user',
      '/v1/auth/delete-user',
      '/v1/auth/change-email',
      '/v1/auth/request-password-reset',
      '/v1/auth/reset-password',
    ]) {
      expect((await call(backend, 'POST', path, device, {})).status, path).toBe(404);
    }
    expect((await call(backend, 'GET', '/v1/auth/list-sessions', device)).status).toBe(404);
    expect(await sessionIsValid(backend, device)).toBe(true);
  });
});

describe('Passwort ändern', () => {
  it('widerruft alle Sitzungen, auch wenn der Client es abwählt; das ändernde Gerät erhält eine neue', async () => {
    const backend = await createTestBackend();
    const { device: phone, accountId } = await signUp(backend, 'anna@example.test');
    const { device: tablet } = await signIn(backend, 'anna@example.test', defaultPassword);
    const oldPhoneToken = phone.token;

    const reply = await call(backend, 'POST', '/v1/auth/change-password', phone, {
      currentPassword: defaultPassword,
      newPassword: 'ganz-neue-passphrase',
      revokeOtherSessions: false,
    });

    expect(reply.status).toBe(200);
    const newToken = (reply.body as { token: string | null }).token;
    expect(newToken).toEqual(expect.any(String));
    expect(await sessionIsValid(backend, { ...phone, token: oldPhoneToken })).toBe(false);
    // Der Widerruf wirkt beim nächsten Aufruf des anderen Geräts.
    expect(await call(backend, 'POST', '/v1/person/bootstrap', tablet, { displayName: 'Anna', timeZone: 'Europe/Berlin' })).toMatchObject({
      status: 401,
      body: null,
    });
    expect(await sessionIsValid(backend, { ...phone, token: newToken! })).toBe(true);
    expect((await signIn(backend, 'anna@example.test', defaultPassword)).reply.status).toBe(401);
    expect((await signIn(backend, 'anna@example.test', 'ganz-neue-passphrase')).reply.status).toBe(200);
    expect(await securityLogEntries(backend)).toEqual(
      expect.arrayContaining([
        { eventType: 'passwortaenderung', accountId, details: { accountId } },
        { eventType: 'sitzungswiderruf', accountId, details: { accountId, scope: 'alle', cause: 'passwortaenderung' } },
      ]),
    );
  });

  it('lehnt ein falsches aktuelles und ein kompromittiertes neues Passwort ab und lässt die Sitzungen bestehen', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');

    const wrongCurrent = await call(backend, 'POST', '/v1/auth/change-password', device, {
      currentPassword: 'falsches-passwort',
      newPassword: 'ganz-neue-passphrase',
    });
    const compromised = await call(backend, 'POST', '/v1/auth/change-password', { ...device, ip: newDevice().ip }, {
      currentPassword: defaultPassword,
      newPassword: 'qwertyuiop',
    });

    expect(wrongCurrent).toMatchObject({ status: 400, body: { code: 'INVALID_PASSWORD' } });
    expect(compromised).toMatchObject({ status: 400, body: { code: 'PASSWORD_COMPROMISED' } });
    expect(await sessionIsValid(backend, device)).toBe(true);
    expect((await securityLogEntries(backend)).map((entry) => entry.eventType)).not.toContain('passwortaenderung');
  });
});

describe('Admin-Reset', () => {
  it('setzt ein neues Passwort, widerruft alle Sitzungen und protokolliert den administrativen Zugriff', async () => {
    const backend = await createTestBackend();
    const { device: phone, accountId } = await signUp(backend, 'anna@example.test');
    const { device: tablet } = await signIn(backend, 'anna@example.test', defaultPassword);

    const result = await backend.auth.admin.resetPassword(' Anna@Example.test ');

    if (result.type !== 'reset') throw new Error('Konto nicht gefunden');
    expect(result.password.length).toBeGreaterThanOrEqual(10);
    expect(await sessionIsValid(backend, phone)).toBe(false);
    expect(await sessionIsValid(backend, tablet)).toBe(false);
    expect((await signIn(backend, 'anna@example.test', defaultPassword)).reply.status).toBe(401);
    expect((await signIn(backend, 'anna@example.test', result.password)).reply.status).toBe(200);
    expect(await securityLogEntries(backend)).toEqual(
      expect.arrayContaining([
        { eventType: 'administrativer_zugriff', accountId, details: { command: 'passwort_reset', targetAccountId: accountId } },
        { eventType: 'passwort_reset', accountId, details: { accountId } },
        { eventType: 'sitzungswiderruf', accountId, details: { accountId, scope: 'alle', cause: 'passwort_reset' } },
      ]),
    );
    expect(JSON.stringify(await securityLogEntries(backend))).not.toContain(result.password);
  });

  it('meldet ein unbekanntes Konto und protokolliert auch diesen Zugriff', async () => {
    const backend = await createTestBackend();

    expect(await backend.auth.admin.resetPassword('niemand@example.test')).toEqual({ type: 'unknown_account' });
    expect(await securityLogEntries(backend)).toEqual([
      { eventType: 'administrativer_zugriff', accountId: null, details: { command: 'passwort_reset', targetAccountId: null } },
    ]);
  });
});
