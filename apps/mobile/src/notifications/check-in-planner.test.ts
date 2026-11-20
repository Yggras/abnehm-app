/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone, type BausteinKey, type MealKey, type Weekday } from '@abnehm/contracts/base';
import { defaultNotificationSetting, type NotificationSettingUpsert } from '@abnehm/contracts/notifications';
import type { NutritionSnapshot } from '@abnehm/contracts/nutrition';
import type { IslandCheckInHint } from '@abnehm/contracts/ports';

import { fakeIslandCheckInHintReader, fakePlanReader, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity } from '../daily-goals';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { energyBookingEntity } from '../energy';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createNutrition, nutritionDailyGoals, nutritionEntryEntity } from '../nutrition';
import { withoutPhotos } from '../nutrition/testing/without-photos';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { createFakeNotificationPort, type FakeNotificationPort } from '../test-capabilities/notifications';
import { createTrackers, sportEntryEntity, trackerDailyGoals, waterEntryEntity, weightEntryEntity } from '../trackers';
import { createCheckInPlanner, type CheckInPlanner } from './check-in-planner';
import { notificationSettingEntity } from './notification-setting-entity';
import { createNotificationSettings } from './notification-setting';
import type { LocalNotification } from './port';

// Nachweis für #135: der Check-in-Planer (Spezifikation 5, Abschnitt 7) über `reschedule` und `clearAll`
// mit dem Fake-Mitteilungs-Port, der Testuhr, einem Fake-`PlanReader` und einer echten SQLite-Datei mit
// den Migrationen der App. Ernährung, Wasser, Sport und Gewicht werden über ihre echten Module erfasst und
// über ihre echten Check-in-Evaluatoren ausgewertet; die Schwellen selbst belegen deren Wahrheitstabellen
// (#166, #178), hier geht es darum, dass der Planer sie richtig nutzt und bündelt.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const berlin = TimeZone.parse('Europe/Berlin');
/** Mittwoch, 14.10.2026, 07:00 in Berlin (Sommerzeit, UTC+2). Am 25.10.2026 endet die Sommerzeit. */
const morning = Instant.parse('2026-10-14T05:00:00.000Z');
const today = LocalDate.parse('2026-10-14');

type Bausteine = [BausteinKey, BausteinKey, BausteinKey];
const sportDay: Bausteine = ['sporteinheit', 'wasserziel', 'ernaehrung_erfasst'];
const weighDay: Bausteine = ['gewogen', 'wasserziel', 'ernaehrung_erfasst'];
const plainDay: Bausteine = ['im_kalorienbudget', 'wasserziel', 'ernaehrung_erfasst'];
/** Dienstag, Donnerstag und Samstag Sport, Montag Wiegetag. */
const week: Record<Weekday, Bausteine> = {
  montag: weighDay,
  dienstag: sportDay,
  mittwoch: plainDay,
  donnerstag: sportDay,
  freitag: plainDay,
  samstag: sportDay,
  sonntag: plainDay,
};

const goal = {
  id: EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c02'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 2_417_875,
  lowerBoundMilliKcal: 1_882_500,
  maintenanceReason: null,
  pace: 'entspannt' as const,
  goalWeightG: 78_000,
  waterTargetMl: 1_500,
  weeklySportTargetMinutes: 150,
};

const weeklyPlan = (days: Record<Weekday, Bausteine>, validFrom = '2026-10-01', id = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c01'): FakeWeeklyPlanVersion => ({
  id: EntityId.parse(id),
  personId: philipp,
  validFrom: LocalDate.parse(validFrom),
  days,
});

const oats: NutritionSnapshot = {
  name: 'Hafer Flocken',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 348_000,
  proteinMg: 13_220,
  carbsMg: 53_300,
  fatMg: 6_650,
  portions: [],
  source: 'bls',
  attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
};

type WorldOptions = Readonly<{
  at?: Instant;
  weeklyPlans?: readonly FakeWeeklyPlanVersion[];
  hint?: IslandCheckInHint;
  /** Ohne registrierten `IslandCheckInHintReader`. */
  withoutHintReader?: boolean;
  /** Registry ohne den Check-in der Ernährung, etwa um einen Vertragsfehler zu sehen. */
  withoutNutritionCheckIn?: boolean;
}>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function world({ at = morning, weeklyPlans: initialPlans = [weeklyPlan(week)], hint = null, withoutHintReader = false, withoutNutritionCheckIn = false }: WorldOptions = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock: TestClock = createTestClock({ instant: at, timeZone: berlin });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({
    registry: createSyncRegistry([
      nutritionEntryEntity,
      waterEntryEntity,
      weightEntryEntity,
      sportEntryEntity,
      dailyGoalCompletionEntity,
      energyBookingEntity,
      notificationSettingEntity,
    ]),
    clock,
    newId,
  });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const registry = createDailyGoalRegistry({
    bausteine: [...nutritionDailyGoals.bausteine, ...trackerDailyGoals.bausteine],
    checkIns: [...(withoutNutritionCheckIn ? [] : nutritionDailyGoals.checkIns), ...trackerDailyGoals.checkIns],
  });
  const persistence = createDailyGoalPersistence({ registry, clock, writer, dispatcher });
  const nutrition = createNutrition({ ...withoutPhotos, database, clock, writer, persistence, newId });
  const trackers = createTrackers({ database, clock, writer, persistence, newId });
  const settings = createNotificationSettings({ database, writer, clock });
  const port: FakeNotificationPort = createFakeNotificationPort({ permission: 'granted' });
  const errors: unknown[] = [];
  // Veränderbar: Der Fake-`PlanReader` liest die Fassungen bei jedem Aufruf neu.
  const weeklyPlans = [...initialPlans];
  const planner: CheckInPlanner = createCheckInPlanner({
    database,
    registry,
    planReader: fakePlanReader({ goals: [goal], weeklyPlans }),
    islandCheckInHintReader: withoutHintReader ? null : fakeIslandCheckInHintReader(hint),
    clock,
    port,
    onError: (error) => errors.push(error),
  });

  return {
    clock,
    port,
    planner,
    errors,
    weeklyPlans,
    reschedule: () => planner.reschedule('app_start'),
    /** Die geplanten Check-ins nach Zeitpunkt. */
    planned: (): LocalNotification[] => [...port.scheduledNotifications()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    body: (id: string) => port.scheduledNotifications().find((notification) => notification.id === id)?.body,
    ids: () => port.scheduledNotifications().map((notification) => notification.id).sort(),
    eat: (meal: MealKey, localDate: LocalDate = clock.read().localDate) =>
      nutrition.addEntry({
        localDate,
        meal,
        captureMethod: 'suche',
        foodRef: { type: 'bls', key: 'C133000' },
        snapshot: oats,
        displayUnit: 'g',
        displayAmountMilli: 60_000,
      }),
    drink: (ml: number) => trackers.addWater({ ml }),
    train: () => trackers.recordSport({ activityType: 'laufen', durationMinutes: 30, startedAt: Instant.parse(clock.read().instant), activeMilliKcal: null }),
    weigh: () => trackers.recordWeight({ weightG: 81_200, measuredAt: Instant.parse(clock.read().instant) }),
    save: (setting: Partial<NotificationSettingUpsert>) => expect(settings.save({ ...defaultNotificationSetting, ...setting })).toEqual({ type: 'saved' }),
    /** Operationen des Ports, die den geplanten Bestand ändern. */
    changes: () => port.calls().filter((call) => call === 'schedule' || call === 'cancel').length,
  };
}

const lines = {
  middayMeals: 'Schon was gegessen? 🍎 Frühstück oder Mittag eintragen',
  eveningMeals: 'Was gab’s heute zu essen? 🍎 Kurz eintragen',
  futureWater: 'Schon was getrunken? 💧 Kurz eintragen',
  sport: 'Schon trainiert? Öffne die App, damit Momo es mitbekommt',
  weight: 'Heute ist Wiegetag ⚖️ – kurz auf die Waage?',
  visit: '… und auf der Insel wartet Besuch 🦊',
};
const water = (ml: number) => `${(Math.round(ml / 100) / 10).toFixed(1).replace('.', ',')} von 1,5 l getrunken 💧`;
const joined = (...parts: string[]) => parts.join('\n');

describe('Planungsfenster', () => {
  it('plant heute und die folgenden 13 lokalen Tage je Mittag und Abend: genau 28 Check-ins mit deterministischen Identifikatoren', async () => {
    const { reschedule, planned, port } = await world();
    await reschedule();

    const all = planned();
    expect(all).toHaveLength(28);
    expect(all.map((notification) => notification.id).slice(0, 4)).toEqual([
      'checkin:2026-10-14:mittag',
      'checkin:2026-10-14:abend',
      'checkin:2026-10-15:mittag',
      'checkin:2026-10-15:abend',
    ]);
    expect(all.at(-1)?.id).toBe('checkin:2026-10-27:abend');
    for (const notification of all) {
      expect(notification).toMatchObject({ channel: 'checkins', title: 'Momo fragt nach', data: { target: { type: 'today' } } });
    }
    expect(port.calls().filter((call) => call === 'schedule')).toHaveLength(28);
  });

  it('bildet die Wanduhrzeit in der Gerätezone ab, auch über das Ende der Sommerzeit am 25.10.2026', async () => {
    const { reschedule, planned } = await world();
    await reschedule();

    const at = Object.fromEntries(planned().map((notification) => [notification.id, notification.at]));
    expect(at['checkin:2026-10-14:mittag']).toBe('2026-10-14T11:00:00.000Z');
    expect(at['checkin:2026-10-24:abend']).toBe('2026-10-24T17:00:00.000Z');
    expect(at['checkin:2026-10-25:mittag']).toBe('2026-10-25T12:00:00.000Z');
    expect(at['checkin:2026-10-26:abend']).toBe('2026-10-26T18:00:00.000Z');
  });

  it('lässt heute vergangene Zeitpunkte aus', async () => {
    const afternoon = await world({ at: Instant.parse('2026-10-14T12:00:00.000Z') });
    await afternoon.reschedule();
    expect(afternoon.planned()).toHaveLength(27);
    expect(afternoon.planned()[0]?.id).toBe('checkin:2026-10-14:abend');

    const night = await world({ at: Instant.parse('2026-10-14T21:30:00.000Z') });
    await night.reschedule();
    expect(night.planned()).toHaveLength(26);
    expect(night.planned()[0]?.id).toBe('checkin:2026-10-15:mittag');

    // Genau zum Zeitpunkt ist er vorbei.
    const exactly = await world({ at: Instant.parse('2026-10-14T11:00:00.000Z') });
    await exactly.reschedule();
    expect(exactly.planned()[0]?.id).toBe('checkin:2026-10-14:abend');
  });

  it('plant Tage ohne gültigen Plan nicht', async () => {
    const { reschedule, ids } = await world({ weeklyPlans: [weeklyPlan(week, '2026-10-20')] });
    await reschedule();

    expect(ids()[0]).toBe('checkin:2026-10-20:abend');
    expect(ids()).toHaveLength(16);
  });
});

describe('Abgleich über den Mitteilungs-Port', () => {
  it('ist idempotent: eine Wiederholung ändert nichts', async () => {
    const { reschedule, planned, changes } = await world();
    await reschedule();
    const before = planned();
    const operations = changes();

    await expect(reschedule()).resolves.toEqual({ scheduled: [], cancelled: [] });
    expect(changes()).toBe(operations);
    expect(planned()).toEqual(before);
  });

  it('bricht veraltete Check-ins ab und lässt fremde Benachrichtigungen stehen', async () => {
    const { reschedule, port, ids } = await world();
    const stale = { at: Instant.parse('2026-10-13T11:00:00.000Z'), channel: 'checkins', title: 'Momo fragt nach', body: lines.middayMeals, data: {} } as const;
    await port.schedule({ ...stale, id: 'checkin:2026-10-13:mittag' });
    await port.schedule({ ...stale, id: 'checkin:2026-10-28:mittag', at: Instant.parse('2026-10-28T12:00:00.000Z') });
    await port.schedule({ ...stale, id: 'anderes:1', channel: 'partner_momo' });

    const result = await reschedule();

    expect(result.cancelled).toEqual(['checkin:2026-10-13:mittag', 'checkin:2026-10-28:mittag']);
    expect(ids()).toHaveLength(29);
    expect(ids()).toContain('anderes:1');
  });

  it('ersetzt einen Check-in, dessen Inhalt sich geändert hat, und nur ihn', async () => {
    const { reschedule, eat, body } = await world();
    await reschedule();
    expect(body('checkin:2026-10-14:mittag')).toBe(joined(lines.middayMeals, water(0)));

    eat('fruehstueck');
    const result = await reschedule();

    // Abends fehlt weiterhin eine zweite Mahlzeit; dieser Check-in bleibt unverändert stehen.
    expect(result).toEqual({ scheduled: ['checkin:2026-10-14:mittag'], cancelled: ['checkin:2026-10-14:mittag'] });
    expect(body('checkin:2026-10-14:mittag')).toBe(water(0));
    expect(body('checkin:2026-10-14:abend')).toBe(joined(lines.eveningMeals, water(0)));
  });

  it('eine Wochenplanänderung ab morgen ersetzt genau die betroffenen Tage', async () => {
    const { reschedule, weeklyPlans, body } = await world();
    await reschedule();

    // Ab Donnerstag wird der Mittwoch zum Wiegetag: Betroffen ist nur der 21.10., mittags und abends.
    weeklyPlans.push(weeklyPlan({ ...week, mittwoch: weighDay }, '2026-10-15', '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c03'));
    const result = await reschedule();

    expect(result).toEqual({ scheduled: ['checkin:2026-10-21:mittag', 'checkin:2026-10-21:abend'], cancelled: ['checkin:2026-10-21:mittag', 'checkin:2026-10-21:abend'] });
    expect(body('checkin:2026-10-21:mittag')).toBe(joined(lines.middayMeals, lines.futureWater, lines.weight));
  });

  it('macht beim nächsten Abgleich weiter, wenn der Port zwischendurch scheitert', async () => {
    const { reschedule, port, ids } = await world();
    port.fail('schedule');
    await expect(reschedule()).rejects.toThrow('schedule');

    port.heal();
    await reschedule();
    expect(ids()).toHaveLength(28);
  });

  it('läuft nacheinander, auch wenn Aufrufe sich überholen', async () => {
    const { planner, ids } = await world();
    await Promise.all([planner.reschedule('vordergrund'), planner.clearAll(), planner.reschedule('eingabe')]);

    expect(ids()).toHaveLength(28);
  });
});

describe('Inhalt heute', () => {
  it('bündelt alle offenen Tracker in genau einer Benachrichtigung, in der Reihenfolge Ernährung, Wasser, Sport, Gewicht', async () => {
    const { reschedule, body, drink } = await world({ weeklyPlans: [weeklyPlan({ ...week, mittwoch: ['sporteinheit', 'gewogen', 'wasserziel'] })] });
    drink(400);
    await reschedule();

    expect(body('checkin:2026-10-14:mittag')).toBe(joined(lines.middayMeals, water(400), lines.weight));
    expect(body('checkin:2026-10-14:abend')).toBe(joined(lines.eveningMeals, water(400), lines.sport, lines.weight));
  });

  it('plant nichts, wenn nichts offen ist; das Kalorienbudget erinnert nie', async () => {
    const { reschedule, ids, eat, drink } = await world();
    eat('fruehstueck');
    eat('mittagessen');
    drink(1_000);
    await reschedule();

    expect(ids()).not.toContain('checkin:2026-10-14:mittag');
    expect(ids()).not.toContain('checkin:2026-10-14:abend');
    expect(ids()).toHaveLength(26);
  });

  it.each([
    // Mittags hinkt das Wasser unter einem Drittel von 1,5 l hinterher, abends unter zwei Dritteln.
    ['mittag', 499, true],
    ['mittag', 500, false],
    ['mittag', 501, false],
    ['abend', 999, true],
    ['abend', 1_000, false],
    ['abend', 1_001, false],
  ] as const)('Wasser %s bei %i ml: hinterher %s', async (moment, ml, behind) => {
    const { reschedule, body, eat, drink } = await world();
    eat('fruehstueck');
    eat('mittagessen');
    drink(ml);
    await reschedule();

    expect(body(`checkin:${today}:${moment}`)).toBe(behind ? water(ml) : undefined);
  });

  it.each([
    ['mittag', 0, true],
    ['mittag', 1, false],
    ['mittag', 2, false],
    ['abend', 1, true],
    ['abend', 2, false],
    ['abend', 3, false],
  ] as const)('Ernährung %s mit %i Mahlzeiten: hinterher %s', async (moment, meals, behind) => {
    const { reschedule, body, eat, drink } = await world();
    for (const meal of (['fruehstueck', 'mittagessen', 'abendessen'] as const).slice(0, meals)) eat(meal);
    drink(1_000);
    await reschedule();

    expect(body(`checkin:${today}:${moment}`)).toBe(behind ? (moment === 'mittag' ? lines.middayMeals : lines.eveningMeals) : undefined);
  });

  it('Sport: mittags nie, abends am Sporttag ohne zählende Einheit und weich formuliert', async () => {
    const tuesday = Instant.parse('2026-10-13T05:00:00.000Z');
    const { reschedule, body, eat, drink, train } = await world({ at: tuesday });
    eat('fruehstueck');
    eat('mittagessen');
    drink(1_000);
    await reschedule();

    expect(body('checkin:2026-10-13:mittag')).toBeUndefined();
    expect(body('checkin:2026-10-13:abend')).toBe(lines.sport);

    train();
    await reschedule();
    expect(body('checkin:2026-10-13:abend')).toBeUndefined();
  });

  it('Gewicht: am Wiegetag ohne Messung mittags und abends', async () => {
    const monday = Instant.parse('2026-10-19T05:00:00.000Z');
    const { reschedule, body, eat, drink, weigh } = await world({ at: monday });
    eat('fruehstueck');
    eat('mittagessen');
    drink(1_000);
    await reschedule();

    expect(body('checkin:2026-10-19:mittag')).toBe(lines.weight);
    expect(body('checkin:2026-10-19:abend')).toBe(lines.weight);

    weigh();
    await reschedule();
    expect(body('checkin:2026-10-19:mittag')).toBeUndefined();
  });

  it('ein Vertragsfehler eines Trackers geht an `onError`, die übrigen Tracker zählen weiter', async () => {
    const { reschedule, body, errors } = await world({ withoutNutritionCheckIn: true });
    await reschedule();

    expect(body('checkin:2026-10-14:mittag')).toBe(water(0));
    // Je heutigem Zeitpunkt ein Fehler.
    expect(errors).toEqual([new Error('Tages-Check-in ernaehrung: unknown_catalog_key'), new Error('Tages-Check-in ernaehrung: unknown_catalog_key')]);
  });
});

describe('Inhalt künftiger Tage', () => {
  it('Ernährung und Wasser immer, Sport nur abends am Sporttag, Gewicht am Wiegetag; ohne aktuelle Werte', async () => {
    const { reschedule, body, drink } = await world();
    drink(400);
    await reschedule();

    // Donnerstag ist Sporttag.
    expect(body('checkin:2026-10-15:mittag')).toBe(joined(lines.middayMeals, lines.futureWater));
    expect(body('checkin:2026-10-15:abend')).toBe(joined(lines.eveningMeals, lines.futureWater, lines.sport));
    // Freitag ist ein gewöhnlicher Tag.
    expect(body('checkin:2026-10-16:abend')).toBe(joined(lines.eveningMeals, lines.futureWater));
    // Montag ist Wiegetag.
    expect(body('checkin:2026-10-19:mittag')).toBe(joined(lines.middayMeals, lines.futureWater, lines.weight));
    expect(body('checkin:2026-10-19:abend')).toBe(joined(lines.eveningMeals, lines.futureWater, lines.weight));
  });
});

describe('Benachrichtigungseinstellung', () => {
  it('abgewählte Tracker fehlen; ohne Tracker plant der Planer nichts', async () => {
    const { reschedule, body, ids, save } = await world();
    save({ trackerWasser: false, trackerErnaehrung: false });
    await reschedule();

    expect(body('checkin:2026-10-15:abend')).toBe(lines.sport);
    expect(ids()).toEqual(['checkin:2026-10-15:abend', 'checkin:2026-10-17:abend', 'checkin:2026-10-19:abend', 'checkin:2026-10-19:mittag', 'checkin:2026-10-20:abend', 'checkin:2026-10-22:abend', 'checkin:2026-10-24:abend', 'checkin:2026-10-26:abend', 'checkin:2026-10-26:mittag', 'checkin:2026-10-27:abend']);

    save({ trackerWasser: false, trackerErnaehrung: false, trackerSport: false, trackerGewicht: false });
    await reschedule();
    expect(ids()).toEqual([]);
  });

  it('ausgeschaltete Zeitpunkte werden nicht geplant und vorhandene abgebrochen', async () => {
    const { reschedule, ids, save } = await world();
    await reschedule();

    save({ middayEnabled: false });
    const result = await reschedule();

    expect(result.cancelled).toHaveLength(14);
    expect(ids()).toHaveLength(14);
    expect(ids().every((id) => id.endsWith(':abend'))).toBe(true);
  });

  it('geänderte Uhrzeiten ersetzen die betroffenen Check-ins', async () => {
    const { reschedule, planned, save } = await world();
    await reschedule();

    save({ middayTime: '12:30', eveningTime: '19:00' });
    const result = await reschedule();

    expect(result.scheduled).toHaveLength(14);
    expect(result.scheduled.every((id) => id.endsWith(':mittag'))).toBe(true);
    expect(planned()[0]).toMatchObject({ id: 'checkin:2026-10-14:mittag', at: '2026-10-14T10:30:00.000Z' });
  });
});

describe('Insel-Zusatz', () => {
  it('hängt an die heute ohnehin geplanten Check-ins einen Zusatz je Ereignisart, an künftige nie', async () => {
    const { reschedule, body } = await world({ hint: { type: 'neues_insel_ereignis', eventKind: 'besuch' } });
    await reschedule();

    expect(body('checkin:2026-10-14:mittag')).toBe(joined(lines.middayMeals, water(0), lines.visit));
    expect(body('checkin:2026-10-14:abend')).toBe(joined(lines.eveningMeals, water(0), lines.visit));
    expect(body('checkin:2026-10-15:mittag')).toBe(joined(lines.middayMeals, lines.futureWater));
  });

  it('schafft nie einen eigenen Check-in', async () => {
    const { reschedule, ids, eat, drink } = await world({ hint: { type: 'neues_insel_ereignis', eventKind: 'entdeckung' } });
    eat('fruehstueck');
    eat('mittagessen');
    drink(1_000);
    await reschedule();

    expect(ids()).toHaveLength(26);
  });

  it('entfällt ohne registrierten `IslandCheckInHintReader`', async () => {
    const { reschedule, body } = await world({ withoutHintReader: true });
    await reschedule();

    expect(body('checkin:2026-10-14:mittag')).toBe(joined(lines.middayMeals, water(0)));
  });
});

describe('Zeitzonenwechsel', () => {
  it('plant zur gewohnten Ortszeit in der neuen Zone neu und bricht Tage außerhalb des Fensters ab', async () => {
    const { reschedule, clock, planned, ids } = await world();
    await reschedule();

    // 05:00 UTC ist in Tokio schon 14:00 am 14.10.; der Mittag ist vorbei.
    clock.setTimeZone(TimeZone.parse('Asia/Tokyo'));
    await reschedule();
    expect(planned()[0]).toMatchObject({ id: 'checkin:2026-10-14:abend', at: '2026-10-14T10:00:00.000Z' });
    expect(ids()).toHaveLength(27);

    // In New York ist es noch der 14.10., 01:00 Uhr.
    clock.setTimeZone(TimeZone.parse('America/New_York'));
    await reschedule();
    expect(planned()[0]).toMatchObject({ id: 'checkin:2026-10-14:mittag', at: '2026-10-14T17:00:00.000Z' });
    expect(ids()).toHaveLength(28);
  });
});

describe('Erlaubnis und clearAll', () => {
  it.each(['denied', 'undetermined'] as const)('ohne Erlaubnis (%s) plant der Planer nichts und bricht vorhandene Check-ins ab', async (permission) => {
    const { reschedule, port, ids } = await world();
    await reschedule();
    await port.schedule({ id: 'anderes:1', at: morning, channel: 'partner_momo', title: 'x', body: 'y', data: {} });

    port.setPermission(permission);
    const result = await reschedule();

    expect(result.scheduled).toEqual([]);
    expect(result.cancelled).toHaveLength(28);
    expect(ids()).toEqual(['anderes:1']);
  });

  it('`clearAll` bricht alle Check-ins ab, auch ohne Erlaubnis, und lässt fremde stehen', async () => {
    const { reschedule, planner, port, ids } = await world();
    await reschedule();
    await port.schedule({ id: 'anderes:1', at: morning, channel: 'partner_momo', title: 'x', body: 'y', data: {} });
    port.setPermission('denied');

    await expect(planner.clearAll()).resolves.toMatchObject({ scheduled: [], cancelled: expect.arrayContaining(['checkin:2026-10-14:mittag']) });
    expect(ids()).toEqual(['anderes:1']);
  });

  it('ohne eigene Person plant der Planer nichts', async () => {
    const files = createBetterSqliteFiles();
    const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
    cleanups.push(() => {
      databases.lock();
      files.remove();
    });
    const database = await databases.open('konto_a');
    const port = createFakeNotificationPort({ permission: 'granted' });
    const planner = createCheckInPlanner({
      database,
      registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }),
      planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan(week)] }),
      islandCheckInHintReader: null,
      clock: createTestClock({ instant: morning, timeZone: berlin }),
      port,
      onError: (error) => {
        throw error;
      },
    });

    await expect(planner.reschedule('app_start')).resolves.toEqual({ scheduled: [], cancelled: [] });
  });
});

describe('Eigenschaft: Texte ohne Kalorien, Gewichtsangaben und Schuld', () => {
  const forbidden = [/kcal/i, /kalorie/i, /budget/i, /\d\s*(kg|g)\b/i, /verpasst/i, /verfehlt/i, /Momo ist traurig/i, /zu viel/i];

  it('gilt für jeden erzeugten Check-in über alle Tage, Pläne, Einstellungen und Insel-Hinweise', async () => {
    const texts = new Set<string>();
    const kinds = [null, 'besuch', 'momos_wunsch', 'inselwetter', 'entdeckung'] as const;
    const days: Bausteine[] = [sportDay, weighDay, plainDay, ['sporteinheit', 'gewogen', 'wasserziel']];
    for (const [index, eventKind] of kinds.entries()) {
      const mixed = { ...week, mittwoch: days[index % days.length] as Bausteine };
      const { reschedule, port, save, drink, eat } = await world({
        weeklyPlans: [weeklyPlan(mixed)],
        hint: eventKind === null ? null : { type: 'neues_insel_ereignis', eventKind },
      });
      for (const [step, setting] of [{}, { trackerErnaehrung: false }, { trackerWasser: false, trackerSport: false }, { middayEnabled: false }].entries()) {
        save(setting);
        if (step === 1) drink(700);
        if (step === 2) eat('fruehstueck');
        await reschedule();
        for (const notification of port.scheduledNotifications()) texts.add(`${notification.title}\n${notification.body}`);
      }
    }

    expect(texts.size).toBeGreaterThan(10);
    for (const text of texts) for (const pattern of forbidden) expect({ text, match: pattern.test(text) }).toEqual({ text, match: false });
  });
});
