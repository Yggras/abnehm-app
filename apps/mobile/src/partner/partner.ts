import type { Clock } from '@abnehm/clock';

import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { readPartnerCache } from '../partner-cache';
import type { Refresh, Source } from '../shell/followed-source';
import type { TodaySource } from '../shell/today-registry';
import { readLastPullAt } from '../sync';
import type { ObserveNetwork } from '../sync/triggers';
import { partnerCardOf, wirPartnerOf, type PartnerReading, type WirPartner } from './partner-view';

// Partnerbereich der App (Spezifikation 5, Abschnitte 2 und 3; #121) über der Datenbank eines Kontos.
// Er liest den Partner ausschließlich aus dem widerrufbaren Partnercache (#106): Jede Pull-Seite mit
// Löschmarkierung oder Revocation-Notice löst einen Commit aus, nach dem „Wir“ und „Heute“ neu lesen.

export type PartnerDependencies = Readonly<{
  database: LocalDatabase;
  clock: Clock;
  /**
   * Netzstatus des Geräts wie für die Sync-Auslöser. Ohne Meldung gilt das Gerät als verbunden; veraltet ist
   * der Stand dann über das Alter des letzten Pulls.
   */
  observeOnline: ObserveNetwork;
  /** Minutentakt: Alter des Stands und die 10-Minuten-Grenze ändern sich auch ohne Commit. */
  refresh: Refresh;
  /** Sync des Fundaments (#102) für Pull-to-Refresh. */
  sync: () => Promise<unknown>;
}>;

export type Partner = Readonly<{
  /** Partnerzustand für „Wir“: lädt, solo oder gekoppelt mit Übersicht. */
  wir: Source<WirPartner>;
  /** Beitrag `partner` für „Heute“. */
  todayCard: TodaySource<'partner'>;
  /** Pull-to-Refresh auf „Wir“: startet den Sync. */
  refresh(): Promise<unknown>;
}>;

function readPartner(tx: ReadContext): PartnerReading {
  if (readOwnPerson(tx) === undefined) return null;
  return { cache: readPartnerCache(tx), lastPullAt: readLastPullAt(tx) };
}

export function createPartner({ database, clock, observeOnline, refresh, sync }: PartnerDependencies): Partner {
  const wir: Source<WirPartner> = {
    subscribe(listener) {
      let reading: PartnerReading | undefined;
      let online = true;
      const emit = () => {
        if (reading !== undefined) listener(wirPartnerOf(reading, online, clock.read()));
      };
      const stopOnline = observeOnline((next) => {
        if (next === online) return;
        online = next;
        emit();
      });
      const stopObserving = database.observe(readPartner, (next) => {
        reading = next;
        emit();
      });
      // Alter des Stands und die 10-Minuten-Grenze ändern sich auch ohne Commit.
      const stopRefresh = refresh(() => {
        try {
          reading = database.read(readPartner);
        } catch (error) {
          if (!(error instanceof LocalDatabaseClosedError)) throw error;
          return;
        }
        emit();
      });
      return () => {
        stopObserving();
        stopOnline();
        stopRefresh();
      };
    },
  };
  return {
    wir,
    todayCard: { subscribe: (listener) => wir.subscribe((partner) => listener(partnerCardOf(partner))) },
    refresh: sync,
  };
}
