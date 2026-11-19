import type { Clock } from '@abnehm/clock';
import type { EntityId } from '@abnehm/contracts/base';
import type { EncouragementKey } from '@abnehm/contracts/partner';

import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { readPartnerCache } from '../partner-cache';
import type { WirContributionsSlot } from '../shell/app-wir';
import type { Refresh, Source } from '../shell/followed-source';
import type { TodaySource } from '../shell/today-registry';
import { readLastPullAt, type SyncWriter } from '../sync';
import type { ObserveNetwork } from '../sync/triggers';
import { readCouplingState, type CouplingState } from './coupling-state';
import { readEncourageSheet, sendEncouragement, type EncourageOutcome, type EncourageSheet } from './encouragement';
import { partnerCardOf, wirPartnerOf, type PartnerReading, type WirPartner } from './partner-view';
import { changeSharing, readSharing, type Sharing, type SharingChange, type SharingOutcome } from './sharing';
import { wirSharedOf, type WirShared } from './wir-shared';

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
  /**
   * Beiträge von Spezifikation 4 an „Wir“ über den Steckplatz der App (`appWirContributions.source`); `null`,
   * solange keine `WirContributionSource` angemeldet ist (#124).
   */
  wirContributions: Source<WirContributionsSlot>;
}>;

/** Sheet `partner.encourage` samt Netzstatus, der die Bestätigung bestimmt; `loading` bis zur ersten Lesung. */
export type EncourageView = Readonly<{ type: 'loading' }> | (EncourageSheet & Readonly<{ online: boolean }>);

/** Eigene Freigaben samt Netzstatus, der bestimmt, ob das Abschalten erst mit der nächsten Verbindung wirkt. */
export type SharingView = Readonly<{ type: 'loading' }> | (Exclude<Sharing, { type: 'loading' }> & Readonly<{ online: boolean }>);

export type Partner = Readonly<{
  /** Partnerzustand für „Wir“: lädt, solo oder gekoppelt mit Übersicht. */
  wir: Source<WirPartner>;
  /** Gemeinsame Bereiche von „Wir“: Vorgänge, Challenge, Gemeinschaftsprojekt und „Neu bei euch“ (#124). */
  shared: Source<WirShared>;
  /** Beitrag `partner` für „Heute“. */
  todayCard: TodaySource<'partner'>;
  /** Pull-to-Refresh auf „Wir“: startet den Sync. */
  refresh(): Promise<unknown>;
  /** Sheet `partner.encourage`: Name des Partners und die verbleibenden Anfeuerungen mit Push heute. */
  encourageSheet: Source<EncourageView>;
  /** Feuert den Partner sofort an, ohne Rückfrage; offline geht die Anfeuerung beim nächsten Push raus. */
  encourage(messageKey: EncouragementKey): EncourageOutcome;
  /** Stand der Kopplung für `partner.invite` und `partner.redeem` (#120): solo oder gekoppelt, und ob Momo geschlüpft ist. */
  couplingState: Source<CouplingState>;
  /** „Partner & Freigaben“ und Onboarding-Schritt `partner` (#129): Kopplung und eigene Freigaben. */
  sharing: Source<SharingView>;
  /** Ein Schalterwechsel: sofort lokal, der Upsert geht mit dem nächsten Push raus. */
  share(change: SharingChange): SharingOutcome;
  /**
   * Ob `partner.invite` für dieses Konto schon einen Code erzeugt hat, solange die Kontodatenbank offen ist. Der
   * Onboarding-Schritt `partner` meldet dann `partner_invite_created`; die Kopplung kann später entstehen. Den Code
   * selbst hält niemand fest (Online-Abläufe sind flüchtig, Spezifikation 0, Abschnitt 9).
   */
  invitationCreated: Source<boolean>;
  noteInvitationCreated(): void;
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

/**
 * Gemeinsame Bereiche von „Wir“ aus den Spiel-Beiträgen: neu bei jedem Zustand der Quelle und im Minutentakt,
 * weil „vor X Min.“, Restlaufzeit und die Kalenderwoche auch ohne neuen Beitrag weiterlaufen. Weitere
 * gemeinsame Ereignisse, etwa Anfeuerungen (#126), kommen als zweites Argument von `wirSharedOf` hinzu.
 */
function followedShared({ wirContributions, clock, refresh }: Pick<PartnerDependencies, 'wirContributions' | 'clock' | 'refresh'>): Source<WirShared> {
  return {
    subscribe(listener) {
      let state: { value: WirContributionsSlot } | undefined;
      const emit = () => {
        if (state !== undefined) listener(wirSharedOf(state.value, [], clock.read()));
      };
      const stopContributions = wirContributions.subscribe((next) => {
        state = { value: next };
        emit();
      });
      const stopRefresh = refresh(emit);
      return () => {
        stopContributions();
        stopRefresh();
      };
    },
  };
}

export function createPartner(dependencies: PartnerDependencies): Partner {
  const { database, clock, sync, writer, newId } = dependencies;
  let invitationCreated = false;
  const invitationListeners = new Set<(created: boolean) => void>();
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
    shared: followedShared(dependencies),
    todayCard: { subscribe: (listener) => wir.subscribe((partner) => listener(partnerCardOf(partner))) },
    refresh: sync,
    encourageSheet,
    encourage: (messageKey) => database.transaction((tx) => sendEncouragement(tx, { writer, newId, clock }, messageKey)),
    couplingState: followedReading(dependencies, readCouplingState, (state) => state),
    sharing: followedReading(dependencies, readSharing, (sharing, online): SharingView => (sharing.type === 'loading' ? sharing : { ...sharing, online })),
    share: (change) => database.transaction((tx) => changeSharing(tx, { writer, clock }, change)),
    invitationCreated: {
      subscribe(listener) {
        listener(invitationCreated);
        invitationListeners.add(listener);
        return () => invitationListeners.delete(listener);
      },
    },
    noteInvitationCreated() {
      if (invitationCreated) return;
      invitationCreated = true;
      for (const listener of invitationListeners) listener(true);
    },
  };
}
