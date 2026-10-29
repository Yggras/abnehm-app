import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';

import type { StoredSession } from '../../auth/app-auth';
import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import { readOwnPerson } from '../../local-db/person-header';
import * as schema from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { createAppSession } from '../../session/app-session';
import { followSessionGate } from '../../session/session-gate';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncCycleResult } from '../../sync';
import { pendingOperations } from '../../sync/outbox';
// Der Fehler-Adapter aus #112 schaltet den Transport ab, wie in den Test-Artefakten der App.
import { createFaultController, faultyFetch } from '../../test-capabilities/faults';
import { createOnboarding } from '../onboarding';
import { createFakeAuthServer } from './fake-auth-server';

// Gerät für Tests des Onboardings: das echte Auth-Modul (#97) über dem Fake-Server, dahinter der
// Fehler-Adapter aus #112, echte Kontodatenbanken auf better-sqlite3, die echte Sitzungs-Weiche und
// das echte Onboarding-Modul. Der Sync-Zyklus ist ein Pull-Ersatz: Er übernimmt die Person, die der
// Server beim Bootstrap angelegt hat, wie es der erste Pull täte. Nur in Tests mit SQLite.

const rethrow = (error: unknown) => {
  throw error;
};

export function createOnboardingDevice(clock: Clock) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: rethrow });
  const server = createFakeAuthServer();
  const faults = createFaultController();
  let stored: StoredSession | null = null;
  let ids = 0;
  const newId = () => EntityId.parse(`0b000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  const writer = createSyncWriter({ registry: createSyncRegistry(foundationSyncEntities), clock, newId });
  const syncCycles: SyncCycleResult[] = [];

  /** Ersatz für den Sync-Zyklus der geöffneten Kontodatenbank: übernimmt die Person vom Server. */
  function sync(): Promise<SyncCycleResult> | undefined {
    const database = databases.current();
    if (database === null) return undefined;
    const offline = faults.plan().transport === 'offline';
    const person = server.person(database.accountId);
    if (!offline && person !== null && database.read((tx) => readOwnPerson(tx)) === undefined) {
      const at = clock.read().instant;
      database.transaction((tx) =>
        sqliteOf(tx)
          .insert(schema.person)
          .values({
            id: person.personId,
            accountId: database.accountId,
            displayName: person.displayName,
            onboardingStatus: person.onboardingStatus,
            timeZone: person.timeZone,
            serverVersion: person.serverVersion,
            createdAt: at,
            updatedAt: at,
          })
          .run(),
      );
    }
    const cycle: SyncCycleResult = offline ? { push: 'unavailable', pull: 'skipped' } : { push: 'nothing_to_do', pull: 'done' };
    syncCycles.push(cycle);
    return Promise.resolve(cycle);
  }

  // Wie im Composition Root: Weiche und Onboarding folgen der jeweils geöffneten Kontodatenbank.
  let opened: ((database: LocalDatabase) => () => void) | null = null;
  const session = createAppSession({
    baseUrl: 'https://backend.test',
    fetch: faultyFetch(server.fetch, faults),
    sessionStore: {
      read: async () => stored,
      write: async (session) => {
        stored = session;
      },
      clear: async () => {
        stored = null;
      },
    },
    databases,
    onAccountOpened: (database) => opened!(database),
    onError: rethrow,
  });
  const gate = followSessionGate(session.auth);
  const onboarding = createOnboarding({ auth: session.auth, clock, writer, sync, onError: rethrow });
  opened = (database) => {
    const stops = [gate.opened(database), onboarding.opened(database)];
    return () => {
      for (const stop of stops) stop();
    };
  };

  return {
    onboarding,
    session,
    gate,
    server,
    faults,
    syncCycles,
    /** Die eigene Person der geöffneten Kontodatenbank. */
    ownPerson: () => databases.current()?.read(readOwnPerson),
    /** Offene Sync-Operationen der geöffneten Kontodatenbank. */
    outbox: () => databases.current()?.read((tx) => pendingOperations(tx, 100)) ?? [],
    /** Ein vorhandenes Konto samt Person auf dem Server, etwa für den Anmeldepfad. */
    async addAccount(input: { email: string; password: string; displayName: string }) {
      const accountId = server.addAccount(input);
      const signedIn = await session.auth.signIn(input);
      if (signedIn.type !== 'signed_in') throw new Error(`Anmeldung gescheitert: ${signedIn.type}`);
      await session.auth.bootstrapPerson({ displayName: input.displayName, timeZone: clock.read().timeZone });
      await session.revocations.forgetSession();
      return accountId;
    },
    cleanup() {
      databases.lock();
      files.remove();
    },
  };
}

export type OnboardingDevice = ReturnType<typeof createOnboardingDevice>;
