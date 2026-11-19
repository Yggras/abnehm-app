import { asc, eq } from 'drizzle-orm';

import { readingOf, type Clock } from '@abnehm/clock';
import { EntityId, LocalDate } from '@abnehm/contracts/base';
import type { WeightRecorder } from '@abnehm/contracts/ports';

import { fakeWeightRecorder } from '../../area-ports/testing/fakes';
import type { StoredSession } from '../../auth/app-auth';
import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity } from '../../daily-goals';
import { energyBookingEntity } from '../../energy';
import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import { readOwnPerson } from '../../local-db/person-header';
import * as schema from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { createAppSession } from '../../session/app-session';
import { followSessionGate } from '../../session/session-gate';
import { createPlan, goalVersionEntity, weeklyPlanVersionEntity } from '../../plan';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities, unsecuredOperationCount, type SyncCycleResult } from '../../sync';
import { pendingOperations } from '../../sync/outbox';
import { createLogout, syncBeforeLogout, type LogoutRecord } from '../../logout';
import { followOwnDisplayName, type AccountPorts } from '../../settings';
// Der Fehler-Adapter aus #112 schaltet den Transport ab, wie in den Test-Artefakten der App.
import { createFaultController, faultyFetch } from '../../test-capabilities/faults';
import { createOnboarding } from '../onboarding';
import { createFakeAuthServer } from './fake-auth-server';

// Gerät für Tests des Onboardings: das echte Auth-Modul (#97) über dem Fake-Server, dahinter der
// Fehler-Adapter aus #112, echte Kontodatenbanken auf better-sqlite3, die echte Sitzungs-Weiche, das
// echte Onboarding-Modul und je Kontodatenbank das echte Plan-Modul samt Persistenzdienst der Tagesziele.
// Das Startgewicht aus Schritt 8 nimmt der Fixture-Adapter des `WeightRecorder` aus #104 an. Der
// Sync-Zyklus ist ein Pull-Ersatz: Er übernimmt die Person, die der Server beim Bootstrap angelegt hat,
// wie es der erste Pull täte. Nur in Tests mit SQLite.

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
  const writer = createSyncWriter({
    registry: createSyncRegistry([...foundationSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity]),
    clock,
    newId,
  });
  // Startgewicht über den Fixture-Adapter aus #104; `failWeightRecorder` lässt den Port scheitern: `wirft`
  // wie eine gescheiterte Transaktion des Tracker-Moduls, `lehnt_ab` mit einem Vertragsfehler.
  const weights = fakeWeightRecorder((measuredAt) => LocalDate.parse(readingOf(measuredAt, clock.read().timeZone).localDate));
  let weightRecorderFails: false | 'wirft' | 'lehnt_ab' = false;
  const weightRecorder: WeightRecorder = {
    async recordManualWeight(input) {
      if (weightRecorderFails === 'wirft') throw new Error('WeightRecorder: Transaktion gescheitert');
      if (weightRecorderFails === 'lehnt_ab') return { type: 'contract_error', error: { code: 'invalid_payload', retryable: false } };
      return weights.recordManualWeight(input);
    },
  };

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
    return Promise.resolve(offline ? { push: 'unavailable', pull: 'skipped' } : { push: 'nothing_to_do', pull: 'done' });
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
  // Gemeldete Fehler des Onboardings sammelt der Test mit `takeErrors` ein; übrige lässt `cleanup` scheitern.
  let reported: unknown[] = [];
  const onboarding = createOnboarding({ auth: session.auth, clock, writer, sync, onError: (error) => reported.push(error), newId });
  // Abmelden, etwa vom Sperrbildschirm unter 18, über das echte Abmeldemodul (#111). Der Sync davor
  // erreicht den Server, solange der Fehler-Adapter Verbindung hat, sichert aber nichts.
  let logoutRecord: LogoutRecord | null = null;
  const logout = createLogout({
    auth: session.auth,
    revocations: session.revocations,
    databases,
    store: {
      read: async () => logoutRecord,
      write: async (record) => {
        logoutRecord = record;
      },
      clear: async () => {
        logoutRecord = null;
      },
    },
    sync: () => {
      const database = databases.current();
      const reachable = faults.plan().transport !== 'offline';
      return syncBeforeLogout(
        database && {
          sync: async () => (reachable ? { push: 'done', pull: 'done' } : { push: 'unavailable', pull: 'unavailable' }),
          unsecuredOperations: () => unsecuredOperationCount(database),
        },
      );
    },
    newId,
    onError: rethrow,
  });
  const displayName = followOwnDisplayName({ writer, clock });
  /** Die Ports der Einstellungen für `AccountProvider`, wie `deviceAccount()` im Composition Root. */
  const account: AccountPorts = { auth: session.auth, logout, displayName };

  opened = (database) => {
    // Wie im Composition Root: Plan-Modul je Kontodatenbank, Tagesziele ohne Bausteine anderer Bereiche.
    const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: rethrow });
    const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
    const plan = createPlan({ database, clock, writer, persistence, weightRecorder, newId });
    persistence.registerMissingDaysHook(plan.materializeMissingDays);
    const stops = [gate.opened(database), onboarding.opened(database, plan), displayName.opened(database)];
    return () => {
      for (const stop of stops) stop();
    };
  };

  return {
    onboarding,
    account,
    session,
    gate,
    server,
    faults,
    /** Die eigene Person der geöffneten Kontodatenbank. */
    ownPerson: () => databases.current()?.read(readOwnPerson),
    /** Die Startgewichte, die der `WeightRecorder` angenommen hat; je `entryId` eines. */
    startWeights: () => weights.entries(),
    /** Jeder Aufruf des `WeightRecorder` scheitert auf diese Art, bis `false` folgt. */
    failWeightRecorder(fails: false | 'wirft' | 'lehnt_ab') {
      weightRecorderFails = fails;
    },
    /** `valid_from` der Wochenplanversionen der geöffneten Kontodatenbank, aufsteigend. */
    weeklyPlanVersions: () =>
      databases.current()?.read((tx) => sqliteOf(tx).select({ validFrom: schema.weeklyPlanVersion.validFrom }).from(schema.weeklyPlanVersion).orderBy(asc(schema.weeklyPlanVersion.validFrom)).all().map(({ validFrom }) => validFrom)) ?? [],
    /** Die Tagesziele der geöffneten Kontodatenbank an einem lokalen Tag, nach Platz. */
    dailyGoalsOn: (localDate: LocalDate) =>
      databases.current()?.read((tx) => sqliteOf(tx).select().from(schema.dailyGoal).where(eq(schema.dailyGoal.localDate, localDate)).orderBy(asc(schema.dailyGoal.slot)).all()) ?? [],
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
    /** Die seit dem letzten Aufruf an `onError` gemeldeten Fehler des Onboardings. */
    takeErrors() {
      const taken = reported;
      reported = [];
      return taken;
    },
    cleanup() {
      databases.lock();
      files.remove();
      if (reported.length > 0) throw new Error(`Ungeprüfte Fehler des Onboardings: ${reported.map(String).join('; ')}`);
    },
  };
}

export type OnboardingDevice = ReturnType<typeof createOnboardingDevice>;
