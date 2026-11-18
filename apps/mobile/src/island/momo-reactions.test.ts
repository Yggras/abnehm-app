/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone, type BausteinKey } from '@abnehm/contracts/base';
import { dailyGoalId, dailyGoalKey, type DailyGoalCause, type DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey } from '@abnehm/contracts/energy';
import type { MomoMood } from '@abnehm/contracts/island';

import { createDailyGoalPersistence, createDailyGoalRegistry, dailyGoalCompletionEntity, removeUnconfirmedDayCredits } from '../daily-goals';
import { insertDailyGoalForTest } from '../daily-goals/testing/persisted';
import { createTestFactsStore, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from '../daily-goals/testing/test-evaluators';
import { bookingByKey, energyBookingEntity } from '../energy';
import type { HapticKind } from '../haptics/haptics';
import { dailyGoalCompletion, energyBooking } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { TodayState } from '../shell/today-registry';
import type { MomoReaction } from './momo-reactions';
import type { IslandStage } from './role-choice';
import { createLaichkugelWorld, type LaichkugelWorld } from './testing/laichkugel-world';
import { philipp } from './testing/persons';

// Nachweis für #188: Momos Reaktionen auf Fundament-Ereignisse (Spezifikation 4, Abschnitt 6) am lokalen
// Spieldienst gegen eine echte SQLite-Datei. Erfüllungen entstehen wie im Betrieb über den echten
// Persistenzdienst (#105) mit den Test-Evaluatoren aus #104; Pulls übernehmen kanonische Datensätze über die
// Sync-Adapter. Geprüft wird an der Schnittstelle des Spieldienstes: Reaktionen, Haptik und Stimmung.

const berlin = TimeZone.parse('Europe/Berlin');
const today = LocalDate.parse('2026-10-14');
const yesterday = LocalDate.parse('2026-10-13');
const twoDaysAgo = LocalDate.parse('2026-10-12');
/** 12:00 in Berlin (Sommerzeit). */
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
/** Reaktion auf heute erstmals erfüllte Tagesziele ohne Bonus. */
const met = (...goals: BausteinKey[]): MomoReaction => ({ yesterday: null, goals, bonus: false });
const allFulfilled: Partial<TestDayFacts> = { weightEntryCount: 1, countedMl: 1500, sessionMinutes: [30], intakeKcal: 1500 };

/** Beginn des Folgetags in Berlin; alle Testtage liegen in der Sommerzeit. */
const dayEndOf = (localDate: LocalDate) => Instant.parse(new Date(Date.parse(`${localDate}T00:00:00.000Z`) + 22 * 3_600_000).toISOString());

function snapshotsOf(localDate: LocalDate, bausteine: readonly BausteinKey[]): DailyGoalSnapshot[] {
  return bausteine.map((type, index) => {
    const base = { personId: philipp, localDate, slot: (index + 1) as 1 | 2 | 3, timeZone: berlin, dayEndsAt: dayEndOf(localDate) };
    switch (type) {
      case 'wasserziel':
        return { type, ...base, targetMl: 1500 };
      case 'sporteinheit':
        return { type, ...base, minimumSingleSessionMinutes: 20 };
      case 'ernaehrung_erfasst':
        return { type, ...base, minimumMealCategories: 2 };
      case 'im_kalorienbudget':
        return { type, ...base, budgetKcal: 1800, lowerBoundKcal: 1200 };
      case 'gewogen':
        return { type, ...base };
    }
  });
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  jest.useRealTimers();
});

async function setup({ hatched = true }: { hatched?: boolean } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const haptics: HapticKind[] = [];
  const ticks = new Set<() => void>();
  const world: LaichkugelWorld = await createLaichkugelWorld(clock, {
    haptics: { feedback: (kind) => void haptics.push(kind) },
    refresh: (update) => {
      ticks.add(update);
      return () => ticks.delete(update);
    },
  });
  cleanups.push(() => world.close());
  if (hatched) {
    world.couple();
    world.hatch();
  }
  const facts = createTestFactsStore();
  const persistence = createDailyGoalPersistence({
    registry: createDailyGoalRegistry({ bausteine: Object.values(testBausteinEvaluators(facts.read)), checkIns: Object.values(testCheckInEvaluators(facts.read)) }),
    clock,
    writer: world.writer,
    dispatcher: { deliver: async () => {} },
  });
  const materialize = (localDate: LocalDate, bausteine: readonly BausteinKey[] = ['gewogen', 'wasserziel', 'sporteinheit']) =>
    world.database.transaction((tx) => {
      for (const snapshot of snapshotsOf(localDate, bausteine)) insertDailyGoalForTest(tx, dailyGoalId(philipp, localDate, snapshot.slot), snapshot);
    });
  materialize(today);

  const reactions: MomoReaction[] = [];
  const listen = () => world.game.observeReactions((next) => void reactions.push(next));

  return {
    world,
    clock,
    haptics,
    reactions,
    listen,
    materialize,
    /** Eine Eingabe auf „Heute“: Fakten setzen und den Tag in einer Transaktion auswerten. */
    enter(localDate: LocalDate, next: Partial<TestDayFacts>, cause: DailyGoalCause = 'eingabe') {
      facts.set(philipp, localDate, next);
      world.database.transaction((tx) => persistence.reevaluateDailyGoals(tx, philipp, [localDate], cause));
    },
    reevaluate(localDate: LocalDate, cause: DailyGoalCause) {
      world.database.transaction((tx) => persistence.reevaluateDailyGoals(tx, philipp, [localDate], cause));
    },
    /** Pull eines anderen eigenen Geräts oder der Server-Bestätigung: kanonische Erfüllungen samt Gutschriften. */
    pull(records: { completions: unknown[]; bookings: unknown[] }) {
      world.database.transaction((tx) => {
        for (const data of records.completions) {
          const record = dailyGoalCompletionEntity.record.parse(data);
          dailyGoalCompletionEntity.applyCanonical(tx, { entityType: 'daily_goal_completion', entityId: EntityId.parse(record.id), serverVersion: '7', data: record } as never);
        }
        for (const data of records.bookings) {
          const record = energyBookingEntity.record.parse(data);
          energyBookingEntity.applyCanonical(tx, { entityType: 'energy_booking', entityId: EntityId.parse(record.id), serverVersion: '7', data: record } as never);
        }
      });
    },
    /** Die lokalen Erfüllungen und Gutschriften eines Tags, so wie sie der Server zurückspielen würde. */
    recordsOf(localDate: LocalDate) {
      return world.database.read((tx) => ({
        completions: sqliteOf(tx).select().from(dailyGoalCompletion).all().filter((row) => row.localDate === localDate).map(({ serverVersion: _v, ...row }) => row),
        bookings: sqliteOf(tx).select().from(energyBooking).all().filter((row) => row.localDate === localDate).map(({ id, personId, type, amount, localDate: day, bookingKey, trigger, createdAt }) => ({ id, personId, type, amount, localDate: day, bookingKey, trigger, createdAt })),
      }));
    },
    tick() {
      for (const update of [...ticks]) update();
    },
    /** Momos Stimmung auf „Heute“ (`momo.character`). */
    todayMood(): MomoMood | null {
      let state: TodayState<'momo.character'> | null = null;
      world.game.momoCharacter.subscribe((next) => void (state = next))();
      const current = state as TodayState<'momo.character'> | null;
      return current?.type === 'ready' ? current.data.appearance.moodKey : null;
    },
    /** Momos Stimmung in der Inselansicht (`observeStage`). */
    islandMood(): MomoMood | null {
      let stage: IslandStage | null = null;
      world.game.observeStage((next) => void (stage = next))();
      const current = stage as IslandStage | null;
      return current?.type === 'geschluepft' ? (current.island?.appearance.moodKey ?? null) : null;
    },
  };
}

describe('Momo-Reaktionen', () => {
  it('Tracer Bullet: ein Test-Evaluator erfüllt ein Tagesziel – Momo freut sich, die Meldung kommt, die Haptik genau einmal', async () => {
    const world = await setup();
    world.listen();
    world.enter(today, { countedMl: 1500 });

    expect(world.reactions).toEqual([met('wasserziel')]);
    expect(world.haptics).toEqual(['tageszielerfuellung']);
    expect(world.todayMood()).toBe('freut_sich');

    // „kurz nach“: nach `duration-celebrate` ist Momo wieder zufrieden.
    jest.advanceTimersByTime(1_199);
    expect(world.todayMood()).toBe('freut_sich');
    jest.advanceTimersByTime(1);
    expect(world.todayMood()).toBe('zufrieden');
  });

  it('meldet nach dem Ende der Reaktion die zufriedene Stimmung an „Heute“ nach', async () => {
    const world = await setup();
    world.listen();
    const moods: (MomoMood | null)[] = [];
    world.world.game.momoCharacter.subscribe((state) => moods.push(state.type === 'ready' ? state.data.appearance.moodKey : null));
    world.enter(today, { countedMl: 1500 });
    jest.advanceTimersByTime(1_200);
    expect(moods).toEqual(['doest', 'freut_sich', 'zufrieden']);
  });

  it('genau einmal je Erfüllung trotz Re-Render, erneuter Auswertung, Pull, Retry und Neustart', async () => {
    const world = await setup();
    const stop = world.listen();
    world.enter(today, { countedMl: 1500 });
    expect(world.reactions).toHaveLength(1);

    // Re-Render: Die Oberfläche meldet sich ab und wieder an.
    stop();
    const stopAgain = world.listen();
    // Erneute Auswertung, etwa bei der App-Öffnung oder einer weiteren Eingabe.
    world.reevaluate(today, 'app_oeffnung');
    world.enter(today, { countedMl: 2000 });
    // Retry nach dauerhafter Ablehnung: Die unbestätigte Gutschrift verschwindet, die nächste Auswertung legt sie neu an.
    world.world.database.transaction((tx) => removeUnconfirmedDayCredits(tx, philipp, today));
    world.reevaluate(today, 'app_oeffnung');
    expect(world.recordsOf(today).bookings).toHaveLength(1);
    // Pull: Der Server bestätigt; der kanonische Datensatz ersetzt das lokale Duplikat.
    world.pull(world.recordsOf(today));
    stopAgain();
    // Neustart: neue Datenbankverbindung, neuer Spieldienst, dieselbe Installation.
    await world.world.restart();
    world.listen();
    world.reevaluate(today, 'app_oeffnung');

    expect(world.reactions).toEqual([met('wasserziel')]);
    expect(world.haptics).toEqual(['tageszielerfuellung']);
  });

  it('eine spätere Korrektur löst keine Reaktion aus, auch nicht beim erneuten Erfüllen', async () => {
    const world = await setup();
    world.listen();
    world.enter(today, { countedMl: 1500 });
    world.enter(today, { countedMl: 0 }, 'rueckgaengig');
    world.enter(today, { countedMl: 1500 });
    expect(world.reactions).toHaveLength(1);
    expect(world.haptics).toHaveLength(1);
  });

  it('Tagesbonus: „Alle drei geschafft“, Momo begeistert, eine Haptik für den Bonus', async () => {
    const world = await setup();
    world.listen();
    world.enter(today, { weightEntryCount: 1, countedMl: 1500 });
    world.enter(today, allFulfilled);

    // Je Commit eine Reaktion und höchstens eine Haptik: Das dritte Tagesziel und der Bonus entstehen zusammen.
    expect(world.reactions).toEqual([met('gewogen', 'wasserziel'), { yesterday: null, goals: ['sporteinheit'], bonus: true }]);
    expect(world.haptics).toEqual(['tageszielerfuellung', 'tagesbonus']);
    expect(world.todayMood()).toBe('begeistert');
  });

  it('wartet ohne Beobachter: Erfüllungen vor dem Anmelden der Oberfläche erscheinen beim Anmelden', async () => {
    const world = await setup();
    world.enter(today, { countedMl: 1500 });
    expect(world.reactions).toEqual([]);
    expect(world.haptics).toEqual([]);
    world.listen();
    expect(world.reactions).toEqual([met('wasserziel')]);
    expect(world.haptics).toEqual(['tageszielerfuellung']);
  });

  it('auch ohne Kopplung: Energie aus Tageszielen bekommt ihre Meldung', async () => {
    const world = await setup({ hatched: false });
    world.listen();
    world.enter(today, { countedMl: 1500 });
    expect(world.reactions).toEqual([met('wasserziel')]);
  });
});

describe('Tagesende-Gutschriften', () => {
  it('ergeben beim ersten Öffnen nach Mitternacht genau eine gebündelte Meldung', async () => {
    const world = await setup();
    world.materialize(yesterday, ['gewogen', 'wasserziel', 'im_kalorienbudget']);
    world.clock.set(Instant.parse('2026-10-13T18:00:00.000Z'));
    world.listen();
    world.enter(yesterday, { weightEntryCount: 1, countedMl: 1500, intakeKcal: 1500 });
    expect(world.reactions).toEqual([met('gewogen', 'wasserziel')]);
    await world.world.restart();

    // Am Morgen: Der Tagesabschluss erfüllt „Im Kalorienbudget“ für gestern und vergibt den Bonus.
    world.clock.set(Instant.parse('2026-10-14T05:00:00.000Z'));
    world.reevaluate(yesterday, 'tagesabschluss');
    world.listen();
    world.reevaluate(yesterday, 'app_oeffnung');

    expect(world.reactions.slice(1)).toEqual([{ yesterday: { energy: 2, bonus: true }, goals: [], bonus: false }]);
    expect(world.haptics).toEqual(['tageszielerfuellung', 'tagesbonus']);
    expect(world.todayMood()).toBe('begeistert');
  });

  it('ohne Bonus: nur das Kalorienbudget', async () => {
    const world = await setup();
    world.materialize(yesterday, ['gewogen', 'wasserziel', 'im_kalorienbudget']);
    world.clock.set(Instant.parse('2026-10-14T05:00:00.000Z'));
    world.listen();
    world.enter(yesterday, { intakeKcal: 1500 }, 'tagesabschluss');
    expect(world.reactions).toEqual([{ yesterday: { energy: 1, bonus: false }, goals: [], bonus: false }]);
    expect(world.haptics).toEqual(['tageszielerfuellung']);
  });
});

describe('stille Übernahme älterer Ereignisse', () => {
  it('Pull eines anderen eigenen Geräts: gestern ohne Tagesende und vorgestern still, heute mit Meldung', async () => {
    const other = await setup();
    other.materialize(twoDaysAgo, ['gewogen', 'wasserziel', 'im_kalorienbudget']);
    other.materialize(yesterday);
    other.clock.set(Instant.parse('2026-10-12T18:00:00.000Z'));
    other.enter(twoDaysAgo, { weightEntryCount: 1 });
    other.clock.set(Instant.parse('2026-10-13T05:00:00.000Z'));
    other.enter(twoDaysAgo, { weightEntryCount: 1, intakeKcal: 1500 }, 'tagesabschluss');
    other.clock.set(Instant.parse('2026-10-13T18:00:00.000Z'));
    other.enter(yesterday, { countedMl: 1500 });
    other.clock.set(noon);
    other.enter(today, { weightEntryCount: 1 });

    const world = await setup();
    world.materialize(twoDaysAgo, ['gewogen', 'wasserziel', 'im_kalorienbudget']);
    world.materialize(yesterday);
    world.listen();
    world.pull(other.recordsOf(twoDaysAgo));
    world.pull(other.recordsOf(yesterday));
    expect(world.reactions).toEqual([]);
    expect(world.haptics).toEqual([]);

    world.pull(other.recordsOf(today));
    expect(world.reactions).toEqual([met('gewogen')]);
    expect(world.world.database.read((tx) => bookingByKey(tx, dailyGoalKey(philipp, twoDaysAgo, 3)))).not.toBeNull();
    expect(world.world.database.read((tx) => bookingByKey(tx, dailyBonusKey(philipp, twoDaysAgo)))).toBeNull();
  });
});

describe('Stimmung im Spieldienst', () => {
  it('döst ohne eigene Erfüllung heute und gestern, zufrieden mit einer von gestern', async () => {
    const world = await setup();
    expect(world.todayMood()).toBe('doest');
    world.materialize(yesterday);
    world.enter(yesterday, { countedMl: 1500 });
    expect(world.todayMood()).toBe('zufrieden');
  });

  it('schläft abends nur auf der Insel; der Takt bringt die Uhrzeit nach', async () => {
    const world = await setup();
    world.enter(today, { countedMl: 1500 });
    jest.advanceTimersByTime(1_200);
    const moods: (MomoMood | null)[] = [];
    world.world.game.observeStage((stage) => moods.push(stage.type === 'geschluepft' ? (stage.island?.appearance.moodKey ?? null) : null));
    world.clock.set(Instant.parse('2026-10-14T17:59:00.000Z'));
    world.tick();
    world.clock.set(Instant.parse('2026-10-14T18:00:00.000Z'));
    world.tick();
    expect(moods).toEqual(['zufrieden', 'schlaeft']);
    expect(world.todayMood()).toBe('zufrieden');
    expect(world.islandMood()).toBe('schlaeft');
  });
});
