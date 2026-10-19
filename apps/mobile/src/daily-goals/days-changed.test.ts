/** @jest-environment node */
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createDaysChangedDispatcher, markDaysChanged, type DaysChanged } from './days-changed';
import { insertPersonForTest } from './testing/persisted';

// Nachweis für #105: Nach-Commit-Signal `onDaysChanged` (Spezifikation 0, Abschnitt 3). Dauerhafte
// Marker entstehen in der auslösenden Transaktion; der Dispatcher stellt sie mindestens einmal zu und
// bestätigt sie erst nach erfolgreicher Verarbeitung.

const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const at = Instant.parse('2026-10-14T12:00:00.000Z');
const day = (value: string) => LocalDate.parse(value);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, anna));
  return { database, files, databases };
}

function recorder() {
  const received: DaysChanged[] = [];
  let failures = 0;
  return {
    received,
    failNext(times = 1) {
      failures = times;
    },
    observer: (signal: DaysChanged) => {
      if (failures > 0) {
        failures--;
        throw new Error('Beobachter gescheitert');
      }
      received.push(signal);
    },
  };
}

function mark(database: LocalDatabase, localDates: string[], cause: DaysChanged['cause'] = 'eingabe') {
  database.transaction((tx) => markDaysChanged(tx, { personId: anna, localDates: localDates.map(day), cause }, at));
}

describe('onDaysChanged', () => {
  it('stellt markierte Tage nach dem Commit zu, gebündelt je Person und Auslöser, und bestätigt sie danach', async () => {
    const { database } = await setup();
    const observer = recorder();
    const dispatcher = createDaysChangedDispatcher({ database, observers: [observer.observer], onError: () => {} });
    mark(database, ['2026-10-14', '2026-10-13']);
    mark(database, ['2026-10-14'], 'pull');
    mark(database, ['2026-10-14']);
    await dispatcher.deliver();
    expect(observer.received).toEqual([
      { personId: anna, localDates: ['2026-10-13', '2026-10-14'], cause: 'eingabe' },
      { personId: anna, localDates: ['2026-10-14'], cause: 'pull' },
    ]);
    expect(dispatcher.pending()).toBe(0);
    await dispatcher.deliver();
    expect(observer.received).toHaveLength(2);
  });

  it('ein Rollback hinterlässt keinen Marker', async () => {
    const { database } = await setup();
    const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: () => {} });
    expect(() =>
      database.transaction((tx) => {
        markDaysChanged(tx, { personId: anna, localDates: [day('2026-10-14')], cause: 'eingabe' }, at);
        throw new Error('Fachänderung scheitert');
      }),
    ).toThrow('Fachänderung scheitert');
    expect(dispatcher.pending()).toBe(0);
  });

  it('behält Marker, wenn ein Beobachter scheitert, und stellt sie beim nächsten Anstoß erneut zu', async () => {
    const { database } = await setup();
    const errors: unknown[] = [];
    const first = recorder();
    const second = recorder();
    const dispatcher = createDaysChangedDispatcher({ database, observers: [first.observer, second.observer], onError: (error) => errors.push(error) });
    second.failNext();
    mark(database, ['2026-10-14']);
    await dispatcher.deliver();
    expect(errors).toHaveLength(1);
    expect(dispatcher.pending()).toBe(1);
    await dispatcher.deliver();
    // Mindestens einmal: Der erfolgreiche Beobachter bekommt den Tag erneut, er muss idempotent sein.
    expect(first.received).toHaveLength(2);
    expect(second.received).toEqual([{ personId: anna, localDates: ['2026-10-14'], cause: 'eingabe' }]);
    expect(dispatcher.pending()).toBe(0);
  });

  it('setzt offene Zustellungen nach einem Neustart fort', async () => {
    const { database, files, databases } = await setup();
    const failing = recorder();
    failing.failNext();
    mark(database, ['2026-10-14']);
    await createDaysChangedDispatcher({ database, observers: [failing.observer], onError: () => {} }).deliver();
    databases.lock();
    const reopened = await createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } }).open('konto_a');
    const observer = recorder();
    await createDaysChangedDispatcher({ database: reopened, observers: [observer.observer], onError: () => {} }).deliver();
    expect(observer.received).toEqual([{ personId: anna, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it('verliert keinen Tag, der während der Zustellung erneut markiert wird', async () => {
    const { database } = await setup();
    const received: DaysChanged[] = [];
    let remarked = false;
    const dispatcher = createDaysChangedDispatcher({
      database,
      observers: [
        async (signal) => {
          received.push(signal);
          if (!remarked) {
            remarked = true;
            // Eine neue Eingabe desselben Tags committet, während der Beobachter noch arbeitet.
            mark(database, ['2026-10-14']);
            dispatcher.deliver();
          }
          await Promise.resolve();
        },
      ],
      onError: () => {},
    });
    mark(database, ['2026-10-14']);
    await dispatcher.deliver();
    await dispatcher.deliver();
    expect(received).toHaveLength(2);
    expect(dispatcher.pending()).toBe(0);
  });

  it('läuft nie parallel: gleichzeitige Anstöße teilen sich die laufende Zustellung', async () => {
    const { database } = await setup();
    let running = 0;
    let maxRunning = 0;
    const dispatcher = createDaysChangedDispatcher({
      database,
      observers: [
        async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
        },
      ],
      onError: () => {},
    });
    mark(database, ['2026-10-14']);
    mark(database, ['2026-10-15'], 'planaenderung');
    await Promise.all([dispatcher.deliver(), dispatcher.deliver(), dispatcher.deliver()]);
    expect(maxRunning).toBe(1);
    expect(dispatcher.pending()).toBe(0);
  });

  it('wartet im begrenzten Hintergrundfenster bestmöglich; offene Marker bleiben danach erhalten', async () => {
    const { database } = await setup();
    let release: () => void = () => {};
    const dispatcher = createDaysChangedDispatcher({
      database,
      observers: [() => new Promise<void>((resolve) => (release = resolve))],
      onError: () => {},
    });
    mark(database, ['2026-10-14']);
    expect(await dispatcher.drain(10)).toBe('pending');
    expect(dispatcher.pending()).toBe(1);
    release();
    expect(await dispatcher.drain(1000)).toBe('delivered');
    expect(dispatcher.pending()).toBe(0);
  });
});
