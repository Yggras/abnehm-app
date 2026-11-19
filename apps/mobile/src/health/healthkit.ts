import { readingOf, type Clock } from '@abnehm/clock';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type {
  AuthorizationRequestStatus,
  QuantitySamplesWithAnchorResponseTyped,
  QuantitySampleTyped,
  QueryWorkoutSamplesWithAnchorResponseTyped,
  WorkoutProxyTyped,
} from '@kingstinct/react-native-healthkit';

import {
  daysBefore,
  type HealthChanges,
  type HealthDataType,
  type HealthOrigin,
  type HealthPlatformAdapter,
  type HealthRecordOf,
  type HealthSourceApp,
  type HealthWeightRecord,
  type HealthWorkoutRecord,
} from './platform';

// HealthKit-Adapter (Spezifikation 3, Abschnitt 6; #193): die iOS-Implementierung des
// Health-Plattform-Adapters mit `@kingstinct/react-native-healthkit`. Bibliothekstypen bleiben in dieser
// Datei; hinaus gehen nur normalisierte Datensätze. Annahmeregeln, Rundung und die Abbildung der
// Aktivitätsarten stehen in den Tracker-Regeln. Geschrieben wird nie: Der Client unten kennt keine
// Schreiboperation, und die App trägt keine Schreib-Nutzungsbeschreibung (`app.config.ts`).

type BodyMass = 'HKQuantityTypeIdentifierBodyMass';
type WeightSample = QuantitySampleTyped<BodyMass>;

/** Optionen einer Abfrage: ohne Grenze (`limit: 0`), optional mit Zeitraum bzw. Anker. */
type QueryOptions = Readonly<{ limit: number; anchor?: string; filter?: { date: { startDate: Date; endDate?: Date } } }>;
/** Gewicht immer in g: HealthKit rechnet die Einheit um (`serializeQuantitySample` mit angefragter Einheit). */
type WeightQueryOptions = QueryOptions & Readonly<{ unit: 'g' }>;
type AccessRequest = Readonly<{ toRead: readonly ('HKWorkoutTypeIdentifier' | BodyMass)[] }>;

/**
 * Die genutzten Funktionen von `@kingstinct/react-native-healthkit` 16.2.0. Im Gerät ist es das Modul
 * selbst (`./device-platform.ts`), in Tests eine Attrappe mit aufgezeichneten Datensätzen.
 */
export type HealthKitClient = Readonly<{
  isHealthDataAvailable(): boolean;
  requestAuthorization(request: AccessRequest): Promise<boolean>;
  getRequestStatusForAuthorization(request: AccessRequest): Promise<AuthorizationRequestStatus>;
  queryWorkoutSamplesWithAnchor(options: QueryOptions): Promise<QueryWorkoutSamplesWithAnchorResponseTyped>;
  queryQuantitySamplesWithAnchor(identifier: BodyMass, options: WeightQueryOptions): Promise<QuantitySamplesWithAnchorResponseTyped<BodyMass>>;
  queryWorkoutSamples(options: QueryOptions): Promise<readonly WorkoutProxyTyped[]>;
  queryQuantitySamples(identifier: BodyMass, options: WeightQueryOptions): Promise<readonly WeightSample[]>;
}>;

export type HealthKitPlatformOptions = Readonly<{ client: HealthKitClient; clock: Clock }>;

const bodyMass: BodyMass = 'HKQuantityTypeIdentifierBodyMass';

/** Nur Lesen von Trainings und Körpergewicht; Wasser, Schritte, Schlaf und Vitalwerte nie, Schreiben nie. */
const readAccess: AccessRequest = { toRead: ['HKWorkoutTypeIdentifier', bodyMass] };

/**
 * `AuthorizationRequestStatus.unnecessary` der Bibliothek: Die App hat schon gefragt
 * (https://developer.apple.com/documentation/healthkit/hkauthorizationrequeststatus). Der Wert steht hier
 * als Zahl, weil das Enum zur Laufzeit das native Modul lädt.
 */
const alreadyRequested = 2;

/**
 * Meldungen von `fromBase64` (`Anchors.swift` in @react-native-healthkit/core 16.2.0), wenn ein
 * gespeicherter Anker sich nicht mehr lesen lässt. HealthKit-Anker verfallen nicht; ein unlesbarer Anker
 * wird wie ein verfallener Token behandelt, damit der Dienst den Zeitraum neu liest und abgleicht.
 */
const unreadableAnchor = /Invalid base64 string|Error recreating/;

const expiredChanges = { upserts: [], deletedKeys: [], cursor: null, cursorExpired: true } as const;

export function createHealthKitPlatform({ client, clock }: HealthKitPlatformOptions): HealthPlatformAdapter {
  /** Eine Anker-Abfrage eines Typs, normalisiert. */
  async function anchored<T extends HealthDataType>(type: T, options: QueryOptions): Promise<{ upserts: HealthRecordOf<T>[]; deleted: string[]; anchor: string }> {
    if (type === 'workout') {
      const result = await client.queryWorkoutSamplesWithAnchor(options);
      return { upserts: present(result.workouts.map(normalizeWorkout)) as HealthRecordOf<T>[], deleted: uuidsOf(result.deletedSamples), anchor: result.newAnchor };
    }
    const result = await client.queryQuantitySamplesWithAnchor(bodyMass, { ...options, unit: 'g' });
    return { upserts: present(result.samples.map(normalizeWeight)) as HealthRecordOf<T>[], deleted: uuidsOf(result.deletedSamples), anchor: result.newAnchor };
  }

  return {
    origin: 'apple_health',
    // Vor allen anderen Aufrufen (https://developer.apple.com/documentation/healthkit/setting-up-healthkit).
    availability: () => Promise.resolve(client.isHealthDataAvailable() ? 'verfuegbar' : 'nicht_verfuegbar'),
    async requestReadAccess() {
      await client.requestAuthorization(readAccess);
      // Ob Lesezugriff erteilt wurde, verrät iOS nicht
      // (https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).
      return 'angefragt';
    },
    async accessState() {
      if (!client.isHealthDataAvailable()) return 'nicht_angefragt';
      return (await client.getRequestStatusForAuthorization(readAccess)) === alreadyRequested ? 'angefragt' : 'nicht_angefragt';
    },
    async readChanges<T extends HealthDataType>(type: T, cursor: string | null, since: Instant): Promise<HealthChanges<T>> {
      if (cursor === null) {
        // Ohne Anker liefert die Abfrage sonst die gesamte Historie (Spike); der Zeitraum ist immer begrenzt.
        const first = await anchored(type, { limit: 0, filter: { date: { startDate: dateOf(since) } } });
        return { upserts: first.upserts, deletedKeys: [], cursor: first.anchor, cursorExpired: false };
      }
      // Mit Anker: neue und gelöschte Objekte seit dem Anker
      // (https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery,
      // https://developer.apple.com/documentation/healthkit/hkdeletedobject), ohne Zeitraum, damit auch
      // nachgetragene ältere Datensätze ankommen.
      let changes: Awaited<ReturnType<typeof anchored<T>>>;
      try {
        changes = await anchored(type, { limit: 0, anchor: cursor });
      } catch (error) {
        if (error instanceof Error && unreadableAnchor.test(error.message)) return expiredChanges;
        throw error;
      }
      return { upserts: changes.upserts, deletedKeys: changes.deleted, cursor: changes.anchor, cursorExpired: false };
    },
    async recentOrigins(days) {
      const end = clock.read().instant;
      const options = { limit: 0, filter: { date: { startDate: dateOf(daysBefore(end, days)), endDate: dateOf(end) } } };
      const origins = new Map<string, { sourceApp: HealthSourceApp; workouts: number; weights: number }>();
      const count = (sourceApp: HealthSourceApp, field: 'workouts' | 'weights') => {
        const entry = origins.get(sourceApp.id) ?? { sourceApp, workouts: 0, weights: 0 };
        entry[field] += 1;
        origins.set(sourceApp.id, entry);
      };
      for (const record of present((await client.queryWorkoutSamples(options)).map(normalizeWorkout))) count(record.sourceApp, 'workouts');
      for (const record of present((await client.queryQuantitySamples(bodyMass, { ...options, unit: 'g' })).map(normalizeWeight))) count(record.sourceApp, 'weights');
      return [...origins.values()] satisfies HealthOrigin[];
    },
    // Hintergrund-Import (Bonus) mit `configureBackgroundTypes` und `subscribeToChanges` liefert #197; bis
    // dahin importiert iOS im Vordergrund.
    backgroundCapability: () => Promise.resolve('nicht_verfuegbar'),
    registerBackground: () => {},
  };
}

function present<T>(records: readonly (T | null)[]): T[] {
  return records.filter((record): record is T => record !== null);
}

function uuidsOf(deleted: readonly { uuid: string }[]): string[] {
  return deleted.map((sample) => sample.uuid);
}

function dateOf(instant: Instant): Date {
  return new Date(Date.parse(instant));
}

// Normalisierung ------------------------------------------------------------------------------------------

type Sample = Readonly<{ uuid: string; sourceRevision: { source: { name: string; bundleIdentifier: string } }; metadata?: unknown; startDate: Date }>;

/**
 * Ein Training. Die Dauer ist die des Workouts (`HKWorkout.duration`, ohne Pausen), nicht Ende minus
 * Beginn. Die Energie übernimmt der Adapter nur, wenn die Quelle sie mitliefert
 * (https://developer.apple.com/documentation/healthkit/hkworkout/totalenergyburned); die Bibliothek gibt
 * sie in `kcal` aus (`WorkoutProxy.swift`).
 */
function normalizeWorkout(workout: WorkoutProxyTyped): HealthWorkoutRecord | null {
  const base = baseOf(workout);
  const endedAt = instantOf(workout.endDate);
  const duration = workout.duration;
  if (base === null || endedAt === null || duration.unit !== 's' || !Number.isFinite(duration.quantity)) return null;
  const energy = workout.totalEnergyBurned;
  return {
    type: 'workout',
    externalKey: base.externalKey,
    sourceApp: base.sourceApp,
    startedAt: base.at,
    endedAt,
    durationSeconds: duration.quantity,
    platformActivityType: typeof workout.workoutActivityType === 'number' ? workout.workoutActivityType : null,
    activeMilliKcal: energy?.unit === 'kcal' && Number.isFinite(energy.quantity) ? Math.round(energy.quantity * 1000) : null,
    utcOffsetMinutes: base.utcOffsetMinutes,
  };
}

/** Ein Gewicht in ganzen g mit Messzeitpunkt (Beginn des Samples). */
function normalizeWeight(sample: WeightSample): HealthWeightRecord | null {
  const base = baseOf(sample);
  if (base === null || sample.unit !== 'g' || !Number.isFinite(sample.quantity)) return null;
  return {
    type: 'weight',
    externalKey: base.externalKey,
    sourceApp: base.sourceApp,
    measuredAt: base.at,
    weightG: Math.round(sample.quantity),
    utcOffsetMinutes: base.utcOffsetMinutes,
  };
}

/**
 * Externer Schlüssel ist die UUID des Samples, Quell-App die Bundle-Kennung mit dem Namen der Quelle
 * (Fitbit: `com.fitbit.FitbitMobile`, „Google Health“, Spike). Den Offset liefert HealthKit nicht direkt,
 * sondern die IANA-Zone der Quelle in `HKTimeZone`
 * (https://developer.apple.com/documentation/healthkit/hkmetadatakeytimezone); der Offset ist der dieser
 * Zone zum Zeitpunkt des Samples.
 */
function baseOf(sample: Sample) {
  const at = instantOf(sample.startDate);
  const source = sample.sourceRevision.source;
  if (sample.uuid === '' || source.bundleIdentifier === '' || at === null) return null;
  return {
    externalKey: sample.uuid,
    sourceApp: { id: source.bundleIdentifier, name: source.name === '' ? null : source.name },
    at,
    utcOffsetMinutes: offsetAt(at, sample.metadata),
  };
}

function offsetAt(at: Instant, metadata: unknown): number | null {
  const zone = typeof metadata === 'object' && metadata !== null && 'HKTimeZone' in metadata ? metadata.HKTimeZone : undefined;
  const parsed = TimeZone.safeParse(zone);
  return parsed.success ? readingOf(at, parsed.data).utcOffsetMinutes : null;
}

function instantOf(date: Date): Instant | null {
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : Instant.parse(date.toISOString());
}
