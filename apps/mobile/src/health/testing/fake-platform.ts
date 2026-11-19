import type { Clock } from '@abnehm/clock';
import { Instant } from '@abnehm/contracts/base';
import type { ImportOrigin } from '@abnehm/contracts/trackers';

import type {
  HealthAccessState,
  HealthAvailability,
  HealthBackgroundCapability,
  HealthBackgroundHandler,
  HealthChanges,
  HealthDataType,
  HealthOrigin,
  HealthPlatformAdapter,
  HealthRecord,
  HealthRecordOf,
  HealthWeightRecord,
  HealthWorkoutRecord,
} from '../platform';
import { daysBefore } from '../platform';

// Health-Attrappe (Spezifikation 3, Abschnitte 2 und 9; #183): deterministisch steuerbare Implementierung
// des Health-Plattform-Adapters. Es gibt sie nur in Tests, im Development- und im E2E-Build; registriert ist
// sie als Testfähigkeit `health-attrappe` (`test/test-capabilities.ts`). Sie hält Datensätze je Typ und ein
// Änderungsprotokoll; der Cursor ist die laufende Nummer des Protokolls. Zufall, Uhrzeit des Systems oder
// Netz gibt es nicht: Zeitpunkte relativ zu „jetzt“ kommen aus der übergebenen Uhr.

/** Kennzeichnet die Attrappe; der Release-Test sucht ihn im Produktions-Bundle (Testfähigkeit `health-attrappe`). */
export const healthFakeMarker = 'health_attrappe';

/** Kennung von Google Health (Fitbit) als Quell-App (Spezifikation 3, Abschnitt 6). */
export const fitbitApp = { id: 'com.fitbit.FitbitMobile', name: null } as const;

type Change = Readonly<{ sequence: number; type: HealthDataType; externalKey: string }>;

export type FakeHealthPlatform = HealthPlatformAdapter &
  Readonly<{
    marker: typeof healthFakeMarker;
    /** Legt Datensätze an oder ändert sie; jede Änderung steht im Protokoll. */
    put(...records: readonly HealthRecord[]): void;
    /** Löscht Datensätze in der Quelle. */
    remove(type: HealthDataType, ...externalKeys: readonly string[]): void;
    /** Lässt alle bisher ausgegebenen Cursor verfallen. */
    expireCursors(): void;
    setAvailability(availability: HealthAvailability): void;
    /** Ergebnis der nächsten Anfragen von `requestReadAccess`, und ab sofort auch von `accessState`, wenn schon angefragt. */
    setAccess(access: HealthAccessState): void;
    setBackgroundCapability(capability: HealthBackgroundCapability): void;
    /**
     * Hält alle folgenden Abfragen von `readChanges` an, bis die Rückgabe aufgerufen wird. So prüfen Tests
     * gleichzeitige Auslöser deterministisch.
     */
    holdReads(): () => void;
    /** Ruft den angemeldeten Hintergrund-Handler auf; ohne Handler geschieht nichts. */
    wake(): Promise<void>;
    /** Jede Abfrage von `readChanges` in Reihenfolge. */
    reads: { type: HealthDataType; cursor: string | null; since: Instant }[];
    /** Alle aktuellen Datensätze eines Typs. */
    records(type: HealthDataType): HealthRecord[];
    /** Entfernt alle Datensätze und das Protokoll, lässt alle Cursor verfallen und macht Health verfügbar; der Zugriff bleibt. */
    reset(): void;
  }>;

export type FakeHealthPlatformOptions = Readonly<{ origin: ImportOrigin; clock: Clock }>;

export function createFakeHealthPlatform({ origin, clock }: FakeHealthPlatformOptions): FakeHealthPlatform {
  let records = new Map<string, HealthRecord>();
  let changes: Change[] = [];
  let sequence = 0;
  /** Cursor sind `<Generation>:<Nummer>`; Cursor einer früheren Generation sind verfallen. */
  let generation = 1;
  let availability: HealthAvailability = 'verfuegbar';
  let grant: HealthAccessState = 'erteilt';
  let access: HealthAccessState = 'nicht_angefragt';
  let background: HealthBackgroundCapability = 'verfuegbar';
  let handler: HealthBackgroundHandler | null = null;
  let held: Promise<void> | null = null;
  const reads: FakeHealthPlatform['reads'] = [];

  const keyOf = (type: HealthDataType, externalKey: string) => `${type}:${externalKey}`;
  const atOf = (record: HealthRecord) => (record.type === 'workout' ? record.startedAt : record.measuredAt);

  function log(type: HealthDataType, externalKey: string) {
    sequence += 1;
    changes.push({ sequence, type, externalKey });
  }

  return {
    origin,
    marker: healthFakeMarker,
    availability: () => Promise.resolve(availability),
    requestReadAccess() {
      if (availability === 'verfuegbar') access = grant;
      return Promise.resolve(access);
    },
    accessState: () => Promise.resolve(access),
    async readChanges<T extends HealthDataType>(type: T, cursor: string | null, since: Instant): Promise<HealthChanges<T>> {
      reads.push({ type, cursor, since });
      if (held !== null) await held;
      const ofType = (record: HealthRecord): record is HealthRecordOf<T> => record.type === type;
      const next = `${generation}:${sequence}`;
      if (cursor === null) {
        const upserts = [...records.values()].filter(ofType).filter((record) => Date.parse(atOf(record)) >= Date.parse(since));
        return { upserts, deletedKeys: [], cursor: next, cursorExpired: false };
      }
      const [cursorGeneration, cursorSequence] = cursor.split(':').map(Number);
      if (cursorGeneration !== generation) return { upserts: [], deletedKeys: [], cursor: null, cursorExpired: true };
      const from = cursorSequence ?? 0;
      const touched = [...new Set(changes.filter((change) => change.type === type && change.sequence > from).map((change) => change.externalKey))];
      const upserts: HealthRecordOf<T>[] = [];
      const deletedKeys: string[] = [];
      for (const externalKey of touched) {
        const record = records.get(keyOf(type, externalKey));
        if (record !== undefined && ofType(record)) upserts.push(record);
        else deletedKeys.push(externalKey);
      }
      return { upserts, deletedKeys, cursor: next, cursorExpired: false };
    },
    recentOrigins(days) {
      const since = Date.parse(daysBefore(clock.read().instant, days));
      const origins = new Map<string, { sourceApp: HealthRecord['sourceApp']; workouts: number; weights: number }>();
      for (const record of records.values()) {
        if (Date.parse(atOf(record)) < since) continue;
        const entry = origins.get(record.sourceApp.id) ?? { sourceApp: record.sourceApp, workouts: 0, weights: 0 };
        if (record.type === 'workout') entry.workouts += 1;
        else entry.weights += 1;
        origins.set(record.sourceApp.id, entry);
      }
      return Promise.resolve([...origins.values()] satisfies HealthOrigin[]);
    },
    backgroundCapability: () => Promise.resolve(background),
    registerBackground(next) {
      handler = next;
    },
    put(...next) {
      for (const record of next) {
        records.set(keyOf(record.type, record.externalKey), record);
        log(record.type, record.externalKey);
      }
    },
    remove(type, ...externalKeys) {
      for (const externalKey of externalKeys) {
        records.delete(keyOf(type, externalKey));
        log(type, externalKey);
      }
    },
    expireCursors() {
      generation += 1;
    },
    setAvailability(next) {
      availability = next;
    },
    setAccess(next) {
      grant = next;
      if (access !== 'nicht_angefragt') access = next;
    },
    setBackgroundCapability(next) {
      background = next;
    },
    holdReads() {
      let release = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        held = null;
        release();
      };
    },
    wake: () => handler?.() ?? Promise.resolve(),
    reads,
    records: (type) => [...records.values()].filter((record) => record.type === type),
    reset() {
      // Wie eine neu eingerichtete Quelle: Datensätze und Cursor fallen weg, die erteilte Berechtigung bleibt.
      records = new Map();
      changes = [];
      generation += 1;
      availability = 'verfuegbar';
      background = 'verfuegbar';
    },
  };
}

// Datensätze ------------------------------------------------------------------------------------------

const minuteMs = 60_000;
const dayMs = 86_400_000;

/** Zeitpunkt relativ zu einem anderen, in Minuten. */
export function minutesFrom(at: Instant, minutes: number): Instant {
  return Instant.parse(new Date(Date.parse(at) + minutes * minuteMs).toISOString());
}

/** Ein Training mit Beginn, Dauer und optionalen Feldern; Ende ist Beginn plus Dauer. */
export function fakeWorkout(
  externalKey: string,
  startedAt: Instant,
  durationSeconds: number,
  { platformActivityType = null, activeMilliKcal = null, utcOffsetMinutes = null, sourceApp = fitbitApp }: Partial<Pick<HealthWorkoutRecord, 'platformActivityType' | 'activeMilliKcal' | 'utcOffsetMinutes' | 'sourceApp'>> = {},
): HealthWorkoutRecord {
  const endedAt = Instant.parse(new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString());
  return { type: 'workout', externalKey, sourceApp, startedAt, endedAt, durationSeconds, platformActivityType, activeMilliKcal, utcOffsetMinutes };
}

/** Ein Gewicht in g zum Messzeitpunkt. */
export function fakeWeight(
  externalKey: string,
  measuredAt: Instant,
  weightG: number,
  { utcOffsetMinutes = null, sourceApp = fitbitApp }: Partial<Pick<HealthWeightRecord, 'utcOffsetMinutes' | 'sourceApp'>> = {},
): HealthWeightRecord {
  return { type: 'weight', externalKey, sourceApp, measuredAt, weightG, utcOffsetMinutes };
}

// Szenarien (Spezifikation 3, Abschnitt 9) ------------------------------------------------------------

/**
 * Benannte Szenarien. Erstimport, Änderungen und verfallener Token bauen aufeinander auf: Erst
 * `erstimport`, dann nach dem Verbinden `aenderungen` bzw. `token_verfallen`.
 */
export const healthScenarios = [
  'erstimport',
  'aenderungen',
  'token_verfallen',
  'null_minuten',
  'nicht_verfuegbar',
  'installation_noetig',
  'keine_daten',
  'zwei_weckungen',
  'fitbit_vorhanden',
  'fitbit_fehlt',
  'korrekturen',
  'korrekturen_quelle',
] as const;
export type HealthScenario = (typeof healthScenarios)[number];

/** Andere Quell-Apps als Google Health (Fitbit): Apple Watch über Health und eine Waage. */
const watchApp = { id: 'com.apple.health', name: 'Apple Watch' } as const;
const scaleApp = { id: 'com.withings.wiScaleNG', name: 'Withings' } as const;

/**
 * Stellt die Attrappe auf ein Szenario, relativ zu „jetzt“ der Uhr:
 * - `erstimport`: Gewichte vor 40, 29 und 2 Tagen sowie heute früh, Trainings gestern und heute. Der
 *   Erstimport übernimmt Gewichte der letzten 30 Tage und Sport ab dem Beginn des Verbindungstags.
 * - `aenderungen`: auf `erstimport` aufbauend: das heutige Training wird länger, das heutige Gewicht in der
 *   Quelle gelöscht und ein neues Training kommt hinzu.
 * - `token_verfallen`: alle Cursor verfallen; dazu verschwindet das Training von heute früh in der Quelle.
 * - `null_minuten`: ein Training mit 0 Sekunden, eines mit 89 und eines mit 90 Sekunden.
 * - `nicht_verfuegbar`, `installation_noetig`, `keine_daten`: Verfügbarkeit bzw. eine leere Quelle.
 * - `zwei_weckungen`: Google Health schreibt Training und Gewicht zugleich und weckt zweimal fast gleichzeitig.
 * - `fitbit_vorhanden`, `fitbit_fehlt`: Quell-Apps der letzten 30 Tage mit bzw. ohne Google Health (Fitbit).
 * - `korrekturen` (#186): heute eine automatisch erkannte Fehlaufnahme (12 min Gehen), ein als Radfahren erkanntes
 *   Training und ein Waagenwert. Die Person blendet danach die Fehlaufnahme aus und ändert die Art des zweiten.
 * - `korrekturen_quelle`: auf `korrekturen` aufbauend ändert die Quelle alle drei Datensätze (Upsert): andere
 *   Dauern bzw. Gramm, das zweite Training mit anderer Plattformart. Ausblendung und überschriebene Art bleiben.
 */
export async function applyHealthScenario(fake: FakeHealthPlatform, scenario: HealthScenario, clock: Clock): Promise<void> {
  const now = clock.read().instant;
  const ago = (days: number, minutes = 0) => minutesFrom(now, -days * (dayMs / minuteMs) + minutes);
  switch (scenario) {
    case 'erstimport':
      fake.reset();
      fake.put(
        fakeWeight('gewicht-40-tage', ago(40), 84_100),
        fakeWeight('gewicht-29-tage', ago(29), 83_650),
        fakeWeight('gewicht-2-tage', ago(2), 82_840),
        fakeWeight('gewicht-heute', minutesFrom(now, -240), 82_437),
        fakeWorkout('training-gestern', ago(1), 45 * 60, { platformActivityType: 37 }),
        fakeWorkout('training-heute', minutesFrom(now, -180), 32 * 60 + 30, { platformActivityType: 52, activeMilliKcal: 154_000 }),
      );
      return;
    case 'aenderungen': {
      const today = fake.records('workout').find((record) => record.externalKey === 'training-heute');
      if (today?.type === 'workout') fake.put(fakeWorkout(today.externalKey, today.startedAt, 41 * 60, { platformActivityType: today.platformActivityType }));
      fake.remove('weight', 'gewicht-heute');
      fake.put(fakeWorkout('training-neu', minutesFrom(now, -60), 20 * 60, { platformActivityType: 13 }));
      return;
    }
    case 'token_verfallen':
      fake.remove('workout', 'training-heute');
      fake.expireCursors();
      return;
    case 'null_minuten':
      fake.reset();
      fake.put(
        fakeWorkout('training-0-sekunden', minutesFrom(now, -90), 0),
        fakeWorkout('training-89-sekunden', minutesFrom(now, -60), 89),
        fakeWorkout('training-90-sekunden', minutesFrom(now, -30), 90),
      );
      return;
    case 'nicht_verfuegbar':
      fake.reset();
      fake.setAvailability('nicht_verfuegbar');
      return;
    case 'installation_noetig':
      fake.reset();
      fake.setAvailability('installation_noetig');
      return;
    case 'keine_daten':
      fake.reset();
      return;
    case 'zwei_weckungen':
      fake.put(fakeWorkout('training-weckung', minutesFrom(now, -40), 30 * 60, { platformActivityType: 37 }), fakeWeight('gewicht-weckung', minutesFrom(now, -5), 82_300));
      await Promise.all([fake.wake(), fake.wake()]);
      return;
    case 'fitbit_vorhanden':
      fake.reset();
      fake.put(fakeWorkout('training-fitbit', ago(3), 30 * 60, { platformActivityType: 37 }), fakeWeight('gewicht-waage', ago(1), 82_500, { sourceApp: scaleApp }));
      return;
    case 'fitbit_fehlt':
      fake.reset();
      fake.put(fakeWorkout('training-uhr', ago(3), 30 * 60, { platformActivityType: 37, sourceApp: watchApp }), fakeWeight('gewicht-waage', ago(1), 82_500, { sourceApp: scaleApp }));
      return;
    case 'korrekturen':
      fake.reset();
      fake.put(
        fakeWorkout('training-fehlaufnahme', minutesFrom(now, -150), 12 * 60, { platformActivityType: 52 }),
        fakeWorkout('training-falsch-erkannt', minutesFrom(now, -90), 45 * 60, { platformActivityType: 13, activeMilliKcal: 380_000 }),
        fakeWeight('gewicht-korrektur', minutesFrom(now, -300), 82_437, { sourceApp: scaleApp }),
      );
      return;
    case 'korrekturen_quelle':
      // Dieselben Datensätze mit ihren Zeitpunkten, aber neuen Werten aus der Quelle.
      for (const record of [...fake.records('workout'), ...fake.records('weight')]) {
        if (record.type === 'workout' && record.externalKey === 'training-fehlaufnahme') fake.put(fakeWorkout(record.externalKey, record.startedAt, 14 * 60, { ...record }));
        if (record.type === 'workout' && record.externalKey === 'training-falsch-erkannt') {
          fake.put(fakeWorkout(record.externalKey, record.startedAt, 48 * 60, { ...record, platformActivityType: 37 }));
        }
        if (record.type === 'weight' && record.externalKey === 'gewicht-korrektur') fake.put({ ...record, weightG: 82_512 });
      }
  }
}
