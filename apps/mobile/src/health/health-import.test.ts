/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { importedSportEntryId, importedWeightEntryId } from '@abnehm/contracts/trackers';

import { fakeAreaPorts, fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { insertDailyGoalForTest } from '../daily-goals/testing/persisted';
import { readDeviceState } from '../local-db/device-state';
import { dailyGoalCompletion, sportEntry, weightEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createTodayRegistry, type TodayState } from '../shell/today-registry';
import { trackerDailyGoals } from '../trackers';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld, type TrackerWorldOptions } from '../trackers/testing/tracker-world';
import { createHealthImport, type HealthImport } from '.';
import { applyHealthScenario, createFakeHealthPlatform, fakeWeight, fakeWorkout, fitbitApp, minutesFrom, type FakeHealthPlatform } from './testing/fake-platform';

// Nachweis für #183: der Health-Import-Dienst über den internen Importbefehl des Tracker-Moduls
// (Spezifikation 3, Abschnitte 2, 3 und 6) gegen eine echte SQLite-Datei mit denselben Migrationen wie die
// App, gesteuert über die Testuhr und die Health-Attrappe. Die deterministischen IDs über zwei Geräte prüft
// `apps/backend/test/health-import-sync-app.test.ts` gegen die echte Hono-App.

type HealthWorld = TrackerWorld & { clock: TestClock; fake: FakeHealthPlatform; health: HealthImport; errors: unknown[] };

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

async function healthWorld({ at = noon, bausteine }: { at?: Instant } & Pick<TrackerWorldOptions, 'bausteine'> = {}): Promise<HealthWorld> {
  const clock = createTestClock({ instant: at, timeZone: berlin });
  const world = await createTrackerWorld(clock, { bausteine });
  worlds.push(world);
  const fake = createFakeHealthPlatform({ origin: 'apple_health', clock });
  const errors: unknown[] = [];
  const health = createHealthImport({ database: world.database, platform: fake, trackers: world.trackers, clock, onError: (error) => errors.push(error) });
  return { ...world, clock, fake, health, errors };
}

/** Verbindet und wartet, bis der direkt danach gestartete Import fertig ist. */
async function connected(world: HealthWorld) {
  expect(await world.health.connect()).toEqual({ type: 'verbunden', access: 'erteilt' });
  await world.health.idle();
}

const imports = (world: TrackerWorld) => ({
  sports: world.sports().filter((row) => row.origin !== 'manuell'),
  weights: world.weights().filter((row) => row.origin !== 'manuell'),
});
const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((row) => row.deletedAt === null);
const byKey = <T extends { externalKey: string | null }>(rows: T[], key: string) => rows.find((row) => row.externalKey === key);
const daysAgo = (days: number) => minutesFrom(noon, -days * 24 * 60);

describe('Verbinden', () => {
  it('merkt sich Verbindungstag und Zeiträume und importiert direkt danach', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);

    await connected(world);

    expect(world.health.connection()).toEqual({
      connectedAt: noon,
      connectedOn: '2026-10-14',
      // Beginn des 14.10. in Berlin (Sommerzeit, UTC+2).
      workoutsSince: '2026-10-13T22:00:00.000Z',
      weightsSince: daysAgo(30),
      lastImportAt: noon,
    });
    expect(world.fake.reads.length).toBeGreaterThan(0);
  });

  it('meldet „nicht verfügbar“ und „Installation nötig“, ohne eine Verbindung zu merken oder etwas zu lesen', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'nicht_verfuegbar', world.clock);
    expect(await world.health.connect()).toEqual({ type: 'nicht_verfuegbar' });
    await applyHealthScenario(world.fake, 'installation_noetig', world.clock);
    expect(await world.health.connect()).toEqual({ type: 'installation_noetig' });

    await world.health.importNow();
    expect(world.health.connection()).toBeNull();
    expect(world.fake.reads).toEqual([]);
  });

  it('eine erneute Verbindung behält den ersten Verbindungstag', async () => {
    const world = await healthWorld();
    await connected(world);
    world.clock.advanceBy(3 * 24 * 3_600_000);
    await connected(world);
    expect(world.health.connection()).toMatchObject({ connectedOn: '2026-10-14', lastImportAt: '2026-10-17T10:00:00.000Z' });
  });

  it('ohne Daten verbindet sie und importiert nichts, ohne Fehler', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'keine_daten', world.clock);
    await connected(world);
    expect(imports(world)).toEqual({ sports: [], weights: [] });
    expect(world.errors).toEqual([]);
  });
});

describe('Erstimport', () => {
  it('liest Gewicht der letzten 30 Tage und Sport ab Beginn des Verbindungstags, die erste Abfrage begrenzt den Zeitraum', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);

    await connected(world);

    expect(world.fake.reads).toEqual([
      { type: 'workout', cursor: null, since: '2026-10-13T22:00:00.000Z' },
      { type: 'weight', cursor: null, since: daysAgo(30) },
    ]);
    const { sports, weights } = imports(world);
    // Gewicht vor 40 Tagen und das Training von gestern liegen außerhalb.
    expect(weights.map((row) => row.externalKey).sort()).toEqual(['gewicht-2-tage', 'gewicht-29-tage', 'gewicht-heute']);
    expect(sports.map((row) => row.externalKey)).toEqual(['training-heute']);
  });

  it('legt Einträge mit deterministischer ID, Herkunft, Quell-App, Regeln und lokalem Tag an, samt Outbox-Operation', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);

    await connected(world);

    const training = byKey(imports(world).sports, 'training-heute');
    expect(training).toMatchObject({
      id: importedSportEntryId(philipp, 'apple_health', 'training-heute'),
      personId: philipp,
      origin: 'apple_health',
      externalKey: 'training-heute',
      sourceAppId: fitbitApp.id,
      sourceAppName: null,
      // HKWorkoutActivityType 52 (walking); 32 min 30 s ergeben gerundet 33 min.
      activityType: 'gehen',
      overrideActivityType: null,
      durationMinutes: 33,
      activeMilliKcal: 154_000,
      startedAt: minutesFrom(noon, -180),
      localDate: '2026-10-14',
      timeZone: 'Europe/Berlin',
      utcOffsetMinutes: 120,
      hiddenAt: null,
      replacedByEntryId: null,
      reactivatedAt: null,
      deletedAt: null,
    });
    expect(byKey(imports(world).weights, 'gewicht-heute')).toMatchObject({
      id: importedWeightEntryId(philipp, 'apple_health', 'gewicht-heute'),
      // Importierte Gewichte behalten ihre genauen Gramm.
      weightG: 82_437,
      origin: 'apple_health',
      sourceAppId: fitbitApp.id,
      hiddenAt: null,
      localDate: '2026-10-14',
    });
    const operations = world.operations();
    expect(operations).toHaveLength(4);
    expect(operations).toContainEqual(
      expect.objectContaining({ type: 'upsert_entity', entityType: 'sport_entry', entityId: training!.id, payload: expect.objectContaining({ origin: 'apple_health', durationMinutes: 33 }) }),
    );
    expect(world.reports).toEqual([
      { personId: philipp, localDates: ['2026-10-14'], cause: 'health_import' },
      { personId: philipp, localDates: ['2026-09-15', '2026-10-12', '2026-10-14'], cause: 'health_import' },
    ]);
  });

  it('nutzt danach den gespeicherten Cursor je Typ', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    world.fake.reads.length = 0;

    await world.health.importNow();

    expect(world.fake.reads.map(({ type, cursor }) => ({ type, cursor }))).toEqual([
      { type: 'workout', cursor: expect.any(String) },
      { type: 'weight', cursor: expect.any(String) },
    ]);
    expect(world.fake.reads.every(({ cursor }) => cursor !== null)).toBe(true);
  });
});

describe('Import der Änderungen', () => {
  it('aktualisiert bekannte Schlüssel, löscht in der Quelle Gelöschtes und legt Neues an', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    world.reports.length = 0;
    world.clock.advanceBy(30 * 60_000);

    await applyHealthScenario(world.fake, 'aenderungen', world.clock);
    await world.health.importNow();

    const { sports, weights } = imports(world);
    expect(byKey(sports, 'training-heute')).toMatchObject({ durationMinutes: 41, deletedAt: null });
    expect(byKey(sports, 'training-neu')).toMatchObject({ activityType: 'radfahren', durationMinutes: 20, deletedAt: null });
    expect(byKey(weights, 'gewicht-heute')!.deletedAt).not.toBeNull();
    expect(live(weights)).toHaveLength(2);
    expect(world.operations()).toContainEqual(expect.objectContaining({ type: 'delete_entity', entityType: 'weight_entry', entityId: importedWeightEntryId(philipp, 'apple_health', 'gewicht-heute') }));
    expect(world.reports).toEqual([
      { personId: philipp, localDates: ['2026-10-14'], cause: 'health_import' },
      { personId: philipp, localDates: ['2026-10-14'], cause: 'health_import' },
    ]);
  });

  it('ein Upsert behält Ausblendung und überschriebene Aktivitätsart und aktualisiert Beginn, Dauer, Kalorien und lokalen Tag', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    const sportId = importedSportEntryId(philipp, 'apple_health', 'training-heute');
    const weightId = importedWeightEntryId(philipp, 'apple_health', 'gewicht-2-tage');
    // Ausblenden und „Aktivitätsart ändern“ liefert #186; hier setzt der Test die Felder wie ein Pull.
    world.database.transaction((tx) => {
      sqliteOf(tx).update(sportEntry).set({ hiddenAt: noon, overrideActivityType: 'krafttraining' }).where(eq(sportEntry.id, sportId)).run();
      sqliteOf(tx).update(weightEntry).set({ hiddenAt: noon }).where(eq(weightEntry.id, weightId)).run();
    });

    // Das Training beginnt in der Quelle nun kurz nach Mitternacht Berlin, ist ein Lauf und dauert 50 min.
    world.fake.put(
      fakeWorkout('training-heute', Instant.parse('2026-10-13T22:10:00.000Z'), 50 * 60, { platformActivityType: 37, activeMilliKcal: 300_000 }),
      fakeWeight('gewicht-2-tage', daysAgo(2), 82_700),
    );
    await world.health.importNow();

    expect(world.sports().find((row) => row.id === sportId)).toMatchObject({
      startedAt: '2026-10-13T22:10:00.000Z',
      durationMinutes: 50,
      activeMilliKcal: 300_000,
      activityType: 'laufen',
      overrideActivityType: 'krafttraining',
      hiddenAt: noon,
      localDate: '2026-10-14',
    });
    expect(world.weights().find((row) => row.id === weightId)).toMatchObject({ weightG: 82_700, hiddenAt: noon });
  });

  it('meldet bei einem Tageswechsel alten und neuen Tag', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    world.reports.length = 0;

    world.fake.put(fakeWeight('gewicht-heute', Instant.parse('2026-10-13T20:00:00.000Z'), 82_437));
    await world.health.importNow();

    expect(world.reports).toEqual([{ personId: philipp, localDates: ['2026-10-13', '2026-10-14'], cause: 'health_import' }]);
    expect(byKey(imports(world).weights, 'gewicht-heute')).toMatchObject({ localDate: '2026-10-13' });
  });

  it('ein bereits gelöschter Eintrag bleibt gelöscht, auch wenn die Quelle ihn erneut liefert', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    const id = importedSportEntryId(philipp, 'apple_health', 'training-heute');
    // Gelöscht etwa auf einem anderen Gerät und per Pull übernommen.
    world.database.transaction((tx) => sqliteOf(tx).update(sportEntry).set({ deletedAt: noon }).where(eq(sportEntry.id, id)).run());
    const before = world.operations().length;

    world.fake.put(fakeWorkout('training-heute', minutesFrom(noon, -180), 60 * 60, { platformActivityType: 52 }));
    await world.health.importNow();

    expect(world.sports().find((row) => row.id === id)).toMatchObject({ deletedAt: noon, durationMinutes: 33 });
    expect(world.operations()).toHaveLength(before);
  });

  it('ein unveränderter Datensatz schreibt nichts', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    const before = world.operations().length;
    world.reports.length = 0;

    world.fake.put(...world.fake.records('workout'), ...world.fake.records('weight'));
    await world.health.importNow();

    expect(world.operations()).toHaveLength(before);
    expect(world.reports).toEqual([]);
  });

  it('Gewichte vor dem 30-Tage-Zeitraum und Trainings vor dem Verbindungstag werden auch später nicht übernommen', async () => {
    const world = await healthWorld();
    await connected(world);

    world.fake.put(fakeWeight('gewicht-alt', daysAgo(31), 84_000), fakeWorkout('training-vortag', daysAgo(1), 30 * 60));
    await world.health.importNow();

    expect(imports(world)).toEqual({ sports: [], weights: [] });
  });
});

describe('verfallener Token', () => {
  it('liest die letzten 30 Tage neu, aktualisiert Vorhandenes und löscht fehlende lokale Importe dieses Zeitraums', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    // Zwei Tage später: Das Gewicht von vor 29 Tagen liegt nun außerhalb des Abgleichs.
    world.clock.advanceBy(2 * 24 * 3_600_000);
    world.fake.remove('weight', 'gewicht-29-tage', 'gewicht-2-tage');
    world.fake.put(fakeWeight('gewicht-heute', minutesFrom(noon, -240), 82_400));
    await applyHealthScenario(world.fake, 'token_verfallen', world.clock);
    world.fake.reads.length = 0;

    await world.health.importNow();

    const now = Instant.parse('2026-10-16T10:00:00.000Z');
    expect(world.fake.reads).toEqual([
      { type: 'workout', cursor: expect.any(String), since: '2026-10-13T22:00:00.000Z' },
      // Trainings nie vor dem Verbindungstag, auch nicht im Abgleich.
      { type: 'workout', cursor: null, since: '2026-10-13T22:00:00.000Z' },
      { type: 'weight', cursor: expect.any(String), since: daysAgo(30) },
      { type: 'weight', cursor: null, since: minutesFrom(now, -30 * 24 * 60) },
    ]);
    const { sports, weights } = imports(world);
    expect(byKey(sports, 'training-heute')!.deletedAt).not.toBeNull();
    expect(byKey(weights, 'gewicht-2-tage')!.deletedAt).not.toBeNull();
    // Außerhalb des Zeitraums bleibt der Import, obwohl er in der Quelle fehlt.
    expect(byKey(weights, 'gewicht-29-tage')!.deletedAt).toBeNull();
    expect(byKey(weights, 'gewicht-heute')).toMatchObject({ weightG: 82_400, deletedAt: null });

    // Danach gilt wieder ein gültiger Cursor.
    world.fake.reads.length = 0;
    await world.health.importNow();
    expect(world.fake.reads.map(({ cursor }) => cursor !== null)).toEqual([true, true]);
  });
});

describe('Annahmeregeln', () => {
  it('importiert kein Training unter 60 Sekunden und rundet 89 s auf 1 min, 90 s auf 2 min', async () => {
    const world = await healthWorld();
    await connected(world);
    await applyHealthScenario(world.fake, 'null_minuten', world.clock);

    await world.health.importNow();

    const { sports } = imports(world);
    expect(byKey(sports, 'training-0-sekunden')).toBeUndefined();
    expect(byKey(sports, 'training-89-sekunden')).toMatchObject({ durationMinutes: 1 });
    expect(byKey(sports, 'training-90-sekunden')).toMatchObject({ durationMinutes: 2 });
  });

  it('löscht einen Import, dessen Training in der Quelle unter 60 Sekunden fällt', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);

    world.fake.put(fakeWorkout('training-heute', minutesFrom(noon, -180), 30));
    await world.health.importNow();

    expect(byKey(imports(world).sports, 'training-heute')!.deletedAt).not.toBeNull();
  });

  it('übernimmt Gewichte nur von 20 bis 350 kg und Trainings bis 1440 Minuten', async () => {
    const world = await healthWorld();
    await connected(world);
    world.fake.put(
      fakeWeight('zu-leicht', minutesFrom(noon, -10), 19_999),
      fakeWeight('leichtestes', minutesFrom(noon, -9), 20_000),
      fakeWeight('schwerstes', minutesFrom(noon, -8), 350_000),
      fakeWeight('zu-schwer', minutesFrom(noon, -7), 350_001),
      fakeWorkout('zu-lang', minutesFrom(noon, -1), 1_441 * 60),
    );

    await world.health.importNow();

    const { sports, weights } = imports(world);
    expect(weights.map((row) => row.externalKey).sort()).toEqual(['leichtestes', 'schwerstes']);
    expect(sports).toEqual([]);
  });

  it('bildet Plattformarten auf die acht Arten ab, Unbekanntes wird `sonstiges`', async () => {
    const world = await healthWorld();
    await connected(world);
    world.fake.put(
      fakeWorkout('schwimmen', minutesFrom(noon, -120), 30 * 60, { platformActivityType: 46 }),
      fakeWorkout('unbekannt', minutesFrom(noon, -60), 30 * 60, { platformActivityType: 9_999 }),
      fakeWorkout('ohne-art', minutesFrom(noon, -30), 30 * 60),
    );

    await world.health.importNow();

    const { sports } = imports(world);
    expect(Object.fromEntries(sports.map((row) => [row.externalKey, row.activityType]))).toEqual({ schwimmen: 'schwimmen', unbekannt: 'sonstiges', 'ohne-art': 'sonstiges' });
  });
});

describe('lokaler Tag eines Imports', () => {
  it('folgt dem mitgelieferten Offset; die Zone ist die des Geräts beim Import', async () => {
    const world = await healthWorld();
    await connected(world);
    // 22:30 UTC: in Berlin schon der 15.10., mit Offset −5 h (New York) noch der 14.10.
    const late = Instant.parse('2026-10-14T22:30:00.000Z');
    world.clock.set(Instant.parse('2026-10-15T08:00:00.000Z'));
    world.fake.put(fakeWeight('mit-offset', late, 80_000, { utcOffsetMinutes: -300 }), fakeWeight('ohne-offset', minutesFrom(late, 1), 80_000));

    await world.health.importNow();

    const { weights } = imports(world);
    expect(byKey(weights, 'mit-offset')).toMatchObject({ localDate: '2026-10-14', utcOffsetMinutes: -300, timeZone: 'Europe/Berlin' });
    expect(byKey(weights, 'ohne-offset')).toMatchObject({ localDate: '2026-10-15', utcOffsetMinutes: 120, timeZone: 'Europe/Berlin' });
  });

  it('ein Upsert nach einer Reise nimmt Zone und Offset des Geräts beim Import', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    expect(byKey(imports(world).weights, 'gewicht-heute')).toMatchObject({ timeZone: 'Europe/Berlin', localDate: '2026-10-14' });

    // In New York (UTC−4) liegt 06:00 UTC noch am 14.10., aber der Messzeitpunkt rückt auf 03:00 UTC.
    world.clock.setTimeZone(TimeZone.parse('America/New_York'));
    world.fake.put(fakeWeight('gewicht-heute', Instant.parse('2026-10-14T03:00:00.000Z'), 82_437));
    await world.health.importNow();

    expect(byKey(imports(world).weights, 'gewicht-heute')).toMatchObject({ timeZone: 'America/New_York', utcOffsetMinutes: -240, localDate: '2026-10-13' });
  });

  it('nimmt sonst den Offset der Gerätezone zum Zeitpunkt, auch über die Zeitumstellung', async () => {
    const at = Instant.parse('2026-10-26T08:00:00.000Z');
    const world = await healthWorld({ at });
    await connected(world);
    world.fake.put(fakeWorkout('nach-umstellung', minutesFrom(at, -60), 30 * 60));

    await world.health.importNow();

    expect(byKey(imports(world).sports, 'nach-umstellung')).toMatchObject({ localDate: '2026-10-26', utcOffsetMinutes: 60 });
  });
});

describe('Serialisierung', () => {
  it('lässt höchstens einen Import gleichzeitig laufen und fasst weitere Auslöser zu genau einem Nachlauf zusammen', async () => {
    const world = await healthWorld();
    await connected(world);
    world.fake.reads.length = 0;
    const release = world.fake.holdReads();

    const first = world.health.importNow();
    const second = world.health.importNow();
    const third = world.health.importNow();
    await new Promise((resolve) => setImmediate(resolve));
    // Der erste Lauf wartet in seiner ersten Abfrage; kein zweiter läuft daneben.
    expect(world.fake.reads).toHaveLength(1);
    expect(second).toBe(third);

    release();
    await Promise.all([first, second, third]);

    // Zwei Läufe mit je einer Abfrage pro Typ: der erste und genau ein Nachlauf.
    expect(world.fake.reads.map(({ type }) => type)).toEqual(['workout', 'weight', 'workout', 'weight']);
  });

  it('zwei gleichzeitige Weckungen importieren jeden Datensatz genau einmal', async () => {
    const world = await healthWorld();
    await connected(world);
    world.fake.registerBackground(() => world.health.importNow());

    await applyHealthScenario(world.fake, 'zwei_weckungen', world.clock);
    await world.health.idle();

    const { sports, weights } = imports(world);
    expect(sports.map((row) => row.externalKey)).toEqual(['training-weckung']);
    expect(weights.map((row) => row.externalKey)).toEqual(['gewicht-weckung']);
    expect(world.operations().filter((operation) => operation.type === 'upsert_entity')).toHaveLength(2);
  });
});

describe('Transaktion je Stapel', () => {
  it('rollt Einträge, Outbox und Cursor gemeinsam zurück, wenn die Auswertung scheitert, und holt alles beim nächsten Import nach', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    world.failReevaluation(true);

    await connected(world);

    expect(imports(world)).toEqual({ sports: [], weights: [] });
    expect(world.operations()).toEqual([]);
    expect(world.database.read((tx) => [readDeviceState(tx, 'health_cursor_workout'), readDeviceState(tx, 'health_cursor_weight')])).toEqual([undefined, undefined]);
    expect(world.health.connection()?.lastImportAt).toBeNull();
    // Still: kein Fehler an der Oberfläche, nur im Protokoll.
    expect(world.errors).toHaveLength(2);

    world.failReevaluation(false);
    world.fake.reads.length = 0;
    await world.health.importNow();

    expect(world.fake.reads.map(({ cursor }) => cursor)).toEqual([null, null]);
    expect(live(imports(world).sports)).toHaveLength(1);
    expect(live(imports(world).weights)).toHaveLength(3);
  });

  it('wiederholter Import erzeugt keine doppelte Tageszielerfüllung', async () => {
    const world = await healthWorld({ bausteine: trackerDailyGoals.bausteine });
    const snapshot: DailyGoalSnapshot = {
      type: 'gewogen', personId: philipp, localDate: LocalDate.parse('2026-10-14'), slot: 1, timeZone: berlin, dayEndsAt: Instant.parse('2026-10-14T22:00:00.000Z'),
    };
    world.database.transaction((tx) => insertDailyGoalForTest(tx, EntityId.parse(randomUUID()), snapshot));
    await applyHealthScenario(world.fake, 'erstimport', world.clock);

    await connected(world);
    world.fake.put(fakeWeight('gewicht-heute', minutesFrom(noon, -240), 82_300));
    await world.health.importNow();
    world.fake.expireCursors();
    await world.health.importNow();

    const completions = world.database.read((tx) => sqliteOf(tx).select().from(dailyGoalCompletion).all());
    expect(completions).toEqual([expect.objectContaining({ personId: philipp, localDate: '2026-10-14', baustein: 'gewogen' })]);
  });
});

describe('ohne Verbindung oder Berechtigung', () => {
  it('liest ohne Verbindung nichts', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);

    await world.health.importNow();

    expect(world.fake.reads).toEqual([]);
    expect(imports(world)).toEqual({ sports: [], weights: [] });
  });

  it('bei entzogener Berechtigung bleibt alles Importierte, und es gibt keinen Fehler', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    world.fake.setAccess('verweigert');
    world.fake.reads.length = 0;

    await world.health.importNow();

    expect(world.fake.reads).toEqual([]);
    expect(live(imports(world).weights)).toHaveLength(3);
    expect(world.errors).toEqual([]);
    // Manuelle Einträge funktionieren weiter.
    world.trackers.recordWeight({ weightG: 82_000, measuredAt: noon });
    expect(world.weights().filter((row) => row.origin === 'manuell')).toHaveLength(1);
  });

  it('ein Fehler der Plattform bleibt still und wird beim nächsten Auslöser nachgeholt', async () => {
    const world = await healthWorld();
    await connected(world);
    const failing = world.fake.readChanges;
    world.fake.put(fakeWorkout('training', minutesFrom(noon, -60), 30 * 60));
    Object.assign(world.fake, { readChanges: () => Promise.reject(new Error('HealthKit nicht erreichbar')) });

    await expect(world.health.importNow()).resolves.toBeUndefined();
    expect(world.errors).toHaveLength(2);

    Object.assign(world.fake, { readChanges: failing });
    await world.health.importNow();
    expect(imports(world).sports.map((row) => row.externalKey)).toEqual(['training']);
  });
});

describe('Auslöser im Vordergrund', () => {
  it('importiert beim App-Start, bei Rückkehr in den Vordergrund und nicht beim Wechsel in den Hintergrund', async () => {
    const world = await healthWorld();
    await connected(world);
    world.fake.reads.length = 0;
    let foreground: (active: boolean) => void = () => {};

    const stop = world.health.startForegroundTriggers({
      initialActive: true,
      observeForeground: (listener) => {
        foreground = listener;
        return () => {};
      },
    });
    await world.health.idle();
    expect(world.fake.reads).toHaveLength(2);

    foreground(false);
    await world.health.idle();
    expect(world.fake.reads).toHaveLength(2);

    foreground(true);
    await world.health.idle();
    expect(world.fake.reads).toHaveLength(4);
    stop();
  });
});

describe('zählen nach den Tracker-Regeln', () => {
  const goal: FakeGoalVersion = {
    id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c11'),
    personId: philipp,
    validFrom: LocalDate.parse('2026-10-01'),
    calorieBudgetMilliKcal: 1_800_000,
    lowerBoundMilliKcal: 1_500_000,
    maintenanceReason: null,
    pace: 'entspannt',
    goalWeightG: 80_000,
    waterTargetMl: 1500,
    weeklySportTargetMinutes: 150,
  };
  const weeklyPlan: FakeWeeklyPlanVersion = {
    id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c12'),
    personId: philipp,
    validFrom: LocalDate.parse('2026-10-01'),
    days: Object.fromEntries(
      ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'].map((day) => [day, ['wasserziel', 'sporteinheit', 'gewogen']]),
    ) as FakeWeeklyPlanVersion['days'],
  };

  it('importierte Trainings zählen in den Wochenminuten, importierte Gewichte als Tagesgewicht, im Trend und für „gewogen“', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'erstimport', world.clock);
    await connected(world);
    const planReader = fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) }).planReader;
    const registry = createTodayRegistry();
    const noRefresh = () => () => {};
    registry.register('tracker', 'trackers.sport', world.trackers.sportToday(planReader, noRefresh));
    registry.register('tracker', 'trackers.weight', world.trackers.weightToday(planReader, noRefresh));
    let sport: TodayState<'trackers.sport'> | undefined;
    let weight: TodayState<'trackers.weight'> | undefined;
    const stops = [registry.subscribe('trackers.sport', (state) => (sport = state)), registry.subscribe('trackers.weight', (state) => (weight = state))];
    await new Promise((resolve) => setImmediate(resolve));

    expect(sport).toMatchObject({ type: 'ready', data: { weekMinutes: 33 } });
    // Drei importierte Tagesgewichte (das vor 40 Tagen liegt außerhalb der 30 Tage): Der Mini-Tracker zeigt
    // den Trend (#176). 83 650 → nach 27 Tagen 83 650 + (1 − 0,9^27) × (82 840 − 83 650) = 82 887,1 → nach
    // 2 Tagen 82 887,1 + 0,19 × (82 437 − 82 887,1) = 82 801,6.
    expect(weight).toMatchObject({ type: 'ready', data: { value: { type: 'trend', weightG: 82_802 }, status: { type: 'gewogen' } } });
    expect(world.trackers.lastWeights()).toEqual({ weightG: 82_437, dayWeight: { localDate: '2026-10-14', weightG: 82_437 } });
    for (const stop of stops) stop();
  });
});

describe('Quell-Apps', () => {
  it('gruppiert die letzten 30 Tage nach Quell-App, mit und ohne Google Health (Fitbit)', async () => {
    const world = await healthWorld();

    await applyHealthScenario(world.fake, 'fitbit_vorhanden', world.clock);
    expect((await world.health.platform.recentOrigins(30)).map(({ sourceApp }) => sourceApp.id).sort()).toEqual(['com.fitbit.FitbitMobile', 'com.withings.wiScaleNG']);

    await applyHealthScenario(world.fake, 'fitbit_fehlt', world.clock);
    expect((await world.health.platform.recentOrigins(30)).map(({ sourceApp }) => sourceApp.id)).not.toContain('com.fitbit.FitbitMobile');
  });
});

describe('Korrekturen der Person überdauern Änderungen in der Quelle (#186)', () => {
  it('Szenario `korrekturen`: ein ausgeblendeter Import und einer mit geänderter Aktivitätsart, danach ein Upsert aus der Quelle', async () => {
    const world = await healthWorld();
    await applyHealthScenario(world.fake, 'korrekturen', world.clock);
    await connected(world);
    const sportId = (key: string) => importedSportEntryId(philipp, 'apple_health', key);
    const scale = importedWeightEntryId(philipp, 'apple_health', 'gewicht-korrektur');
    expect(byKey(imports(world).sports, 'training-fehlaufnahme')).toMatchObject({ activityType: 'gehen', durationMinutes: 12 });
    expect(byKey(imports(world).sports, 'training-falsch-erkannt')).toMatchObject({ activityType: 'radfahren', durationMinutes: 45 });

    world.trackers.expire(world.trackers.hideImported(sportId('training-fehlaufnahme')).undoToken);
    world.trackers.expire(world.trackers.overrideActivityType(sportId('training-falsch-erkannt'), 'krafttraining').undoToken);
    world.trackers.expire(world.trackers.hideImported(scale).undoToken);

    world.clock.advanceBy(3_600_000);
    await applyHealthScenario(world.fake, 'korrekturen_quelle', world.clock);
    await world.health.importNow();

    const { sports, weights } = imports(world);
    expect(byKey(sports, 'training-fehlaufnahme')).toMatchObject({ durationMinutes: 14, hiddenAt: noon, deletedAt: null });
    expect(byKey(sports, 'training-falsch-erkannt')).toMatchObject({ durationMinutes: 48, activityType: 'laufen', overrideActivityType: 'krafttraining', hiddenAt: null });
    expect(byKey(weights, 'gewicht-korrektur')).toMatchObject({ weightG: 82_512, hiddenAt: noon, deletedAt: null });
    expect(world.errors).toEqual([]);

    // Gezählt und gezeigt wird nur das Training mit geänderter Art, mit der überschriebenen Art.
    const planReader = fakeAreaPorts({ planReader: fakePlanReader({ goals: [], weeklyPlans: [] }) }).planReader;
    let week: unknown;
    const stop = world.trackers.sportWeek(planReader, () => () => {}, null).subscribe((state) => (week = state));
    await new Promise((resolve) => setImmediate(resolve));
    expect(week).toMatchObject({
      type: 'ready',
      week: { weekMinutes: 48, days: [{ entries: [{ id: sportId('training-falsch-erkannt'), activityType: 'krafttraining', recognizedActivityType: 'laufen' }] }] },
    });
    stop();
  });
});
