import type { Clock } from '@abnehm/clock';
import { Instant } from '@abnehm/contracts/base';
import type {
  GetChangesRequest,
  GetChangesResults,
  Permission,
  ReadRecordsOptions,
  ReadRecordsResult,
  RecordResult,
} from 'react-native-health-connect';

import {
  daysBefore,
  expiredHealthChanges,
  tallyOrigins,
  type HealthAccessState,
  type HealthAvailability,
  type HealthChanges,
  type HealthDataType,
  type HealthPlatformAdapter,
  type HealthRecordOf,
  type HealthWeightRecord,
  type HealthWorkoutRecord,
} from './platform';

// Health-Connect-Adapter (Spezifikation 3, Abschnitt 6; #195): die Android-Implementierung des
// Health-Plattform-Adapters mit `react-native-health-connect`. Bibliothekstypen bleiben in dieser Datei;
// hinaus gehen nur normalisierte Datensätze. Annahmeregeln, Rundung und die Abbildung der Aktivitätsarten
// stehen in den Tracker-Regeln. Geschrieben wird nie: Der Client unten kennt keine Schreiboperation.

/**
 * Die genutzten Funktionen von `react-native-health-connect` 4.1.3. Im Gerät ist es das Modul selbst
 * (`./device-platform.android.ts`), in Tests eine Attrappe mit aufgezeichneten Datensätzen.
 */
export type HealthConnectClient = Readonly<{
  getSdkStatus(): Promise<number>;
  initialize(): Promise<boolean>;
  requestPermission(permissions: Permission[]): Promise<readonly GrantedPermission[]>;
  getGrantedPermissions(): Promise<readonly GrantedPermission[]>;
  readRecords<T extends RecordTypeOf<HealthDataType>>(recordType: T, options: ReadRecordsOptions): Promise<ReadRecordsResult<T>>;
  getChanges(request: GetChangesRequest): Promise<GetChangesResults>;
}>;

/** Eine erteilte Berechtigung, wie die Bibliothek sie meldet. */
type GrantedPermission = Readonly<{ accessType: string; recordType: string }>;

export type HealthConnectPlatformOptions = Readonly<{ client: HealthConnectClient; clock: Clock }>;

type RecordTypeOf<T extends HealthDataType> = T extends 'workout' ? 'ExerciseSession' : 'Weight';

/** Je Datentyp der Record-Typ von Health Connect und seine Normalisierung. */
type Kind<T extends HealthDataType> = Readonly<{ recordType: RecordTypeOf<T>; normalize(record: RecordResult<RecordTypeOf<T>>): HealthRecordOf<T> | null }>;
const kinds: { readonly [T in HealthDataType]: Kind<T> } = {
  workout: { recordType: 'ExerciseSession', normalize: (record) => normalizeWorkout(record) },
  weight: { recordType: 'Weight', normalize: (record) => normalizeWeight(record) },
};

/** Nur Lesen von Trainings und Gewicht; kein Schreiben, keine ältere Historie, kein Hintergrund (#199). */
const readPermissions: Permission[] = [
  { accessType: 'read', recordType: kinds.workout.recordType },
  { accessType: 'read', recordType: kinds.weight.recordType },
];

/**
 * `SdkAvailabilityStatus` der Bibliothek. Bis Android 13 fehlt Health Connect, bis die App aus dem Play
 * Store installiert bzw. aktualisiert ist (`SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED`); ab Android 14 ist
 * es Teil des Systems (https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started).
 */
const sdkStatus = { available: 3, providerUpdateRequired: 2 } as const;

/**
 * Fehlercode der Bibliothek für eine `IllegalArgumentException` (`ExceptionsUtils.kt`). Dass Health Connect
 * einen ungültigen Token so meldet, ist nicht belegt; der Gerätetest prüft es. Android behandelt „invalid
 * or expired Changes tokens“ gleich (https://developer.android.com/health-and-fitness/guides/health-connect/develop/sync-data).
 */
const invalidArgument = 'ARGUMENT_VALIDATION_ERROR';

export function createHealthConnectPlatform({ client, clock }: HealthConnectPlatformOptions): HealthPlatformAdapter {
  let ready: Promise<void> | null = null;

  /** Der Client verlangt `initialize` vor jedem Zugriff (`ClientNotInitialized`); einmal je Prozess. */
  function initialized(): Promise<void> {
    ready ??= client.initialize().then(
      (ok) => {
        if (!ok) throw new Error('Health Connect ließ sich nicht initialisieren');
      },
      (error: unknown) => {
        ready = null;
        throw error;
      },
    );
    return ready;
  }

  async function availability(): Promise<HealthAvailability> {
    const status = await client.getSdkStatus();
    if (status === sdkStatus.available) return 'verfuegbar';
    return status === sdkStatus.providerUpdateRequired ? 'installation_noetig' : 'nicht_verfuegbar';
  }

  /** Alle Datensätze eines Typs im Zeitraum, über alle Seiten. */
  async function readAll<T extends HealthDataType>(type: T, timeRangeFilter: ReadRecordsOptions['timeRangeFilter']): Promise<RecordResult<RecordTypeOf<T>>[]> {
    const records: RecordResult<RecordTypeOf<T>>[] = [];
    let pageToken: string | undefined;
    do {
      const result = await client.readRecords(kinds[type].recordType, { timeRangeFilter, ...(pageToken === undefined ? {} : { pageToken }) });
      records.push(...result.records);
      pageToken = result.pageToken === '' || result.pageToken == null ? undefined : result.pageToken;
    } while (pageToken !== undefined);
    return records;
  }

  /**
   * Holt Seiten von `getChanges` ab dem Token, bis keine weiteren vorliegen. `null` heißt: Der Token ist
   * verfallen oder ungültig.
   */
  async function drain<T extends HealthDataType>(type: T, token: string): Promise<{ touched: Map<string, HealthRecordOf<T> | null>; next: string } | null> {
    // Spätere Änderungen desselben Datensatzes ersetzen frühere; `null` ist eine Löschung.
    const touched = new Map<string, HealthRecordOf<T> | null>();
    let next = token;
    for (;;) {
      let page: GetChangesResults;
      try {
        page = await client.getChanges({ changesToken: next });
      } catch (error) {
        if (codeOf(error) === invalidArgument) return null;
        throw error;
      }
      if (page.changesTokenExpired) return null;
      for (const change of page.upsertionChanges) {
        // Ein Token gilt für genau einen Record-Typ (`getChangesToken` je Typ).
        const record = kinds[type].normalize(change.record as unknown as RecordResult<RecordTypeOf<T>>);
        if (record !== null) {
          touched.delete(record.externalKey);
          touched.set(record.externalKey, record);
        }
      }
      for (const change of page.deletionChanges) {
        touched.delete(change.recordId);
        touched.set(change.recordId, null);
      }
      next = page.nextChangesToken;
      if (!page.hasMore) return { touched, next };
    }
  }

  return {
    origin: 'health_connect',
    availability,
    async requestReadAccess() {
      await initialized();
      return accessOf(await client.requestPermission(readPermissions), 'verweigert');
    },
    async accessState() {
      if ((await availability()) !== 'verfuegbar') return 'nicht_angefragt';
      await initialized();
      // Android verrät nicht, ob schon gefragt wurde; ohne Berechtigung gilt der Zugriff als nicht angefragt.
      return accessOf(await client.getGrantedPermissions(), 'nicht_angefragt');
    },
    async readChanges<T extends HealthDataType>(type: T, cursor: string | null, since: Instant): Promise<HealthChanges<T>> {
      await initialized();
      if (cursor !== null) {
        const changes = await drain(type, cursor);
        if (changes === null) return expiredHealthChanges;
        const upserts = [...changes.touched.values()].filter((record): record is HealthRecordOf<T> => record !== null);
        const deletedKeys = [...changes.touched].filter(([, record]) => record === null).map(([key]) => key);
        return { upserts, deletedKeys, cursor: changes.next, cursorExpired: false };
      }
      // Erste Abfrage: Token je Typ vor dem Lesen holen, damit nichts dazwischen verloren geht; der Zeitraum
      // ist immer begrenzt. Ohne Token gibt die Bibliothek einen neuen aus (`getChangesToken`).
      const tokenResponse = await client.getChanges({ recordTypes: [kinds[type].recordType] });
      const records = await readAll(type, { operator: 'after', startTime: since });
      const upserts = records.map((record) => kinds[type].normalize(record)).filter((record) => record !== null);
      return { upserts, deletedKeys: [], cursor: tokenResponse.nextChangesToken, cursorExpired: false };
    },
    async recentOrigins(days) {
      await initialized();
      const end = clock.read().instant;
      const timeRangeFilter = { operator: 'between', startTime: daysBefore(end, days), endTime: end } as const;
      const workouts = (await readAll('workout', timeRangeFilter)).map(normalizeWorkout);
      const weights = (await readAll('weight', timeRangeFilter)).map(normalizeWeight);
      return tallyOrigins([...workouts, ...weights].filter((record) => record !== null));
    },
    // Hintergrund-Import (Bonus) mit Feature-Check und Task liefert #199; bis dahin importiert Android im Vordergrund.
    backgroundCapability: () => Promise.resolve('nicht_verfuegbar'),
    registerBackground: () => {},
  };
}

function accessOf(permissions: readonly GrantedPermission[], none: HealthAccessState): HealthAccessState {
  const ours = permissions.some((permission) => readPermissions.some((read) => read.accessType === permission.accessType && read.recordType === permission.recordType));
  return ours ? 'erteilt' : none;
}

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

// Normalisierung ------------------------------------------------------------------------------------------

type Metadata = Readonly<{ id?: string | null; dataOrigin?: string | null }>;
type ZoneOffsetResult = Readonly<{ totalSeconds: number }> | null | undefined;

/** Ein Training; die Dauer ist Ende minus Beginn der Sitzung. Aktive Kalorien schreibt Google Health nicht nach Health Connect. */
function normalizeWorkout(record: RecordResult<'ExerciseSession'>): HealthWorkoutRecord | null {
  const base = baseOf(record.metadata);
  const startedAt = instantOf(record.startTime);
  const endedAt = instantOf(record.endTime);
  if (base === null || startedAt === null || endedAt === null) return null;
  return {
    type: 'workout',
    ...base,
    startedAt,
    endedAt,
    durationSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000,
    platformActivityType: typeof record.exerciseType === 'number' ? record.exerciseType : null,
    activeMilliKcal: null,
    utcOffsetMinutes: offsetOf(record.startZoneOffset),
  };
}

/** Ein Gewicht in ganzen g mit Messzeitpunkt und Offset des Datensatzes. */
function normalizeWeight(record: RecordResult<'Weight'>): HealthWeightRecord | null {
  const base = baseOf(record.metadata);
  const measuredAt = instantOf(record.time);
  const grams = (record.weight as { inGrams?: unknown } | undefined)?.inGrams;
  if (base === null || measuredAt === null || typeof grams !== 'number' || !Number.isFinite(grams)) return null;
  return { type: 'weight', ...base, measuredAt, weightG: Math.round(grams), utcOffsetMinutes: offsetOf(record.zoneOffset) };
}

/** Externer Schlüssel aus `metadata.id`, Quell-App als Paketkennung; einen Anzeigenamen liefert Health Connect nicht. */
function baseOf(metadata: Metadata | undefined) {
  const id = metadata?.id;
  const origin = metadata?.dataOrigin;
  if (typeof id !== 'string' || id === '' || typeof origin !== 'string' || origin === '') return null;
  return { externalKey: id, sourceApp: { id: origin, name: null } };
}

function offsetOf(offset: ZoneOffsetResult): number | null {
  return offset == null || typeof offset.totalSeconds !== 'number' ? null : offset.totalSeconds / 60;
}

/**
 * Zeitpunkt aus `java.time.Instant.toString()`: UTC mit 0, 3, 6 oder 9 Nachkommastellen. Gekürzt auf
 * Millisekunden wie jeder `Instant` der App; anderes ist unlesbar.
 */
function instantOf(value: unknown): Instant | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (match === null) return null;
  const parsed = Instant.safeParse(`${match[1]}.${(match[2] ?? '').padEnd(3, '0').slice(0, 3)}Z`);
  return parsed.success && !Number.isNaN(Date.parse(parsed.data)) ? parsed.data : null;
}
