import { z } from 'zod';

import { startOfLocalDate, type Clock } from '@abnehm/clock';
import { Instant, LocalDate } from '@abnehm/contracts/base';

import type { LocalDatabase } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import type { Trackers } from '../trackers';
import { healthDataTypes, type HealthAccessState, type HealthDataType, type HealthPlatformAdapter } from './platform';

// Health-Import-Dienst der App (Spezifikation 3, Abschnitte 2 und 6; #183). Er steuert Verbindung,
// Erstimport, Import der Änderungen und Abgleich nach verfallenem Token und schreibt ausschließlich über
// den internen Importbefehl des Tracker-Moduls, eine Transaktion je Stapel samt Cursor. Es läuft höchstens
// ein Import je Gerät gleichzeitig; weitere Auslöser werden zu genau einem Nachlauf zusammengefasst. Fehler
// bleiben still und werden beim nächsten Auslöser nachgeholt: Ohne Verbindung oder bei entzogener
// Berechtigung bleibt alles manuell nutzbar, und bereits importierte Einträge bleiben. Geschrieben wird nie
// nach Apple Health oder Health Connect; der Adapter kennt dafür gar keine Operation.

/** Ergebnis von „Verbinden“. Auf iOS ist nicht erkennbar, ob Lesezugriff erteilt wurde (`angefragt`). */
export type HealthConnectOutcome =
  | Readonly<{ type: 'verbunden'; access: HealthAccessState }>
  | Readonly<{ type: 'nicht_verfuegbar' }>
  | Readonly<{ type: 'installation_noetig' }>;

/** Lokaler Gerätezustand der Verbindung (Spezifikation 3, Abschnitt 8); nicht synchronisiert. */
export type HealthConnection = Readonly<{
  connectedAt: Instant;
  /** Lokaler Tag der Verbindung. */
  connectedOn: LocalDate;
  /** Trainings ab dem Beginn des lokalen Verbindungstags. */
  workoutsSince: Instant;
  /** Gewichte der letzten 30 Tage vor der Verbindung. */
  weightsSince: Instant;
  lastImportAt: Instant | null;
}>;

export type HealthImport = Readonly<{
  /** Der Plattform-Adapter, etwa für Verfügbarkeit und Prüfung der Quell-Apps (#189, #190). */
  platform: HealthPlatformAdapter;
  /**
   * Prüft die Verfügbarkeit, fragt Lesezugriff an und merkt sich die Verbindung samt Verbindungstag. Direkt
   * danach startet der Import. Eine bestehende Verbindung behält ihren Verbindungstag.
   */
  connect(): Promise<HealthConnectOutcome>;
  /**
   * Importiert jetzt, etwa für „Jetzt abrufen“. Läuft schon ein Import, folgt genau ein Nachlauf; alle
   * Auslöser bis zu seinem Beginn teilen ihn. Die Zusage erfüllt sich, wenn der zuständige Lauf endet, und
   * wird nie abgelehnt.
   */
  importNow(): Promise<void>;
  /** Löst bei Rückkehr in den Vordergrund aus, mit `initialActive` auch sofort (App-Start). */
  startForegroundTriggers(options: { initialActive: boolean; observeForeground(listener: (active: boolean) => void): () => void }): () => void;
  /** Die Verbindung dieses Geräts, oder `null`, solange nicht verbunden. */
  connection(): HealthConnection | null;
  /** Erfüllt sich, sobald weder ein Import noch ein Nachlauf aussteht. */
  idle(): Promise<void>;
}>;

export type HealthImportDependencies = Readonly<{
  database: LocalDatabase;
  platform: HealthPlatformAdapter;
  trackers: Pick<Trackers, 'importHealth'>;
  clock: Clock;
  /** Stille Fehler, etwa ins Protokoll; die Oberfläche zeigt keine Fehlermeldung. */
  onError(error: unknown): void;
}>;

const dayMs = 86_400_000;
/** Zeitraum des Gewichts beim Erstimport und des Abgleichs nach verfallenem Token. */
const windowDays = 30;

const connectionKey = 'health_connection';
const cursorKey = (type: HealthDataType) => `health_cursor_${type}`;

const ConnectionValue = z.strictObject({
  connectedAt: Instant,
  connectedOn: LocalDate,
  workoutsSince: Instant,
  weightsSince: Instant,
  lastImportAt: Instant.nullable(),
});
const CursorValue = z.strictObject({ cursor: z.string().nullable() });

export function createHealthImport({ database, platform, trackers, clock, onError }: HealthImportDependencies): HealthImport {
  let current: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  const connection = () => database.read((tx) => ConnectionValue.safeParse(readDeviceState(tx, connectionKey)).data ?? null);

  async function importType(type: HealthDataType, connected: HealthConnection) {
    const now = clock.read();
    const notBefore = type === 'workout' ? connected.workoutsSince : connected.weightsSince;
    const cursor = database.read((tx) => CursorValue.safeParse(readDeviceState(tx, cursorKey(type))).data?.cursor ?? null);
    let changes = await platform.readChanges(type, cursor, notBefore);
    let reconcileSince: Instant | null = null;
    if (changes.cursorExpired) {
      // Abgleich der letzten 30 Tage, nie vor dem Beginn des Imports (Spezifikation 3, Abschnitt 6).
      reconcileSince = later(notBefore, windowStart(now.instant));
      changes = await platform.readChanges(type, null, reconcileSince);
      if (changes.cursorExpired) return;
    }
    const next = changes.cursor;
    trackers.importHealth(
      { origin: platform.origin, type, upserts: changes.upserts, deletedKeys: changes.deletedKeys, reconcileSince, notBefore },
      (tx) => {
        // Anker bzw. Token sind lokaler Gerätezustand und werden nur zusammen mit den Daten gespeichert.
        writeDeviceState(tx, cursorKey(type), { cursor: next }, now.instant);
        writeDeviceState(tx, connectionKey, { ...connected, lastImportAt: now.instant } satisfies HealthConnection, now.instant);
      },
    );
  }

  async function runOnce(): Promise<void> {
    try {
      const connected = connection();
      if (connected === null) return;
      if ((await platform.availability()) !== 'verfuegbar') return;
      const access = await platform.accessState();
      if (access === 'nicht_angefragt' || access === 'verweigert') return;
      for (const type of healthDataTypes) {
        try {
          await importType(type, connection() ?? connected);
        } catch (error) {
          onError(error);
        }
      }
    } catch (error) {
      onError(error);
    }
  }

  function importNow(): Promise<void> {
    if (current === null) {
      current = runOnce().finally(() => {
        current = null;
      });
      return current;
    }
    followUp ??= current.then(() => {
      followUp = null;
      return importNow();
    });
    return followUp;
  }

  return {
    platform,
    async connect() {
      const availability = await platform.availability();
      if (availability !== 'verfuegbar') return { type: availability };
      const access = await platform.requestReadAccess();
      if (connection() === null) {
        const now = clock.read();
        database.transaction((tx) =>
          writeDeviceState(
            tx,
            connectionKey,
            {
              connectedAt: now.instant,
              connectedOn: now.localDate,
              workoutsSince: startOfLocalDate(now.localDate, now.timeZone),
              weightsSince: windowStart(now.instant),
              lastImportAt: null,
            } satisfies HealthConnection,
            now.instant,
          ),
        );
      }
      void importNow();
      return { type: 'verbunden', access };
    },
    importNow,
    startForegroundTriggers({ initialActive, observeForeground }) {
      let active = initialActive;
      if (active) void importNow();
      return observeForeground((next) => {
        if (next && !active) void importNow();
        active = next;
      });
    },
    connection,
    async idle() {
      while (current !== null || followUp !== null) await (followUp ?? current);
    },
  };
}

/** Beginn der letzten 30 Tage vor einem Zeitpunkt: Gewicht beim Erstimport und Abgleich nach verfallenem Token. */
function windowStart(at: Instant): Instant {
  return Instant.parse(new Date(Date.parse(at) - windowDays * dayMs).toISOString());
}

function later(a: Instant, b: Instant): Instant {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
