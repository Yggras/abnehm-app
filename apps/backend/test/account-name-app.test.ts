import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, TimeZone } from '@abnehm/contracts/base';
import { seedManifests, type SeedKey, type SeedManifest } from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import { islandSyncEntities } from '../../mobile/src/island/island-entities.ts';
import { dailyGoalCompletionEntity } from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { mealPhotoEntity, nutritionEntryEntity } from '../../mobile/src/nutrition/index.ts';
import { goalVersionEntity, weeklyPlanVersionEntity } from '../../mobile/src/plan/index.ts';
import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { couplingMember as localMember, outbox as localOutbox, person as localPerson } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { followOwnDisplayName } from '../../mobile/src/settings/own-display-name.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
  requestPersonTimeZone,
} from '../../mobile/src/sync/index.ts';
import { seedLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { sportEntryEntity, waterEntryEntity, weightEntryEntity } from '../../mobile/src/trackers/index.ts';
import { seedServer } from '../dev/seed/server-seed.ts';
import { couplingMember, person } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { signIn } from './support/auth-client.ts';

// Anzeigename unter „Konto“ (#119) mit dem Szenario `gekoppelt` (#117): Philipp ändert seinen Namen über
// das Modul der Einstellungen (`followOwnDisplayName`, Person-Upsert mit Outbox), auf echtem SQLite gegen die
// echte Hono-App mit Postgres. Anna sieht den neuen Namen nach ihrem Pull am Kopplungsmitglied. Die Zone
// der Person hat zuvor ein zweites Gerät geändert; der Name vom veralteten ersten Gerät setzt sie nicht zurück.

const gekoppelt = seedManifests.gekoppelt;
const newYork = TimeZone.parse('America/New_York');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Alle Sync-Entitäten der App, wie im Composition Root (`src/session/device-session.ts`). */
const registry = createSyncRegistry([
  ...foundationSyncEntities, ...islandSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, sportEntryEntity, nutritionEntryEntity, mealPhotoEntity,
]);

/**
 * Ein angemeldetes Gerät im Ausgangszustand der Installation `key`. Mit `otherInstallation` ist es ein
 * weiteres Gerät desselben Kontos im selben Stand, aber mit eigener Installationskennung und Sitzung.
 */
async function phone(backend: TestBackend, manifest: SeedManifest, key: SeedKey, otherInstallation = false) {
  const installation = manifest.installations.find((candidate) => candidate.key === key)!;
  const { email, password, accountId, personId } = manifest.accounts.find((candidate) => candidate.key === installation.account)!;
  const { reply, device } = await signIn(backend, email, password);
  if (reply.status !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${reply.status}`);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open(accountId);
  seedLocalDatabase(database, manifest, key);
  const clock = createTestClock(manifest.clock);
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const commands = createLocalCommandRegistry({ database, writer, commands: foundationLocalCommands });
  const installationId = InstallationId.parse(otherInstallation ? randomUUID() : installation.installationId);
  const engine = createSyncEngine({
    database, registry, clock, commands, installationId,
    transport: createHttpSyncTransport({
      baseUrl: testBaseUrl,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${device.token ?? ''}`);
        headers.set('x-forwarded-for', device.ip);
        return backend.app.request(String(input), { ...init, headers });
      },
    }),
  });
  const displayName = followOwnDisplayName({ writer, clock });
  cleanups.push(displayName.opened(database));
  return {
    personId,
    displayName,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    travel: (to: TimeZone) => requestPersonTimeZone(database, commands, to, newId),
    person: () => database.read((tx) => sqliteOf(tx).select().from(localPerson).get()),
    outbox: () => database.read((tx) => sqliteOf(tx).select().from(localOutbox).all()),
    member: (of: string) => database.read((tx) => sqliteOf(tx).select().from(localMember).where(eq(localMember.personId, of)).get()),
  };
}

describe('Anzeigename im Szenario gekoppelt', () => {
  it('kommt nach dem Pull beim Partner am Kopplungsmitglied an und lässt die Zeitzone unberührt', async () => {
    const backend = await createTestBackend({ clock: createTestClock(gekoppelt.clock) });
    await seedServer(backend.database, gekoppelt);
    const philipp = await phone(backend, gekoppelt, 'philipp-iphone');
    const anna = await phone(backend, gekoppelt, 'anna-android');
    expect(anna.member(philipp.personId)?.displayName).toBe('Philipp');

    // Ein zweites Gerät von Philipp reist nach New York; das iPhone kennt noch Berlin.
    const second = await phone(backend, gekoppelt, 'philipp-iphone', true);
    expect(second.travel(newYork)).toBe('requested');
    await second.sync();
    expect(philipp.person()?.timeZone).toBe('Europe/Berlin');

    expect(philipp.displayName.rename('Philipp D.')).toEqual({ type: 'renamed', displayName: 'Philipp D.' });
    expect(philipp.outbox()).toMatchObject([{ type: 'upsert_entity', entityType: 'person', payload: { displayName: 'Philipp D.' } }]);
    expect(philipp.outbox()[0]?.payload).not.toHaveProperty('timeZone');
    await philipp.sync();

    const [server] = await backend.database.db.select().from(person).where(eq(person.id, philipp.personId));
    const [member] = await backend.database.db.select().from(couplingMember).where(eq(couplingMember.personId, philipp.personId));
    expect(server).toMatchObject({ displayName: 'Philipp D.', timeZone: newYork });
    expect(member?.displayName).toBe('Philipp D.');
    expect(philipp.person()).toMatchObject({ displayName: 'Philipp D.', timeZone: newYork });
    expect(philipp.displayName.current()).toBe('Philipp D.');

    await anna.sync();
    expect(anna.member(philipp.personId)?.displayName).toBe('Philipp D.');
    expect(anna.member(anna.personId)?.displayName).toBe('Anna');
  });
});
