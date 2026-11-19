/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type { GetChangesRequest, GetChangesResults, ReadRecordsOptions, RecordResult } from 'react-native-health-connect';

import { createHealthConnectPlatform, type HealthConnectClient } from './health-connect';

// Nachweis für #195: der Health-Connect-Adapter über das Interface des Health-Plattform-Adapters
// (Spezifikation 3, Abschnitt 6). Die Bibliothek ersetzt eine Attrappe des Clients mit Datensätzen in der
// Form, die `react-native-health-connect` 4.1.3 aus Kotlin an JS gibt (`ReactExerciseSessionRecord`,
// `ReactWeightRecord`, `convertMetadataToJSMap`, `zoneOffsetToJsMap`).

const now = Instant.parse('2026-11-19T12:00:00.000Z');
const clock = createTestClock({ instant: now, timeZone: TimeZone.parse('Europe/Berlin') });

// Aufgezeichnete Beispieldaten -------------------------------------------------------------------------
// Form wie vom Gerät; Werte synthetisch, damit keine echten Gesundheitsdaten im Repo liegen.

type ExerciseResult = RecordResult<'ExerciseSession'>;
type WeightResult = RecordResult<'Weight'>;

const fitbitMetadata = (id: string, lastModifiedTime: string) => ({
  id,
  clientRecordId: null,
  clientRecordVersion: 0,
  dataOrigin: 'com.fitbit.FitbitMobile',
  lastModifiedTime,
  device: { manufacturer: 'Google', model: 'Charge 6', type: 6 },
  recordingMethod: 1,
  manufacturer: 'Google',
  model: 'Charge 6',
});

/** Spaziergang mit Fitbit, 32 min 29,5 s; Kotlin gibt Nanosekunden aus, Offset +01:00. */
const walk: ExerciseResult = {
  startTime: '2026-11-18T16:30:00.250Z',
  startZoneOffset: { id: '+01:00', totalSeconds: 3600 },
  endTime: '2026-11-18T17:02:29.750123456Z',
  endZoneOffset: { id: '+01:00', totalSeconds: 3600 },
  notes: null,
  title: null,
  exerciseType: 79,
  laps: [],
  segments: [],
  exerciseRoute: { type: 'NO_DATA', route: [] },
  metadata: fitbitMetadata('0b3c6f2e-6d1e-4c55-9a51-2f2d1b8e7a01', '2026-11-18T17:03:05.120Z'),
} as unknown as ExerciseResult;

/** Testtraining ohne Dauer, wie es Google Health überträgt (Spike); ohne Offset. */
const zeroMinutes: ExerciseResult = {
  startTime: '2026-11-19T08:00:00Z',
  startZoneOffset: null,
  endTime: '2026-11-19T08:00:00Z',
  endZoneOffset: null,
  notes: null,
  title: 'Training',
  exerciseType: 0,
  laps: [],
  segments: [],
  exerciseRoute: { type: 'NO_DATA', route: [] },
  metadata: fitbitMetadata('0b3c6f2e-6d1e-4c55-9a51-2f2d1b8e7a02', '2026-11-19T08:00:40Z'),
} as unknown as ExerciseResult;

const massOf = (grams: number) => ({ inGrams: grams, inKilograms: grams / 1000, inMilligrams: grams * 1000, inMicrograms: grams * 1e6, inOunces: grams / 28.349523125, inPounds: grams / 453.59237 });

/** Waagenwert mit Offset +01:00 und Bruchteilen von Gramm. */
const scale: WeightResult = {
  time: '2026-11-19T06:45:12.500Z',
  zoneOffset: { id: '+01:00', totalSeconds: 3600 },
  weight: massOf(84_312.6),
  metadata: fitbitMetadata('7d0b2c4a-1f7e-4b1e-8d33-9c1a4e5f6a01', '2026-11-19T06:46:00Z'),
} as unknown as WeightResult;

/** Gewicht einer anderen App ohne Offset, Offset in Nachbarzone. */
const otherApp: WeightResult = {
  time: '2026-11-10T19:00:00Z',
  zoneOffset: null,
  weight: massOf(85_000),
  metadata: { ...fitbitMetadata('7d0b2c4a-1f7e-4b1e-8d33-9c1a4e5f6a02', '2026-11-10T19:00:01Z'), dataOrigin: 'com.example.waage' },
} as unknown as WeightResult;

const fitbit = { id: 'com.fitbit.FitbitMobile', name: null };
const idOf = (record: ExerciseResult | WeightResult): string => record.metadata?.id ?? '';

// Attrappe des Clients ----------------------------------------------------------------------------------

type ChangesPage = GetChangesResults | { error: { code: string; message: string } };

type FakeClient = HealthConnectClient & {
  sdkStatus: number;
  granted: { accessType: 'read' | 'write'; recordType: string }[];
  grantOnRequest: { accessType: 'read' | 'write'; recordType: string }[];
  stored: { ExerciseSession: ExerciseResult[]; Weight: WeightResult[] };
  /** Antwort auf `getChanges` je Token. */
  pages: Map<string, ChangesPage>;
  /** Token, den `getChanges` ohne Token für einen Typ neu ausgibt. */
  freshTokens: { ExerciseSession: string; Weight: string };
  pageSize: number;
  calls: string[];
  requested: unknown[];
  reads: { recordType: string; options: ReadRecordsOptions }[];
};

function fakeClient(): FakeClient {
  const client: FakeClient = {
    sdkStatus: 3,
    granted: [],
    grantOnRequest: [
      { accessType: 'read', recordType: 'ExerciseSession' },
      { accessType: 'read', recordType: 'Weight' },
    ],
    stored: { ExerciseSession: [], Weight: [] },
    pages: new Map(),
    freshTokens: { ExerciseSession: 'token-workout-0', Weight: 'token-weight-0' },
    pageSize: Number.POSITIVE_INFINITY,
    calls: [],
    requested: [],
    reads: [],
    getSdkStatus() {
      client.calls.push('getSdkStatus');
      return Promise.resolve(client.sdkStatus);
    },
    initialize() {
      client.calls.push('initialize');
      return Promise.resolve(true);
    },
    requestPermission(permissions) {
      client.calls.push('requestPermission');
      client.requested.push(permissions);
      client.granted = client.grantOnRequest;
      return Promise.resolve(client.granted as never);
    },
    getGrantedPermissions() {
      client.calls.push('getGrantedPermissions');
      return Promise.resolve(client.granted as never);
    },
    readRecords(recordType, options) {
      client.calls.push(`readRecords:${recordType}`);
      client.reads.push({ recordType, options });
      const filter = options.timeRangeFilter;
      const atOf = (record: ExerciseResult | WeightResult) => Date.parse('time' in record ? record.time : record.startTime);
      const matching = (client.stored[recordType] as (ExerciseResult | WeightResult)[]).filter(
        (record) =>
          (filter.operator === 'before' || atOf(record) >= Date.parse(filter.startTime)) && (filter.operator === 'after' || atOf(record) <= Date.parse(filter.endTime)),
      );
      const offset = Number(options.pageToken ?? '0');
      const records = matching.slice(offset, offset + client.pageSize);
      const next = offset + client.pageSize;
      return Promise.resolve({ records, pageToken: next < matching.length ? String(next) : undefined } as never);
    },
    getChanges(request: GetChangesRequest) {
      if (request.changesToken === undefined) {
        const recordType = request.recordTypes?.[0] as 'ExerciseSession' | 'Weight';
        client.calls.push(`getChangesToken:${request.recordTypes?.join(',')}`);
        return Promise.resolve({ upsertionChanges: [], deletionChanges: [], nextChangesToken: client.freshTokens[recordType], changesTokenExpired: false, hasMore: false });
      }
      client.calls.push(`getChanges:${request.changesToken}`);
      const page = client.pages.get(request.changesToken);
      if (page === undefined) return Promise.reject(Object.assign(new Error('unbekannter Token im Test'), { code: 'ARGUMENT_VALIDATION_ERROR' }));
      if ('error' in page) return Promise.reject(Object.assign(new Error(page.error.message), { code: page.error.code }));
      return Promise.resolve(page);
    },
  };
  return client;
}

const page = (changes: Partial<GetChangesResults> & Pick<GetChangesResults, 'nextChangesToken'>): GetChangesResults => ({
  upsertionChanges: [],
  deletionChanges: [],
  changesTokenExpired: false,
  hasMore: false,
  ...changes,
});
const upsert = (record: ExerciseResult | WeightResult) => ({ record: record as never });

// Tests -------------------------------------------------------------------------------------------------

describe('Verfügbarkeit', () => {
  test.each([
    [3, 'verfuegbar'],
    [2, 'installation_noetig'],
    [1, 'nicht_verfuegbar'],
  ] as const)('getSdkStatus %i ergibt %s', async (status, expected) => {
    const client = fakeClient();
    client.sdkStatus = status;
    expect(await createHealthConnectPlatform({ client, clock }).availability()).toBe(expected);
  });

  test('die Herkunft ist health_connect', () => {
    expect(createHealthConnectPlatform({ client: fakeClient(), clock }).origin).toBe('health_connect');
  });
});

describe('Lesezugriff', () => {
  test('fragt ausschließlich Lesen von Trainings und Gewicht an, ohne Schreiben und ohne ältere Historie', async () => {
    const client = fakeClient();
    const platform = createHealthConnectPlatform({ client, clock });

    expect(await platform.requestReadAccess()).toBe('erteilt');
    expect(client.requested).toEqual([
      [
        { accessType: 'read', recordType: 'ExerciseSession' },
        { accessType: 'read', recordType: 'Weight' },
      ],
    ]);
    // Der Client ist vor der Anfrage initialisiert (sonst `ClientNotInitialized`).
    expect(client.calls.indexOf('initialize')).toBeLessThan(client.calls.indexOf('requestPermission'));
    expect(await platform.accessState()).toBe('erteilt');
  });

  test('ohne erteilte Berechtigung meldet die Anfrage „verweigert“', async () => {
    const client = fakeClient();
    client.grantOnRequest = [];
    expect(await createHealthConnectPlatform({ client, clock }).requestReadAccess()).toBe('verweigert');
  });

  test('eine einzelne erteilte Berechtigung genügt für „erteilt“', async () => {
    const client = fakeClient();
    client.granted = [{ accessType: 'read', recordType: 'Weight' }];
    expect(await createHealthConnectPlatform({ client, clock }).accessState()).toBe('erteilt');
  });

  test('ohne Berechtigung ist der Zugriff nicht angefragt; fremde Berechtigungen zählen nicht', async () => {
    const client = fakeClient();
    client.granted = [{ accessType: 'read', recordType: 'Steps' }];
    expect(await createHealthConnectPlatform({ client, clock }).accessState()).toBe('nicht_angefragt');
  });

  test('ohne verfügbares Health Connect fragt der Adapter den Client gar nicht erst', async () => {
    const client = fakeClient();
    client.sdkStatus = 2;
    const platform = createHealthConnectPlatform({ client, clock });
    expect(await platform.accessState()).toBe('nicht_angefragt');
    expect(client.calls).toEqual(['getSdkStatus']);
  });
});

describe('Erste Abfrage ohne Token', () => {
  test('holt zuerst den Token und liest dann nur Datensätze ab `since`, über alle Seiten', async () => {
    const client = fakeClient();
    client.stored.Weight = [otherApp, scale];
    client.pageSize = 1;
    const platform = createHealthConnectPlatform({ client, clock });
    const since = Instant.parse('2026-10-20T12:00:00.000Z');

    const changes = await platform.readChanges('weight', null, since);

    // Token vor dem Lesen: Was dazwischen geschrieben wird, liefert der nächste Abruf der Änderungen.
    expect(client.calls).toEqual(['initialize', 'getChangesToken:Weight', 'readRecords:Weight', 'readRecords:Weight']);
    expect(client.reads.map((read) => read.options.timeRangeFilter)).toEqual([
      { operator: 'after', startTime: since },
      { operator: 'after', startTime: since },
    ]);
    expect(changes.cursor).toBe('token-weight-0');
    expect(changes.cursorExpired).toBe(false);
    expect(changes.deletedKeys).toEqual([]);
    expect(changes.upserts.map((record) => record.externalKey)).toEqual([idOf(otherApp), idOf(scale)]);
  });

  test('nutzt je Typ einen eigenen Token', async () => {
    const client = fakeClient();
    const platform = createHealthConnectPlatform({ client, clock });
    const workout = await platform.readChanges('workout', null, now);
    expect(client.calls).toContain('getChangesToken:ExerciseSession');
    expect(workout.cursor).toBe('token-workout-0');
  });
});

describe('Änderungen per Token', () => {
  test('ruft getChanges, bis keine weiteren Änderungen vorliegen, und wertet Upserts und Löschungen aus', async () => {
    const client = fakeClient();
    const deletedEarlier = 'aa000000-0000-4000-8000-000000000001';
    client.pages.set('t1', page({ upsertionChanges: [upsert(walk)], deletionChanges: [{ recordId: deletedEarlier }], nextChangesToken: 't2', hasMore: true }));
    client.pages.set('t2', page({ upsertionChanges: [upsert(zeroMinutes)], nextChangesToken: 't3' }));
    const platform = createHealthConnectPlatform({ client, clock });

    const changes = await platform.readChanges('workout', 't1', now);

    expect(client.calls).toEqual(['initialize', 'getChanges:t1', 'getChanges:t2']);
    expect(changes.cursor).toBe('t3');
    expect(changes.cursorExpired).toBe(false);
    expect(changes.upserts.map((record) => record.externalKey)).toEqual([idOf(walk), idOf(zeroMinutes)]);
    expect(changes.deletedKeys).toEqual([deletedEarlier]);
  });

  test('spätere Änderungen desselben Datensatzes gewinnen: erst geändert, dann gelöscht, ergibt eine Löschung', async () => {
    const client = fakeClient();
    client.pages.set('t1', page({ upsertionChanges: [upsert(walk)], nextChangesToken: 't2', hasMore: true }));
    client.pages.set('t2', page({ deletionChanges: [{ recordId: idOf(walk) }], upsertionChanges: [upsert(zeroMinutes)], nextChangesToken: 't3' }));
    client.pages.set('u1', page({ deletionChanges: [{ recordId: idOf(walk) }], nextChangesToken: 'u2', hasMore: true }));
    client.pages.set('u2', page({ upsertionChanges: [upsert(walk)], nextChangesToken: 'u3' }));
    const platform = createHealthConnectPlatform({ client, clock });

    const removed = await platform.readChanges('workout', 't1', now);
    expect(removed.upserts.map((record) => record.externalKey)).toEqual([idOf(zeroMinutes)]);
    expect(removed.deletedKeys).toEqual([idOf(walk)]);

    const restored = await platform.readChanges('workout', 'u1', now);
    expect(restored.upserts.map((record) => record.externalKey)).toEqual([idOf(walk)]);
    expect(restored.deletedKeys).toEqual([]);
  });

  test('ein verfallener Token wird als cursorExpired gemeldet, auch auf einer späteren Seite', async () => {
    const client = fakeClient();
    client.pages.set('alt', page({ nextChangesToken: '', changesTokenExpired: true }));
    client.pages.set('t1', page({ upsertionChanges: [upsert(walk)], nextChangesToken: 't2', hasMore: true }));
    client.pages.set('t2', page({ nextChangesToken: '', changesTokenExpired: true }));
    const platform = createHealthConnectPlatform({ client, clock });

    for (const token of ['alt', 't1']) {
      expect(await platform.readChanges('workout', token, now)).toEqual({ upserts: [], deletedKeys: [], cursor: null, cursorExpired: true });
    }
  });

  test('ein ungültiger Token gilt wie ein verfallener (Android: „invalid or expired Changes tokens“)', async () => {
    const client = fakeClient();
    client.pages.set('kaputt', { error: { code: 'ARGUMENT_VALIDATION_ERROR', message: 'Invalid token' } });
    expect(await createHealthConnectPlatform({ client, clock }).readChanges('weight', 'kaputt', now)).toEqual({
      upserts: [],
      deletedKeys: [],
      cursor: null,
      cursorExpired: true,
    });
  });

  test('andere Fehler, etwa eine entzogene Berechtigung, reicht der Adapter weiter', async () => {
    const client = fakeClient();
    client.pages.set('t1', { error: { code: 'PERMISSION_ERROR', message: 'Caller doesn’t have READ_WEIGHT' } });
    await expect(createHealthConnectPlatform({ client, clock }).readChanges('weight', 't1', now)).rejects.toThrow('READ_WEIGHT');
  });
});

describe('Normalisierung aufgezeichneter Datensätze', () => {
  async function workoutsOf(...records: ExerciseResult[]) {
    const client = fakeClient();
    client.pages.set('t1', page({ upsertionChanges: records.map(upsert), nextChangesToken: 't2' }));
    return (await createHealthConnectPlatform({ client, clock }).readChanges('workout', 't1', now)).upserts;
  }
  async function weightsOf(...records: WeightResult[]) {
    const client = fakeClient();
    client.pages.set('t1', page({ upsertionChanges: records.map(upsert), nextChangesToken: 't2' }));
    return (await createHealthConnectPlatform({ client, clock }).readChanges('weight', 't1', now)).upserts;
  }

  test('Training: Schlüssel aus metadata.id, Paketkennung als Quell-App, Dauer als Ende minus Beginn, keine Kalorien', async () => {
    expect(await workoutsOf(walk)).toEqual([
      {
        type: 'workout',
        externalKey: '0b3c6f2e-6d1e-4c55-9a51-2f2d1b8e7a01',
        sourceApp: fitbit,
        startedAt: '2026-11-18T16:30:00.250Z',
        endedAt: '2026-11-18T17:02:29.750Z',
        durationSeconds: 1949.5,
        platformActivityType: 79,
        activeMilliKcal: null,
        utcOffsetMinutes: 60,
      },
    ]);
  });

  test('Training mit 0 Minuten bleibt ein Datensatz mit Dauer 0; die Annahmeregeln verwerfen es', async () => {
    expect(await workoutsOf(zeroMinutes)).toEqual([
      expect.objectContaining({ externalKey: idOf(zeroMinutes), startedAt: '2026-11-19T08:00:00.000Z', endedAt: '2026-11-19T08:00:00.000Z', durationSeconds: 0, utcOffsetMinutes: null }),
    ]);
  });

  test('Gewicht: ganze Gramm, Messzeitpunkt und Offset des Datensatzes', async () => {
    expect(await weightsOf(scale, otherApp)).toEqual([
      {
        type: 'weight',
        externalKey: '7d0b2c4a-1f7e-4b1e-8d33-9c1a4e5f6a01',
        sourceApp: fitbit,
        measuredAt: '2026-11-19T06:45:12.500Z',
        weightG: 84_313,
        utcOffsetMinutes: 60,
      },
      expect.objectContaining({ externalKey: idOf(otherApp), sourceApp: { id: 'com.example.waage', name: null }, weightG: 85_000, utcOffsetMinutes: null }),
    ]);
  });

  test('Datensätze ohne ID oder mit unlesbarer Zeit überspringt der Adapter', async () => {
    const withoutId = { ...walk, metadata: { ...walk.metadata, id: '' } } as ExerciseResult;
    const badTime = { ...scale, time: 'gestern', metadata: { ...scale.metadata, id: 'x' } } as WeightResult;
    expect(await workoutsOf(withoutId)).toEqual([]);
    expect(await weightsOf(badTime)).toEqual([]);
  });
});

describe('Quell-Apps', () => {
  test('recentOrigins zählt Trainings und Gewichte im Zeitraum je Paketkennung', async () => {
    const client = fakeClient();
    client.stored.ExerciseSession = [walk, zeroMinutes];
    client.stored.Weight = [scale, otherApp];
    const platform = createHealthConnectPlatform({ client, clock });

    const origins = await platform.recentOrigins(7);

    expect(client.reads.map((read) => read.options.timeRangeFilter)).toEqual([
      { operator: 'between', startTime: '2026-11-12T12:00:00.000Z', endTime: now },
      { operator: 'between', startTime: '2026-11-12T12:00:00.000Z', endTime: now },
    ]);
    // Das Gewicht vom 10.11. liegt vor den letzten 7 Tagen.
    expect(origins).toEqual([{ sourceApp: fitbit, workouts: 2, weights: 1 }]);
  });

  test('ohne Daten ist die Liste leer', async () => {
    expect(await createHealthConnectPlatform({ client: fakeClient(), clock }).recentOrigins(30)).toEqual([]);
  });
});

test('der Hintergrund-Import kommt erst mit #199', async () => {
  expect(await createHealthConnectPlatform({ client: fakeClient(), clock }).backgroundCapability()).toBe('nicht_verfuegbar');
});
