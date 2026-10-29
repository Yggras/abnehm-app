import { sql } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';

import type { SessionStore, StoredSession } from '../../auth/app-auth';
import { fakeAuthBackend, type FakeAuthAccount } from '../../auth/testing/fake-auth-backend';
import { createLocalDatabases } from '../../local-db/local-databases';
import { outbox, person } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { personRow } from '../../local-db/testing/rows';
import { createLogout, syncBeforeLogout, type LogoutRecord, type LogoutStore } from '../../logout';
import { createAppSession } from '../../session/app-session';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities, unsecuredOperationCount } from '../../sync';
import { createFaultController, faultyFetch } from '../../test-capabilities/faults';
import type { AccountPorts } from '../AccountProvider';
import { followOwnProfile } from '../own-profile';

// Test-Welt der Einstellungen (Spezifikation 5, Abschnitt 6) mit den Test-Adaptern des Fundaments: das
// echte Auth-Modul und das echte Abmeldemodul über dem Online-Test-Adapter des Auth-Moduls, davor der
// Fehler-Adapter der Testfähigkeiten (`faults`), und der Anzeigename über einer echten SQLite-Datei.
//
// Der Sync vor dem Abmelden ist eine Attrappe der Engine: Er erreicht den Server, solange der
// Fehler-Adapter Verbindung und einen Server hat, sichert aber nichts. Was in der Outbox liegt, etwa ein
// geänderter Name, bleibt also ungesichert und verlangt beim Abmelden die Bestätigung.

export const philipp: FakeAuthAccount & { personId: EntityId } = {
  accountId: 'konto_philipp',
  email: 'philipp@example.test',
  password: 'momo-insel-testpasswort',
  personId: EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01'),
};

function memory<T>(): { read(): Promise<T | null>; write(value: T): Promise<void>; clear(): Promise<void>; value: T | null } {
  const store = {
    value: null as T | null,
    read: async () => store.value,
    write: async (value: T) => {
      store.value = value;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

export type AccountWorld = Awaited<ReturnType<typeof createAccountWorld>>;

/** Philipp ist angemeldet, seine Kontodatenbank ist offen und enthält seine Person. */
export async function createAccountWorld({ clock }: { clock: Clock }) {
  const files = createBetterSqliteFiles();
  const errors: unknown[] = [];
  const onError = (error: unknown) => errors.push(error);
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError });
  const backend = fakeAuthBackend({ account: philipp, loggedOutAt: clock.read().instant });
  const faults = createFaultController();
  let ids = 0;
  const newId = () => EntityId.parse(`20000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  const writer = createSyncWriter({ registry: createSyncRegistry(foundationSyncEntities), clock, newId });
  const profile = followOwnProfile({ writer, clock });
  const sessionStore: SessionStore & { value: StoredSession | null } = memory<StoredSession>();
  const logoutStore: LogoutStore & { value: LogoutRecord | null } = memory<LogoutRecord>();
  const session = createAppSession({
    baseUrl: 'https://backend.test',
    fetch: faultyFetch(backend.fetch, faults),
    sessionStore,
    databases,
    onAccountOpened: (database) => profile.opened(database),
    onError,
  });
  const reachable = () => faults.plan().transport !== 'offline' && faults.plan().server !== 'unavailable';
  const logout = createLogout({
    auth: session.auth,
    revocations: session.revocations,
    databases,
    store: logoutStore,
    sync: () => {
      const database = databases.current();
      return syncBeforeLogout(
        database && {
          sync: async () => (reachable() ? { push: 'done', pull: 'done' } : { push: 'unavailable', pull: 'unavailable' }),
          unsecuredOperations: () => unsecuredOperationCount(database),
        },
      );
    },
    newId,
    onError,
  });

  const signedIn = await session.auth.signIn({ email: philipp.email, password: philipp.password });
  if (signedIn.type !== 'signed_in') throw new Error(`Anmeldung im Test: ${signedIn.type}`);
  const database = databases.current()!;
  database.transaction((tx) => {
    sqliteOf(tx).insert(person).values({ ...personRow(philipp.personId, philipp.accountId), displayName: 'Philipp' }).run();
  });

  const ports: AccountPorts = { auth: session.auth, logout, profile };
  return {
    ports,
    auth: session.auth,
    backend,
    faults,
    errors,
    sessionStore,
    logoutStore,
    /** Die Kontodatenbank liegt noch auf dem Gerät. */
    hasAccountData: () => files.existingFileNames().some((name) => name.startsWith(`konto-${philipp.accountId}.db`)),
    /** Alles, was auf dem Gerät gespeichert ist: jede Zeile jeder Tabelle der Kontodatenbank und beide Speicher. */
    storedText: () =>
      JSON.stringify([
        sessionStore.value,
        logoutStore.value,
        database.read((tx) => {
          const db = sqliteOf(tx);
          const tables = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`);
          return tables.map(({ name }) => db.all(sql.raw(`SELECT * FROM "${name}"`)));
        }),
      ]),
    person: () => (databases.current() ?? database).read((tx) => sqliteOf(tx).select().from(person).get()),
    outbox: () => (databases.current() ?? database).read((tx) => sqliteOf(tx).select().from(outbox).all()),
    cleanup() {
      databases.lock();
      files.remove();
    },
  };
}
