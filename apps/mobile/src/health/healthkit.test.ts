/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createHealthKitPlatform, type HealthKitClient } from './healthkit';

// Nachweis für #193: der HealthKit-Adapter über das Interface des Health-Plattform-Adapters
// (Spezifikation 3, Abschnitt 6). Die Bibliothek ersetzt eine Attrappe des Clients mit Datensätzen in der
// Form, die `@kingstinct/react-native-healthkit` 16.2.0 aus Swift an JS gibt (`WorkoutProxy.swift`,
// `serializeQuantitySample`, `serializeDeletedSample` in `Serializers.swift`): Datumswerte als `Date`,
// Dauer in `s`, Energie in `kcal`, Gewicht in der angefragten Einheit `g`.

const now = Instant.parse('2026-11-19T12:00:00.000Z');
const clock = createTestClock({ instant: now, timeZone: TimeZone.parse('Europe/Berlin') });

// Aufgezeichnete Beispieldaten -------------------------------------------------------------------------
// Form wie vom Gerät (Spike `spikes/health-hintergrund`, Inventur vom 14.10.2026); Werte synthetisch,
// damit keine echten Gesundheitsdaten im Repo liegen.

type Workout = Awaited<ReturnType<HealthKitClient['queryWorkoutSamplesWithAnchor']>>['workouts'][number];
type WeightSample = Awaited<ReturnType<HealthKitClient['queryQuantitySamplesWithAnchor']>>['samples'][number];

const googleHealth = { name: 'Google Health', bundleIdentifier: 'com.fitbit.FitbitMobile' };
const sourceRevision = (source = googleHealth) => ({ source, version: '5.05', operatingSystemVersion: '26.1.0', productType: 'iPhone14,6' });
const sense2 = { name: 'Sense 2', manufacturer: 'Google', model: 'Sense 2', hardwareVersion: null, firmwareVersion: null, softwareVersion: null, localIdentifier: null, udiDeviceIdentifier: null };

function workout(fields: {
  uuid: string;
  start: string;
  end: string;
  durationSeconds: number;
  activityType: number;
  kcal?: number;
  timeZone?: string;
  source?: typeof googleHealth;
}): Workout {
  return {
    uuid: fields.uuid,
    sourceRevision: sourceRevision(fields.source),
    device: sense2,
    metadata: fields.timeZone === undefined ? {} : { HKTimeZone: fields.timeZone },
    sampleType: { identifier: 'HKWorkoutTypeIdentifier', allowsRecalibrationForEstimates: false, isMinimumDurationRestricted: false, isMaximumDurationRestricted: false },
    startDate: new Date(fields.start),
    endDate: new Date(fields.end),
    hasUndeterminedDuration: false,
    workoutActivityType: fields.activityType,
    duration: { unit: 's', quantity: fields.durationSeconds },
    ...(fields.kcal === undefined ? {} : { totalEnergyBurned: { unit: 'kcal', quantity: fields.kcal } }),
    totalDistance: { unit: 'meters', quantity: 2400 },
  } as unknown as Workout;
}

function weightSample(fields: { uuid: string; at: string; grams: number; timeZone?: string; source?: typeof googleHealth }): WeightSample {
  return {
    uuid: fields.uuid,
    sourceRevision: sourceRevision(fields.source),
    device: undefined,
    metadata: fields.timeZone === undefined ? {} : { HKTimeZone: fields.timeZone, HKWasUserEntered: false },
    sampleType: { identifier: 'HKQuantityTypeIdentifierBodyMass', allowsRecalibrationForEstimates: false, isMinimumDurationRestricted: false, isMaximumDurationRestricted: false },
    startDate: new Date(fields.at),
    endDate: new Date(fields.at),
    hasUndeterminedDuration: false,
    quantityType: 'HKQuantityTypeIdentifierBodyMass',
    quantity: fields.grams,
    unit: 'g',
  } as unknown as WeightSample;
}

/** Spaziergang mit Fitbit, 32 min 29,5 s, mit Energie und Zeitzone der Quelle (Winterzeit, +01:00). */
const walk = workout({
  uuid: '6A1F2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C01',
  start: '2026-11-18T16:30:00.250Z',
  end: '2026-11-18T17:02:29.750Z',
  durationSeconds: 1949.5,
  activityType: 52,
  kcal: 143.27,
  timeZone: 'Europe/Berlin',
});

/** Krafttraining ohne Energie und ohne Zeitzone. */
const strength = workout({
  uuid: '6A1F2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C02',
  start: '2026-11-19T06:00:00.000Z',
  end: '2026-11-19T06:45:00.000Z',
  durationSeconds: 2700,
  activityType: 50,
});

/** Testtraining ohne Dauer, wie es Google Health überträgt (Spike: 20 s, keine Kalorien). */
const zeroMinutes = workout({
  uuid: '6A1F2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C03',
  start: '2026-11-19T08:00:00.000Z',
  end: '2026-11-19T08:00:20.000Z',
  durationSeconds: 20,
  activityType: 52,
  timeZone: 'Europe/Berlin',
});

/** Waagenwert mit Zeitzone und Bruchteilen von Gramm. */
const scale = weightSample({ uuid: '9B8A7C6D-5E4F-4321-8765-0FEDCBA98701', at: '2026-11-19T06:45:12.500Z', grams: 84_312.6, timeZone: 'Europe/Berlin' });

/** Gewicht einer anderen App ohne Zeitzone; auf Reisen in New York gemessen wäre der Offset anders. */
const otherApp = weightSample({
  uuid: '9B8A7C6D-5E4F-4321-8765-0FEDCBA98702',
  at: '2026-11-10T19:00:00.000Z',
  grams: 85_000,
  source: { name: 'Waage', bundleIdentifier: 'com.example.waage' },
});

const fitbit = { id: 'com.fitbit.FitbitMobile', name: 'Google Health' };

// Attrappe des Clients ----------------------------------------------------------------------------------

type Call = Readonly<{ name: string; args: unknown[] }>;
type AnchorPage<T> = Readonly<{ items: readonly T[]; deleted: readonly string[]; next: string }> | Readonly<{ error: string }>;

type FakeClient = HealthKitClient & {
  available: boolean;
  /** `AuthorizationRequestStatus` von `getRequestStatusForAuthorization`: 1 fragen, 2 schon gefragt. */
  requestStatus: number;
  stored: { workouts: Workout[]; weights: WeightSample[] };
  /** Antwort einer Anker-Abfrage je Anker. */
  workoutPages: Map<string, AnchorPage<Workout>>;
  weightPages: Map<string, AnchorPage<WeightSample>>;
  /** Anker, den eine Abfrage ohne Anker ausgibt. */
  firstAnchors: { workouts: string; weights: string };
  calls: Call[];
};

function inRange(at: Date, date: { startDate?: Date; endDate?: Date } | undefined): boolean {
  return (date?.startDate === undefined || at >= date.startDate) && (date?.endDate === undefined || at <= date.endDate);
}

function fakeClient(): FakeClient {
  const client: FakeClient = {
    available: true,
    requestStatus: 1,
    stored: { workouts: [], weights: [] },
    workoutPages: new Map(),
    weightPages: new Map(),
    firstAnchors: { workouts: 'anker-workout-0', weights: 'anker-weight-0' },
    calls: [],
    isHealthDataAvailable() {
      client.calls.push({ name: 'isHealthDataAvailable', args: [] });
      return client.available;
    },
    requestAuthorization(request) {
      client.calls.push({ name: 'requestAuthorization', args: [request] });
      client.requestStatus = 2;
      return Promise.resolve(true);
    },
    getRequestStatusForAuthorization(request) {
      client.calls.push({ name: 'getRequestStatusForAuthorization', args: [request] });
      return Promise.resolve(client.requestStatus as never);
    },
    queryWorkoutSamplesWithAnchor(options) {
      client.calls.push({ name: 'queryWorkoutSamplesWithAnchor', args: [options] });
      if (options.anchor === undefined) {
        const workouts = client.stored.workouts.filter((item) => inRange(item.startDate, options.filter?.date));
        return Promise.resolve({ workouts, deletedSamples: [], newAnchor: client.firstAnchors.workouts });
      }
      const page = client.workoutPages.get(options.anchor);
      if (page === undefined || 'error' in page) return Promise.reject(new Error(page?.error ?? 'unbekannter Anker im Test'));
      return Promise.resolve({ workouts: page.items, deletedSamples: page.deleted.map((uuid) => ({ uuid })), newAnchor: page.next });
    },
    queryQuantitySamplesWithAnchor(identifier, options) {
      client.calls.push({ name: 'queryQuantitySamplesWithAnchor', args: [identifier, options] });
      if (options.anchor === undefined) {
        const samples = client.stored.weights.filter((item) => inRange(item.startDate, options.filter?.date));
        return Promise.resolve({ samples, deletedSamples: [], newAnchor: client.firstAnchors.weights });
      }
      const page = client.weightPages.get(options.anchor);
      if (page === undefined || 'error' in page) return Promise.reject(new Error(page?.error ?? 'unbekannter Anker im Test'));
      return Promise.resolve({ samples: page.items, deletedSamples: page.deleted.map((uuid) => ({ uuid })), newAnchor: page.next });
    },
    queryWorkoutSamples(options) {
      client.calls.push({ name: 'queryWorkoutSamples', args: [options] });
      return Promise.resolve(client.stored.workouts.filter((item) => inRange(item.startDate, options.filter?.date)));
    },
    queryQuantitySamples(identifier, options) {
      client.calls.push({ name: 'queryQuantitySamples', args: [identifier, options] });
      return Promise.resolve(client.stored.weights.filter((item) => inRange(item.startDate, options.filter?.date)));
    },
  };
  return client;
}

const callsNamed = (client: FakeClient, name: string) => client.calls.filter((call) => call.name === name);

// Tests -------------------------------------------------------------------------------------------------

describe('Verfügbarkeit', () => {
  test.each([
    [true, 'verfuegbar'],
    [false, 'nicht_verfuegbar'],
  ] as const)('isHealthDataAvailable %s ergibt %s', async (available, expected) => {
    const client = fakeClient();
    client.available = available;
    expect(await createHealthKitPlatform({ client, clock }).availability()).toBe(expected);
  });

  test('die Herkunft ist apple_health', () => {
    expect(createHealthKitPlatform({ client: fakeClient(), clock }).origin).toBe('apple_health');
  });
});

describe('Lesezugriff', () => {
  test('fragt ausschließlich Lesen von Trainings und Körpergewicht an, ohne Schreiben', async () => {
    const client = fakeClient();
    const platform = createHealthKitPlatform({ client, clock });

    expect(await platform.requestReadAccess()).toBe('angefragt');
    expect(callsNamed(client, 'requestAuthorization')).toEqual([
      { name: 'requestAuthorization', args: [{ toRead: ['HKWorkoutTypeIdentifier', 'HKQuantityTypeIdentifierBodyMass'] }] },
    ]);
  });

  test('der Zugriffsstand bleibt neutral: nie erteilt oder verweigert, weil iOS eine Verweigerung nicht erkennen lässt', async () => {
    const client = fakeClient();
    const platform = createHealthKitPlatform({ client, clock });

    expect(await platform.accessState()).toBe('nicht_angefragt');
    await platform.requestReadAccess();
    expect(await platform.accessState()).toBe('angefragt');
    expect(callsNamed(client, 'getRequestStatusForAuthorization')[0]?.args).toEqual([{ toRead: ['HKWorkoutTypeIdentifier', 'HKQuantityTypeIdentifierBodyMass'] }]);
  });

  test('ohne HealthKit gilt der Zugriff als nicht angefragt, ohne HealthKit zu fragen', async () => {
    const client = fakeClient();
    client.available = false;

    expect(await createHealthKitPlatform({ client, clock }).accessState()).toBe('nicht_angefragt');
    expect(callsNamed(client, 'getRequestStatusForAuthorization')).toEqual([]);
  });
});

describe('Erste Abfrage ohne Anker', () => {
  test('begrenzt den Zeitraum ab since und liefert den ersten Anker', async () => {
    const client = fakeClient();
    client.stored.workouts = [walk, strength];
    const platform = createHealthKitPlatform({ client, clock });
    const since = Instant.parse('2026-11-19T00:00:00.000Z');

    const changes = await platform.readChanges('workout', null, since);

    expect(changes.upserts.map((record) => record.externalKey)).toEqual([strength.uuid]);
    expect(changes).toMatchObject({ deletedKeys: [], cursor: 'anker-workout-0', cursorExpired: false });
    const [query] = callsNamed(client, 'queryWorkoutSamplesWithAnchor');
    expect(query?.args).toEqual([{ limit: 0, filter: { date: { startDate: new Date(since) } } }]);
  });

  test('Gewicht in g, ebenfalls begrenzt', async () => {
    const client = fakeClient();
    client.stored.weights = [scale, otherApp];
    const platform = createHealthKitPlatform({ client, clock });
    const since = Instant.parse('2026-10-20T12:00:00.000Z');

    const changes = await platform.readChanges('weight', null, since);

    expect(changes.upserts.map((record) => record.externalKey)).toEqual([scale.uuid, otherApp.uuid]);
    expect(changes.cursor).toBe('anker-weight-0');
    expect(callsNamed(client, 'queryQuantitySamplesWithAnchor')[0]?.args).toEqual([
      'HKQuantityTypeIdentifierBodyMass',
      { limit: 0, unit: 'g', filter: { date: { startDate: new Date(since) } } },
    ]);
  });
});

describe('Änderungen mit Anker', () => {
  test('liefert neue und gelöschte Objekte seit dem gespeicherten Anker und den neuen Anker', async () => {
    const client = fakeClient();
    client.workoutPages.set('anker-workout-0', { items: [walk, zeroMinutes], deleted: [strength.uuid], next: 'anker-workout-1' });
    const platform = createHealthKitPlatform({ client, clock });

    const changes = await platform.readChanges('workout', 'anker-workout-0', Instant.parse('2026-11-01T00:00:00.000Z'));

    expect(changes.upserts.map((record) => record.externalKey)).toEqual([walk.uuid, zeroMinutes.uuid]);
    expect(changes).toMatchObject({ deletedKeys: [strength.uuid], cursor: 'anker-workout-1', cursorExpired: false });
    // Mit Anker begrenzt kein Zeitraum: auch nachgetragene ältere Trainings kommen an.
    expect(callsNamed(client, 'queryWorkoutSamplesWithAnchor')[0]?.args).toEqual([{ limit: 0, anchor: 'anker-workout-0' }]);
  });

  test('Löschungen beim Gewicht', async () => {
    const client = fakeClient();
    client.weightPages.set('anker-weight-0', { items: [], deleted: [scale.uuid], next: 'anker-weight-1' });
    const platform = createHealthKitPlatform({ client, clock });

    const changes = await platform.readChanges('weight', 'anker-weight-0', now);

    expect(changes).toEqual({ upserts: [], deletedKeys: [scale.uuid], cursor: 'anker-weight-1', cursorExpired: false });
    expect(callsNamed(client, 'queryQuantitySamplesWithAnchor')[0]?.args).toEqual(['HKQuantityTypeIdentifierBodyMass', { limit: 0, unit: 'g', anchor: 'anker-weight-0' }]);
  });

  test('ein nicht lesbarer Anker gilt als verfallen, damit der Dienst den Zeitraum neu liest', async () => {
    const client = fakeClient();
    // Meldung aus `fromBase64` in `Anchors.swift` von @react-native-healthkit/core 16.2.0.
    client.workoutPages.set('kaputt', { error: 'Error recreating HKQueryAnchor object: archive held a different type' });
    client.weightPages.set('kein-base64', { error: 'Invalid base64 string: kein-base64' });
    const platform = createHealthKitPlatform({ client, clock });

    expect(await platform.readChanges('workout', 'kaputt', now)).toEqual({ upserts: [], deletedKeys: [], cursor: null, cursorExpired: true });
    expect(await platform.readChanges('weight', 'kein-base64', now)).toEqual({ upserts: [], deletedKeys: [], cursor: null, cursorExpired: true });
  });

  test('andere Fehler gehen an den Dienst', async () => {
    const client = fakeClient();
    client.workoutPages.set('anker-workout-0', { error: 'Protected health data is inaccessible' });

    await expect(createHealthKitPlatform({ client, clock }).readChanges('workout', 'anker-workout-0', now)).rejects.toThrow('Protected health data is inaccessible');
  });
});

describe('Normalisierung', () => {
  async function upsertsOf<T extends 'workout' | 'weight'>(type: T, items: readonly (Workout | WeightSample)[]) {
    const client = fakeClient();
    if (type === 'workout') client.workoutPages.set('a', { items: items as Workout[], deleted: [], next: 'b' });
    else client.weightPages.set('a', { items: items as WeightSample[], deleted: [], next: 'b' });
    return (await createHealthKitPlatform({ client, clock }).readChanges(type, 'a', now)).upserts;
  }

  test('Workout mit Energie: UUID als Schlüssel, Bundle-Kennung, Dauer des Workouts, Energie in milli_kcal, Offset aus der Zone der Quelle', async () => {
    expect(await upsertsOf('workout', [walk])).toEqual([
      {
        type: 'workout',
        externalKey: walk.uuid,
        sourceApp: fitbit,
        startedAt: '2026-11-18T16:30:00.250Z',
        endedAt: '2026-11-18T17:02:29.750Z',
        durationSeconds: 1949.5,
        platformActivityType: 52,
        activeMilliKcal: 143_270,
        utcOffsetMinutes: 60,
      },
    ]);
  });

  test('Workout ohne Energie und ohne Zone: keine Kalorien, Offset der Gerätezone gilt im Dienst', async () => {
    expect(await upsertsOf('workout', [strength])).toEqual([
      {
        type: 'workout',
        externalKey: strength.uuid,
        sourceApp: fitbit,
        startedAt: '2026-11-19T06:00:00.000Z',
        endedAt: '2026-11-19T06:45:00.000Z',
        durationSeconds: 2700,
        platformActivityType: 50,
        activeMilliKcal: null,
        utcOffsetMinutes: null,
      },
    ]);
  });

  test('0-Minuten-Training kommt mit seiner Dauer an; die Mindestdauer prüfen die Tracker-Regeln', async () => {
    const [record] = await upsertsOf('workout', [zeroMinutes]);
    expect(record).toMatchObject({ type: 'workout', durationSeconds: 20, activeMilliKcal: null, utcOffsetMinutes: 60 });
  });

  test('die Dauer ist die des Workouts, nicht Ende minus Beginn (Pausen zählen nicht)', async () => {
    const paused = workout({ uuid: 'P', start: '2026-11-19T07:00:00.000Z', end: '2026-11-19T08:00:00.000Z', durationSeconds: 2400, activityType: 37 });
    const [record] = await upsertsOf('workout', [paused]);
    expect(record).toMatchObject({ durationSeconds: 2400 });
  });

  test('Gewicht in ganzen g mit Messzeitpunkt, Quell-App und Offset', async () => {
    expect(await upsertsOf('weight', [scale, otherApp])).toEqual([
      { type: 'weight', externalKey: scale.uuid, sourceApp: fitbit, measuredAt: '2026-11-19T06:45:12.500Z', weightG: 84_313, utcOffsetMinutes: 60 },
      { type: 'weight', externalKey: otherApp.uuid, sourceApp: { id: 'com.example.waage', name: 'Waage' }, measuredAt: '2026-11-10T19:00:00.000Z', weightG: 85_000, utcOffsetMinutes: null },
    ]);
  });

  test('der Offset folgt der Zone der Quelle zum Zeitpunkt, auch über die Sommerzeit', async () => {
    const summer = weightSample({ uuid: 'S', at: '2026-07-01T05:00:00.000Z', grams: 86_000, timeZone: 'Europe/Berlin' });
    const travel = weightSample({ uuid: 'T', at: '2026-11-15T12:00:00.000Z', grams: 85_500, timeZone: 'America/New_York' });
    const unknownZone = weightSample({ uuid: 'U', at: '2026-11-15T12:00:00.000Z', grams: 85_500, timeZone: 'Mars/Olympus' });

    expect((await upsertsOf('weight', [summer, travel, unknownZone])).map((record) => record.utcOffsetMinutes)).toEqual([120, -300, null]);
  });

  test('unbrauchbare Datensätze fallen weg: Gewicht ohne Wert in g, Training mit ungültigem Datum', async () => {
    const pounds = { ...scale, uuid: 'L', unit: 'lb', quantity: 185.9 } as unknown as WeightSample;
    const broken = workout({ uuid: 'B', start: 'kaputt', end: 'kaputt', durationSeconds: 60, activityType: 52 });

    expect(await upsertsOf('weight', [pounds])).toEqual([]);
    expect(await upsertsOf('workout', [broken])).toEqual([]);
  });

  test('Energie in einer anderen Einheit als kcal wird nicht geraten', async () => {
    const joules = { ...walk, totalEnergyBurned: { unit: 'kJ', quantity: 600 } } as unknown as Workout;
    const [record] = await upsertsOf('workout', [joules]);
    expect(record).toMatchObject({ activeMilliKcal: null });
  });
});

describe('Quell-Apps', () => {
  test('liefert die Quell-Apps von Trainings und Gewichten der letzten Tage mit ihren Zahlen', async () => {
    const client = fakeClient();
    const old = workout({ uuid: 'ALT', start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:30:00.000Z', durationSeconds: 1800, activityType: 52 });
    client.stored.workouts = [walk, strength, zeroMinutes, old];
    client.stored.weights = [scale, otherApp];
    const platform = createHealthKitPlatform({ client, clock });

    expect(await platform.recentOrigins(30)).toEqual([
      { sourceApp: fitbit, workouts: 3, weights: 1 },
      { sourceApp: { id: 'com.example.waage', name: 'Waage' }, workouts: 0, weights: 1 },
    ]);
    const range = { date: { startDate: new Date('2026-10-20T12:00:00.000Z'), endDate: new Date(now) } };
    expect(callsNamed(client, 'queryWorkoutSamples')[0]?.args).toEqual([{ limit: 0, filter: range }]);
    expect(callsNamed(client, 'queryQuantitySamples')[0]?.args).toEqual(['HKQuantityTypeIdentifierBodyMass', { limit: 0, unit: 'g', filter: range }]);
  });

  test('ohne Daten keine Quell-Apps', async () => {
    expect(await createHealthKitPlatform({ client: fakeClient(), clock }).recentOrigins(30)).toEqual([]);
  });
});

describe('Hintergrund', () => {
  test('bis zum Hintergrund-Import (#197) nicht verfügbar; die Anmeldung tut nichts', async () => {
    const client = fakeClient();
    const platform = createHealthKitPlatform({ client, clock });

    expect(await platform.backgroundCapability()).toBe('nicht_verfuegbar');
    platform.registerBackground(() => Promise.resolve());
    expect(client.calls).toEqual([]);
  });
});
