import { Instant } from '@abnehm/contracts/base';
import type { ImportOrigin } from '@abnehm/contracts/trackers';

// Health-Plattform-Adapter (Spezifikation 3, Abschnitt 2; #183): die einzige neue Naht des Bereichs,
// weil es echte Varianten gibt. Ein Interface, drei Implementierungen: HealthKit (#193), Health Connect
// (#195) und die steuerbare Attrappe für Tests, Development- und E2E-Build (`./testing/fake-platform`).
// Der Adapter liefert nur normalisierte Datensätze. Bibliothekstypen bleiben in seiner Implementierung;
// Annahmeregeln, Rundung und die Abbildung der Aktivitätsarten stehen in den Tracker-Regeln.

/** Gelesene Datentypen: Trainings und Körpergewicht. Wasser, Schritte, Schlaf und Vitalwerte nie. */
export const healthDataTypes = ['workout', 'weight'] as const;
export type HealthDataType = (typeof healthDataTypes)[number];

/** Ob die Plattform auf dem Gerät nutzbar ist; „Installation nötig“ gibt es nur bei Health Connect unter Android 14. */
export type HealthAvailability = 'verfuegbar' | 'nicht_verfuegbar' | 'installation_noetig';

/**
 * Stand des Lesezugriffs. iOS lässt eine Verweigerung nicht erkennen
 * (https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data); HealthKit meldet
 * nach der Anfrage deshalb immer `angefragt`, nie `erteilt` oder `verweigert`.
 */
export type HealthAccessState = 'nicht_angefragt' | 'angefragt' | 'erteilt' | 'verweigert';

/** Ob der Import im Hintergrund möglich ist (Android: Feature-Check und Berechtigung). */
export type HealthBackgroundCapability = 'verfuegbar' | 'nicht_verfuegbar' | 'nicht_erlaubt';

/** Quell-App eines Datensatzes: Bundle- bzw. Paketkennung und, falls die Plattform ihn liefert, ein Anzeigename. */
export type HealthSourceApp = Readonly<{ id: string; name: string | null }>;

/** Felder jedes normalisierten Datensatzes. */
type HealthRecordBase = Readonly<{
  /** UUID des Samples (HealthKit) bzw. `metadata.id` (Health Connect). */
  externalKey: string;
  sourceApp: HealthSourceApp;
  /** Offset zu UTC in Minuten, falls der Datensatz ihn mitliefert; sonst gilt der der Gerätezone. */
  utcOffsetMinutes: number | null;
}>;

/** Ein Training, normalisiert. */
export type HealthWorkoutRecord = HealthRecordBase &
  Readonly<{
    type: 'workout';
    startedAt: Instant;
    endedAt: Instant;
    /** iOS: Dauer des Workouts; Health Connect: Ende minus Beginn der Trainingssitzung. */
    durationSeconds: number;
    /** Plattformcode der Aktivitätsart (`HKWorkoutActivityType` bzw. `EXERCISE_TYPE_*`), falls vorhanden. */
    platformActivityType: number | null;
    /** Aktive Kalorien der Quelle in `milli_kcal`; Health Connect liefert keine. */
    activeMilliKcal: number | null;
  }>;

/** Ein Gewicht, normalisiert. */
export type HealthWeightRecord = HealthRecordBase &
  Readonly<{
    type: 'weight';
    measuredAt: Instant;
    /** Körpergewicht in ganzen g. */
    weightG: number;
  }>;

export type HealthRecordOf<T extends HealthDataType> = T extends 'workout' ? HealthWorkoutRecord : HealthWeightRecord;
export type HealthRecord = HealthWorkoutRecord | HealthWeightRecord;

/**
 * Ergebnis einer Abfrage der Änderungen eines Typs. Ist `cursorExpired` gesetzt, ist der Cursor verfallen:
 * Upserts und Löschungen sind dann leer, und der Aufrufer liest den Zeitraum ohne Cursor neu.
 */
export type HealthChanges<T extends HealthDataType> = Readonly<{
  upserts: readonly HealthRecordOf<T>[];
  /** Externe Schlüssel der in der Quelle gelöschten Datensätze. */
  deletedKeys: readonly string[];
  /** Neuer Anker bzw. Change-Token; lokaler Gerätezustand, opak für den Aufrufer. */
  cursor: string | null;
  cursorExpired: boolean;
}>;

/** Eine Quell-App mit der Zahl ihrer Trainings und Gewichte im Zeitraum. */
export type HealthOrigin = Readonly<{ sourceApp: HealthSourceApp; workouts: number; weights: number }>;

/** Wird bei einer Weckung im Hintergrund aufgerufen; Fehler bleiben still. */
export type HealthBackgroundHandler = () => Promise<void>;

export interface HealthPlatformAdapter {
  /** Herkunft der Einträge: `apple_health` (HealthKit) bzw. `health_connect`. */
  readonly origin: ImportOrigin;
  availability(): Promise<HealthAvailability>;
  /** Fragt ausschließlich Lesezugriff für Trainings und Körpergewicht an; geschrieben wird nie. */
  requestReadAccess(): Promise<HealthAccessState>;
  accessState(): Promise<HealthAccessState>;
  /**
   * Änderungen eines Typs seit dem Cursor. Ohne Cursor liefert die Abfrage alle Datensätze ab `since`;
   * die erste Abfrage begrenzt so immer den Zeitraum (eine Anker-Abfrage ohne Anker liefert sonst die
   * gesamte Historie).
   */
  readChanges<T extends HealthDataType>(type: T, cursor: string | null, since: Instant): Promise<HealthChanges<T>>;
  /** Quell-Apps der Trainings und Gewichte der letzten `days` Tage. */
  recentOrigins(days: number): Promise<readonly HealthOrigin[]>;
  backgroundCapability(): Promise<HealthBackgroundCapability>;
  /** Meldet den Handler für Weckungen im Hintergrund an. */
  registerBackground(handler: HealthBackgroundHandler): void;
}

const dayMs = 86_400_000;

/** Zeitpunkt `days` mal 24 Stunden vor `at`: Zeiträume von Import, Abgleich und Quell-Apps. */
export function daysBefore(at: Instant, days: number): Instant {
  return Instant.parse(new Date(Date.parse(at) - days * dayMs).toISOString());
}

/**
 * Adapter ohne Plattform: Health ist nicht verfügbar, gelesen wird nichts. Er gilt im Produktionsbuild,
 * bis HealthKit (#193) und Health Connect (#195) ihre Adapter liefern; ohne Verbindung bleibt alles
 * manuell nutzbar.
 */
export function unavailableHealthPlatform(origin: ImportOrigin): HealthPlatformAdapter {
  return {
    origin,
    availability: () => Promise.resolve('nicht_verfuegbar'),
    requestReadAccess: () => Promise.resolve('nicht_angefragt'),
    accessState: () => Promise.resolve('nicht_angefragt'),
    readChanges: () => Promise.resolve({ upserts: [], deletedKeys: [], cursor: null, cursorExpired: false }),
    recentOrigins: () => Promise.resolve([]),
    backgroundCapability: () => Promise.resolve('nicht_verfuegbar'),
    registerBackground: () => {},
  };
}
