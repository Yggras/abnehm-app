import { randomUUID } from 'node:crypto';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalKey } from '@abnehm/contracts/daily-goals';
import { energyBookingId } from '@abnehm/contracts/energy';
import type { IslandRole } from '@abnehm/contracts/island';

import { insertCompletionForTest, insertDailyGoalForTest, insertPersonForTest } from '../../daily-goals/testing/persisted';
import { appendBooking } from '../../energy';
import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import { coupling, couplingMember, island, sharedAction } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../sync';
import { pendingOperations } from '../../sync/outbox';
import { createIsland, type Island } from '../island';
import { anna, philipp } from './persons';

// Testaufbau für Laichkugel und Rollenwahl (#180): echte SQLite-Datei mit denselben Migrationen wie die
// App, Philipp als eigene Person, Sync-Writer und der echte Spieldienst. Kopplung, Insel, Vorschläge und
// Energie legt der Test an, wie sie der Pull ablegen würde. Die Uhr gibt der Test hinein.

const at = '2026-10-14T12:00:00.000Z';
const synced = { createdAt: at, updatedAt: at, serverVersion: '1' };
export const couplingId = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c01');

export type EggWorld = Readonly<{
  database: LocalDatabase;
  island: Island;
  /** Philipp und Anna gekoppelt; die Insel wartet auf die Rollen. */
  couple(): void;
  /** Ein vom Server bestätigter offener Vorschlag. */
  proposeOnServer(by: 'philipp' | 'anna', proposerRole: IslandRole): EntityId;
  /** Gutschriften für erfüllte Tagesziele, wie sie der Pull ablegt. */
  credit(amount: number): void;
  operations(): ReturnType<typeof pendingOperations>;
  close(): void;
}>;

export async function createEggWorld(clock: Clock): Promise<EggWorld> {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_philipp');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry(foundationSyncEntities), clock, newId });
  return {
    database,
    island: createIsland({ database, writer, clock, newId }),
    couple() {
      database.transaction((tx) => {
        const db = sqliteOf(tx);
        const [low, high] = philipp < anna ? [philipp, anna] : [anna, philipp];
        db.insert(coupling).values({ id: couplingId, personLowId: low, personHighId: high, status: 'aktiv', startedAt: at, ...synced }).run();
        for (const [person, displayName] of [[philipp, 'Philipp'], [anna, 'Anna']] as const) {
          db.insert(couplingMember).values({ id: newId(), couplingId, couplingStatus: 'aktiv', personId: person, displayName, ...synced }).run();
        }
        db.insert(island).values({ id: newId(), couplingId, state: 'wartet_auf_rollen', ...synced }).run();
      });
    },
    proposeOnServer(by, proposerRole) {
      const id = newId();
      database.transaction((tx) =>
        sqliteOf(tx)
          .insert(sharedAction)
          .values({ id, couplingId, kind: 'rollenwahl', requesterPersonId: by === 'philipp' ? philipp : anna, payload: { proposerRole }, status: 'offen', ...synced })
          .run(),
      );
      return id;
    },
    credit(amount) {
      database.transaction((tx) => {
        for (let day = 1; day <= amount; day++) {
          const localDate = LocalDate.parse(`2026-10-${String(day).padStart(2, '0')}`);
          const snapshot = { type: 'gewogen', personId: philipp, localDate, slot: 1, timeZone: TimeZone.parse('Europe/Berlin'), dayEndsAt: Instant.parse(at) } as const;
          const [goal, completion] = [newId(), newId()];
          insertDailyGoalForTest(tx, goal, snapshot);
          insertCompletionForTest(tx, completion, goal, snapshot, at);
          const bookingKey = dailyGoalKey(philipp, localDate, 1);
          appendBooking(tx, {
            type: 'daily_goal_credit', id: energyBookingId(bookingKey), personId: philipp, localDate, bookingKey, createdAt: Instant.parse(at),
            amount: 1, trigger: { dailyGoalCompletionId: EntityId.parse(completion), slot: 1 },
          });
        }
      });
    },
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
    close() {
      databases.lock();
      files.remove();
    },
  };
}
