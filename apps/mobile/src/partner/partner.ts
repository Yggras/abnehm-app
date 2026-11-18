import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';
import type { EncouragementKey } from '@abnehm/contracts/partner';

import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { readPartnerCache } from '../partner-cache';
import type { Refresh, Source } from '../shell/followed-source';
import type { TodaySource } from '../shell/today-registry';
import { readLastPullAt, type SyncWriter } from '../sync';
import type { ObserveNetwork } from '../sync/triggers';
import { readEncourageSheet, sendEncouragement, type EncourageOutcome, type EncourageSheet } from './encouragement';
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
  /** Outbox des Fundaments: Anfeuern merkt `sendEncouragement` in der Transaktion der Anfeuerung vor (#123). */
  writer: SyncWriter;
  newId: () => EntityId;
}>;

/** Sheet `partner.encourage` samt Netzstatus, der die Bestätigung bestimmt; `loading` bis zur ersten Lesung. */
export type EncourageView = Readonly<{ type: 'loading' }> | (EncourageSheet & Readonly<{ online: boolean }>);

export type Partner = Readonly<{
  /** Partnerzustand für „Wir“: lädt, solo oder gekoppelt mit Übersicht. */
  wir: Source<WirPartner>;
  /** Beitrag `partner` für „Heute“. */
  todayCard: TodaySource<'partner'>;
  /** Pull-to-Refresh auf „Wir“: startet den Sync. */
  refresh(): Promise<unknown>;
  /** Sheet `partner.encourage`: Name des Partners und die verbleibenden Anfeuerungen mit Push heute. */
  encourageSheet: Source<EncourageView>;
  /** Feuert den Partner sofort an, ohne Rückfrage; offline geht die Anfeuerung beim nächsten Push raus. */
  encourage(messageKey: EncouragementKey): EncourageOutcome;
}>;

function readPartner(tx: ReadContext): PartnerReading {
  if (readOwnPerson(tx) === undefined) return null;
  return { cache: readPartnerCache(tx), lastPullAt: readLastPullAt(tx) };
}

/**
 * Eine Quelle über eine Lesung der Kontodatenbank und den Netzstatus: neu bei jedem Commit, jeder
 * Netzänderung und im Minutentakt, weil Alter und lokaler Tag auch ohne Commit weiterlaufen.
 */
function followedReading<R, V>(
  { database, observeOnline, refresh }: Pick<PartnerDependencies, 'database' | 'observeOnline' | 'refresh'>,
  read: (tx: ReadContext) => R,
  view: (reading: R, online: boolean) => V,
): Source<V> {
  return {
    subscribe(listener) {
      let reading: { value: R } | undefined;
      let online = true;
      const emit = () => {
        if (reading !== undefined) listener(view(reading.value, online));
      };
      const stopOnline = observeOnline((next) => {
        if (next === online) return;
        online = next;
        emit();
      });
      const stopObserving = database.observe(read, (next) => {
        reading = { value: next };
        emit();
      });
      const stopRefresh = refresh(() => {
        try {
          reading = { value: database.read(read) };
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
}

export function createPartner(dependencies: PartnerDependencies): Partner {
  const { database, clock, sync, writer, newId } = dependencies;
  // Alter des Stands und die 10-Minuten-Grenze ändern sich auch ohne Commit.
  const wir = followedReading(dependencies, readPartner, (reading, online) => wirPartnerOf(reading, online, clock.read()));
  // Der Zähler gilt für den lokalen Tag; um Mitternacht beginnt er neu.
  const encourageSheet = followedReading(
    dependencies,
    (tx) => readEncourageSheet(tx, clock.read().localDate),
    (sheet, online): EncourageView => ({ ...sheet, online }),
  );
  return {
    wir,
    todayCard: { subscribe: (listener) => wir.subscribe((partner) => listener(partnerCardOf(partner))) },
    refresh: sync,
    encourageSheet,
    encourage: (messageKey) => database.transaction((tx) => sendEncouragement(tx, { writer, newId, clock }, messageKey)),
  };
}
