import { verifyPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { canonicalRows, seedManifests, seedPassword, seedRoutePath, type SeedManifest } from '@abnehm/contracts/seeds';

import { createDevelopmentApp } from '../dev/app.ts';
import { dumpServer, seedServer, tablesWithEmail } from '../dev/seed/server-seed.ts';
import { account, person, session, user } from '../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { call, newDevice, signIn } from './support/auth-client.ts';

// Nachweis für #112: Seed-Mechanismus für Postgres, Seed-Route des Development-Backends und die
// Schema-Prüfung „keine E-Mail außerhalb der Better-Auth-Tabellen“.

const solo = seedManifests.solo;

async function authState(backend: TestBackend) {
  const db = backend.database.db;
  return {
    users: await db.select().from(user),
    accounts: await db.select().from(account),
    sessions: await db.select().from(session),
  };
}

describe('Seed für Postgres', () => {
  it('stellt den Ausgangszustand des Manifests exakt her, auch beim wiederholten Seeden', async () => {
    const backend = await createTestBackend();
    await seedServer(backend.database, solo);
    const first = await dumpServer(backend.database.db);
    expect(first).toEqual(canonicalRows(solo.initial.server));

    await seedServer(backend.database, solo);
    // Kanonisch gleich, nicht nur dieselbe Zeilenzahl.
    expect(await dumpServer(backend.database.db)).toEqual(first);
  });

  it('prüft Konten semantisch: feste ID und E-Mail, Hash passt zum Testpasswort, keine Sitzung', async () => {
    const backend = await createTestBackend();
    await seedServer(backend.database, solo);
    const firstHash = (await authState(backend)).accounts[0]!.password!;
    await seedServer(backend.database, solo);
    const { users, accounts, sessions } = await authState(backend);

    expect(users.map(({ id, email, name }) => ({ id, email, name }))).toEqual([{ id: solo.accounts[0]!.accountId, email: 'philipp@example.test', name: '' }]);
    expect(accounts).toEqual([expect.objectContaining({ userId: solo.accounts[0]!.accountId, providerId: 'credential' })]);
    // Gesalzen: jedes Seeden erzeugt einen anderen Hash, beide gelten für dasselbe Passwort.
    expect(accounts[0]!.password).not.toBe(firstHash);
    expect(await verifyPassword({ hash: accounts[0]!.password!, password: seedPassword })).toBe(true);
    expect(await verifyPassword({ hash: accounts[0]!.password!, password: 'falsches-passwort' })).toBe(false);
    expect(sessions).toEqual([]);
  });

  it('setzt einen veränderten Stand zurück und verwirft Sitzungen; das Testkonto meldet sich danach an', async () => {
    const backend = await createTestBackend();
    await seedServer(backend.database, solo);
    const { reply, device } = await signIn(backend, 'philipp@example.test', seedPassword);
    expect(reply.status).toBe(200);
    await backend.database.db.update(person).set({ displayName: 'Geändert' }).where(eq(person.id, solo.accounts[0]!.personId));

    await seedServer(backend.database, solo);
    expect(await dumpServer(backend.database.db)).toEqual(canonicalRows(solo.initial.server));
    expect((await call(backend, 'GET', '/v1/auth/get-session', device)).body).toBeNull();

    const again = await signIn(backend, 'philipp@example.test', seedPassword);
    expect(again.reply.status).toBe(200);
    // Der Bootstrap findet die geseedete Person: fertiges Onboarding, also direkt „Heute“.
    const bootstrap = await call(backend, 'POST', '/v1/person/bootstrap', again.device, { displayName: 'Egal', timeZone: 'Europe/Berlin' });
    expect(bootstrap.body).toEqual(expect.objectContaining({ personId: solo.accounts[0]!.personId, displayName: 'Philipp', onboardingStatus: 'abgeschlossen' }));
  });

  it('Schema-Prüfung: nach dem Seeden steht außerhalb der Better-Auth-Tabellen keine E-Mail', async () => {
    const backend = await createTestBackend();
    await seedServer(backend.database, solo);
    expect(await tablesWithEmail(backend.database.db)).toEqual([]);

    // Gegenprobe: Die Prüfung findet eine E-Mail in jeder Spalte, auch in JSON.
    await backend.database.db.execute(
      sql`insert into security_log (id, occurred_at, event_type, details) values (gen_random_uuid(), now(), 'anmeldung', '{"x": "jemand@example.test"}')`,
    );
    await backend.database.db.update(person).set({ displayName: 'philipp@example.test' });
    expect((await tablesWithEmail(backend.database.db)).sort()).toEqual(['person', 'security_log']);
  });

  it('bricht ab und hinterlässt nichts, wenn eine Zeile eine E-Mail enthält', async () => {
    const backend = await createTestBackend();
    await seedServer(backend.database, solo);
    // Am Manifest-Schema vorbei, um die Prüfung in der Datenbank zu belegen.
    const withEmail = structuredClone(solo) as SeedManifest;
    withEmail.initial.server.person![0]!.display_name = 'philipp@example.test';
    await expect(seedServer(backend.database, withEmail)).rejects.toThrow('E-Mail außerhalb der Better-Auth-Tabellen in person');
    expect(await dumpServer(backend.database.db)).toEqual(canonicalRows(solo.initial.server));
  });
});

describe('Seed-Route des Development-Backends', () => {
  it('seedet über POST /dev/seed; unbekannte Szenarien sind ungültig', async () => {
    const backend = await createTestBackend();
    const development = { app: createDevelopmentApp({ backend, database: backend.database }) };
    expect((await call(development, 'POST', seedRoutePath, newDevice(), { scenario: 'solo' })).status).toBe(204);
    expect(await dumpServer(backend.database.db)).toEqual(canonicalRows(solo.initial.server));
    expect(await call(development, 'POST', seedRoutePath, newDevice(), { scenario: 'unbekannt' })).toEqual(
      expect.objectContaining({ status: 400, body: { code: 'invalid_payload', retryable: false } }),
    );
  });

  it('reicht alle übrigen Anfragen samt Autorisierung an die App des Backends durch', async () => {
    const backend = await createTestBackend();
    const development = { app: createDevelopmentApp({ backend, database: backend.database }) };
    expect((await call(development, 'GET', '/v1/status', newDevice())).status).toBe(200);
    expect((await call(development, 'POST', '/v1/person/bootstrap', newDevice(), {})).status).toBe(401);
  });

  it('fehlt in der App des Backends selbst', async () => {
    const backend = await createTestBackend();
    expect((await call(backend, 'POST', seedRoutePath, newDevice(), { scenario: 'solo' })).status).toBe(404);
  });
});
