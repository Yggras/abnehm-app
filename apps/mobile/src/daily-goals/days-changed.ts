import { and, count, eq, sql } from 'drizzle-orm';

import { EntityId, LocalDate, type Instant } from '@abnehm/contracts/base';
import { DailyGoalCause } from '@abnehm/contracts/daily-goals';

import type { LocalDatabase, ReadContext, TransactionContext } from '../local-db';
import { dirtyDay } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Nach-Commit-Signal `onDaysChanged` (Spezifikation 0, Abschnitt 3). Jede Transaktion, die
// `reevaluateDailyGoals` aufruft, schreibt dauerhafte Dirty-Day-Marker. Der Dispatcher stellt sie nach
// dem Commit mindestens einmal an die Beobachter zu, etwa an die Tages-Check-ins (Spezifikation 5), und
// bestätigt sie erst danach. Beobachter laufen außerhalb der auslösenden Transaktion.

/** Betroffene Tage einer Person samt Auslöser. */
export type DaysChanged = Readonly<{ personId: EntityId; localDates: readonly LocalDate[]; cause: DailyGoalCause }>;

/**
 * Beobachter des Signals. Er muss idempotent sein: Derselbe Tag kann ihn mehrfach erreichen, etwa
 * nach einem Neustart oder wenn ein anderer Beobachter gescheitert ist. Er darf Tage bündeln.
 */
export type DaysChangedObserver = (signal: DaysChanged) => void | Promise<void>;

/** Markiert die Tage in der laufenden Transaktion; ein Rollback hinterlässt keinen Marker. */
export function markDaysChanged(tx: TransactionContext, { personId, localDates, cause }: DaysChanged, at: Instant): void {
  for (const localDate of new Set(localDates)) {
    sqliteOf(tx)
      .insert(dirtyDay)
      .values({ personId, localDate, cause, createdAt: at, revision: 0 })
      .onConflictDoUpdate({
        target: [dirtyDay.personId, dirtyDay.localDate, dirtyDay.cause],
        set: { createdAt: at, revision: sql`${dirtyDay.revision} + 1` },
      })
      .run();
  }
}

export type DaysChangedDispatcher = {
  /**
   * Stellt alle offenen Marker zu: nach jedem Commit mit neuen Markern und beim App-Start, damit
   * Zustellungen nach einem Neustart weiterlaufen. Läuft nie parallel; ein Anstoß während einer
   * Zustellung hängt eine weitere Runde an. Fehler gehen an `onError`, die Marker bleiben.
   */
  deliver(): Promise<void>;
  /**
   * Für ein begrenztes Hintergrundfenster, etwa den Health-Hintergrundimport (Spezifikation 3):
   * wartet höchstens `withinMs` auf die Zustellung. Offene Marker bleiben für den nächsten Anstoß.
   */
  drain(withinMs: number): Promise<'delivered' | 'pending'>;
  /** Zahl der noch nicht bestätigten Marker. */
  pending(): number;
};

type Marker = { personId: string; localDate: string; cause: string; revision: number };

export function createDaysChangedDispatcher({
  database,
  observers,
  onError,
}: {
  database: LocalDatabase;
  observers: readonly DaysChangedObserver[];
  onError: (error: unknown) => void;
}): DaysChangedDispatcher {
  let running: Promise<void> | null = null;
  let again = false;

  async function run() {
    do {
      again = false;
      for (const group of groupMarkers(database.read(readMarkers))) {
        try {
          for (const observer of observers) await observer(group.signal);
        } catch (error) {
          onError(error);
          continue;
        }
        database.transaction((tx) => acknowledge(tx, group.markers));
      }
    } while (again);
  }

  function pending() {
    return database.read((tx) => sqliteOf(tx).select({ value: count() }).from(dirtyDay).get()?.value ?? 0);
  }

  function deliver(): Promise<void> {
    if (running !== null) {
      again = true;
      return running;
    }
    running = run()
      .catch(onError)
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    deliver,
    pending,
    async drain(withinMs) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const window = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, withinMs);
      });
      await Promise.race([deliver(), window]);
      clearTimeout(timer);
      return pending() === 0 ? 'delivered' : 'pending';
    },
  };
}

function readMarkers(tx: ReadContext): Marker[] {
  return sqliteOf(tx)
    .select({ personId: dirtyDay.personId, localDate: dirtyDay.localDate, cause: dirtyDay.cause, revision: dirtyDay.revision })
    .from(dirtyDay)
    .all();
}

/** Je Person und Auslöser ein Signal mit aufsteigenden Tagen; Auslöser in Katalogreihenfolge. */
function groupMarkers(markers: readonly Marker[]): { signal: DaysChanged; markers: Marker[] }[] {
  const groups = new Map<string, Marker[]>();
  for (const marker of markers) {
    const key = `${marker.personId}:${DailyGoalCause.options.indexOf(DailyGoalCause.parse(marker.cause))}`;
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, members]) => ({
      markers: members,
      signal: {
        personId: EntityId.parse(members[0]!.personId),
        cause: DailyGoalCause.parse(members[0]!.cause),
        localDates: members.map((marker) => LocalDate.parse(marker.localDate)).sort(),
      },
    }));
}

/** Löscht nur die zugestellte Revision; ein währenddessen erneut gesetzter Marker bleibt. */
function acknowledge(tx: TransactionContext, markers: readonly Marker[]) {
  for (const marker of markers) {
    sqliteOf(tx)
      .delete(dirtyDay)
      .where(
        and(
          eq(dirtyDay.personId, marker.personId),
          eq(dirtyDay.localDate, marker.localDate),
          eq(dirtyDay.cause, marker.cause),
          eq(dirtyDay.revision, marker.revision),
        ),
      )
      .run();
  }
}
