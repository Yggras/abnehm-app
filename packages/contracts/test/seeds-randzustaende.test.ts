import { describe, expect, it } from 'vitest';

import { seedClock, seedDays, seedIds, seedManifests, SeedManifest, type SeedRow, type SeedScenarioKey } from '../seeds/index.ts';
import { DailyGoalSnapshot } from '../src/daily-goals.ts';
import { EnergyBooking } from '../src/energy.ts';
import { countedWaterMl } from '../src/tracker-rules.ts';

// Nachweis für #113 auf Manifest-Ebene: Die Randzustände beschreiben, was sie heißen. Dass Server und
// Geräte sie über die echten Operationen tatsächlich so erreichen, prüft
// `apps/backend/test/seed-manifeste-app.test.ts`, Fachliches dazu `seed-randzustaende-app.test.ts`.

const philipp = seedIds.person.philipp;
const iphone = 'philipp-iphone';

const rowsOf = (scenario: SeedScenarioKey, state: 'initial' | 'target', table: string, side: 'server' | typeof iphone = iphone): SeedRow[] => {
  const manifest = seedManifests[scenario];
  return (side === 'server' ? manifest[state].server[table] : manifest[state].devices[side]!.rows[table]) ?? [];
};
const waterOf = (rows: readonly SeedRow[], localDate: string) =>
  countedWaterMl(rows.map((row) => ({ amountMl: Number(row.amount_ml), localDate: String(row.local_date), deletedAt: row.deleted_at === null ? null : String(row.deleted_at) })), localDate);
const completedSlots = (rows: readonly SeedRow[], localDate: string) => rows.filter((row) => row.local_date === localDate).map((row) => row.slot).sort();
const bookingTypes = (rows: readonly SeedRow[]) => rows.map((row) => `${String(row.type)}:${String(row.local_date)}`).sort();

describe('Randzustände der Tagesziele (#113)', () => {
  const randzustaende = ['leer', 'teilweise', 'erfuellt', 'nach_erfuellung_korrigiert', 'tagesende_offen', 'tagesende_abgeschlossen'] as const;

  it.each(randzustaende)('%s: Philipp allein mit fester Uhr, Kalorienbudget heute auf Platz 1 und gültigen Snapshots', (scenario) => {
    const manifest = seedManifests[scenario];
    expect(manifest.clock).toEqual(seedClock);
    expect(manifest.accounts.map(({ key }) => key)).toEqual(['philipp']);
    expect(manifest.installations.map(({ key }) => key)).toEqual([iphone]);
    const today = rowsOf(scenario, 'initial', 'daily_goal', 'server').filter((goal) => goal.local_date === seedDays.heute);
    expect(today.map((goal) => goal.baustein)).toEqual(['im_kalorienbudget', 'wasserziel', 'sporteinheit']);
    for (const goal of rowsOf(scenario, 'initial', 'daily_goal', 'server')) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    for (const booking of rowsOf(scenario, 'target', 'energy_booking')) {
      const { local_date, booking_key, person_id, created_at, ...rest } = booking;
      expect(EnergyBooking.safeParse({
        id: rest.id, personId: person_id, type: rest.type, amount: rest.amount, localDate: local_date, bookingKey: booking_key, createdAt: created_at, trigger: rest.trigger,
      }).success).toBe(true);
    }
  });

  it.each(['leer', 'teilweise'] as const)('%s: keine Erfüllung; die App-Öffnung ändert nichts', (scenario) => {
    const manifest = seedManifests[scenario];
    expect(manifest.steps).toEqual([{ type: 'tagesziele_auswerten', installation: iphone, localDates: [seedDays.heute], cause: 'app_oeffnung', operationIds: [] }]);
    expect(manifest.target).toEqual(manifest.initial);
    expect(rowsOf(scenario, 'initial', 'daily_goal_completion', 'server')).toEqual([]);
  });

  it('leer: heute weder Wasser noch Sport noch Mahlzeiten', () => {
    for (const table of ['water_entry', 'sport_entry', 'nutrition_entry']) {
      expect(rowsOf('leer', 'initial', table, 'server').filter((row) => row.local_date === seedDays.heute)).toEqual([]);
    }
  });

  it('teilweise: Wasser und Sport heute knapp unter der Schwelle', () => {
    expect(waterOf(rowsOf('teilweise', 'initial', 'water_entry', 'server'), seedDays.heute)).toBe(1_250);
    expect(rowsOf('teilweise', 'initial', 'sport_entry', 'server').filter((row) => row.local_date === seedDays.heute).map((row) => row.duration_minutes)).toEqual([15]);
  });

  it('erfuellt: genau auf dem Wasserziel; die App-Öffnung legt eine Erfüllung samt +1 lokal an und schreibt ihren Fachbefehl', () => {
    const manifest = seedManifests.erfuellt;
    expect(waterOf(rowsOf('erfuellt', 'initial', 'water_entry', 'server'), seedDays.heute)).toBe(2_500);
    expect(manifest.target.server).toEqual(manifest.initial.server);
    expect(completedSlots(rowsOf('erfuellt', 'target', 'daily_goal_completion'), seedDays.heute)).toEqual([2]);
    expect(rowsOf('erfuellt', 'target', 'daily_goal_completion').every((row) => row.server_version === null && row.first_completed_at === seedClock.instant)).toBe(true);
    expect(bookingTypes(rowsOf('erfuellt', 'target', 'energy_booking'))).toEqual([`daily_goal_credit:${seedDays.heute}`]);
    expect(manifest.target.devices[iphone]!.outbox.map(({ type, operationId }) => [type, operationId])).toEqual([['completeDailyGoal', seedIds.operation.erfuellt[0]]]);
  });

  it('nach_erfuellung_korrigiert: Erfüllung und +1 bleiben, Wasser fällt unter das Ziel, keine Gegenbuchung', () => {
    const manifest = seedManifests.nach_erfuellung_korrigiert;
    // Ausgangszustand: Der Server kennt die Löschung schon, das iPhone noch nicht.
    expect(waterOf(rowsOf('nach_erfuellung_korrigiert', 'initial', 'water_entry', 'server'), seedDays.heute)).toBe(2_000);
    expect(waterOf(rowsOf('nach_erfuellung_korrigiert', 'initial', 'water_entry'), seedDays.heute)).toBe(2_500);
    expect(manifest.steps).toEqual([{ type: 'sync', installation: iphone }]);

    expect(waterOf(rowsOf('nach_erfuellung_korrigiert', 'target', 'water_entry'), seedDays.heute)).toBe(2_000);
    expect(manifest.target.server).toEqual(manifest.initial.server);
    for (const table of ['daily_goal_completion', 'energy_booking']) {
      expect(rowsOf('nach_erfuellung_korrigiert', 'target', table)).toEqual(rowsOf('nach_erfuellung_korrigiert', 'initial', table));
    }
    expect(completedSlots(rowsOf('nach_erfuellung_korrigiert', 'target', 'daily_goal_completion'), seedDays.heute)).toEqual([2]);
    expect(rowsOf('nach_erfuellung_korrigiert', 'target', 'energy_booking').some((row) => row.type === 'counter_booking')).toBe(false);
    expect(manifest.target.devices[iphone]!.outbox).toEqual([]);
  });

  it('tagesende_offen: Wasser und Sport erfüllt, das Kalorienbudget wartet aufs Tagesende und mit ihm der Tagesbonus', () => {
    const manifest = seedManifests.tagesende_offen;
    expect(Date.parse(seedClock.instant)).toBeLessThan(Date.parse(String(rowsOf('tagesende_offen', 'initial', 'daily_goal', 'server')[0]!.day_ends_at)));
    expect(completedSlots(rowsOf('tagesende_offen', 'target', 'daily_goal_completion'), seedDays.heute)).toEqual([2, 3]);
    expect(bookingTypes(rowsOf('tagesende_offen', 'target', 'energy_booking'))).toEqual([`daily_goal_credit:${seedDays.heute}`, `daily_goal_credit:${seedDays.heute}`]);
    expect(manifest.target.devices[iphone]!.outbox.map(({ type }) => type)).toEqual(['completeDailyGoal', 'completeDailyGoal']);
  });

  it('tagesende_abgeschlossen: Der Tagesabschluss für gestern erfüllt das Kalorienbudget und vergibt den Tagesbonus', () => {
    const manifest = seedManifests.tagesende_abgeschlossen;
    const gestern = rowsOf('tagesende_abgeschlossen', 'initial', 'daily_goal', 'server').filter((goal) => goal.local_date === seedDays.gestern);
    expect(gestern.map((goal) => goal.baustein)).toEqual(['im_kalorienbudget', 'wasserziel', 'sporteinheit']);
    expect(Date.parse(String(gestern[0]!.day_ends_at))).toBeLessThanOrEqual(Date.parse(seedClock.instant));
    const intakeKcal = rowsOf('tagesende_abgeschlossen', 'initial', 'nutrition_entry', 'server')
      .filter((row) => row.local_date === seedDays.gestern)
      .reduce((sum, row) => sum + Number(row.total_milli_kcal), 0) / 1_000;
    expect(intakeKcal).toBe(2_010);
    expect(gestern[0]!.snapshot).toMatchObject({ lowerBoundKcal: 1_882, budgetKcal: 2_417 });

    expect(completedSlots(rowsOf('tagesende_abgeschlossen', 'initial', 'daily_goal_completion', 'server'), seedDays.gestern)).toEqual([2, 3]);
    expect(manifest.steps).toEqual([expect.objectContaining({ type: 'tagesziele_auswerten', localDates: [seedDays.gestern], cause: 'tagesabschluss' })]);
    expect(completedSlots(rowsOf('tagesende_abgeschlossen', 'target', 'daily_goal_completion'), seedDays.gestern)).toEqual([1, 2, 3]);
    expect(bookingTypes(rowsOf('tagesende_abgeschlossen', 'target', 'energy_booking'))).toEqual([
      `daily_bonus_credit:${seedDays.gestern}`, `daily_goal_credit:${seedDays.gestern}`, `daily_goal_credit:${seedDays.gestern}`, `daily_goal_credit:${seedDays.gestern}`,
    ]);
    expect(manifest.target.devices[iphone]!.outbox.map(({ type }) => type)).toEqual(['completeDailyGoal', 'grantDailyBonus']);
  });

  it('Operations-IDs eines Manifests sind eindeutig', () => {
    const manifest = seedManifests.tagesende_abgeschlossen;
    const [step] = manifest.steps;
    const twice = { ...manifest, steps: [step, step] };
    expect(SeedManifest.safeParse(twice).error?.issues.map(({ message }) => message)).toContain(`Operations-ID doppelt: ${seedIds.operation.tagesendeAbgeschlossen[0]}`);
  });
});

describe('Randzustand veralteter_partnerstand (#113)', () => {
  const manifest = seedManifests.veralteter_partnerstand;
  const statusOf = (state: 'initial' | 'target', side: 'philipp-iphone' | 'anna-android') =>
    manifest[state].devices[side]!.rows.partner_daily_goal_status!.find((row) => row.owner_person_id === seedIds.person.anna);

  it('Philipp sieht Annas Stand von 06:30 UTC; sein Sync rechnet ihren Tageszielstand zur Uhr neu', () => {
    expect(manifest.steps).toEqual([{ type: 'sync', installation: 'philipp-iphone' }]);
    expect(statusOf('initial', 'philipp-iphone')).toMatchObject({ stage: 'unterwegs', data_as_of: '2026-10-14T06:30:00.000Z' });
    expect(statusOf('target', 'philipp-iphone')).toMatchObject({
      id: seedIds.partnerDailyGoalStatus.anna, stage: 'fast_geschafft', data_as_of: seedClock.instant, generation: 1,
    });
    // Annas Erfüllungen von heute: Sport um 06:16 UTC, Wasser um 11:30 UTC.
    expect(rowsOf('veralteter_partnerstand', 'initial', 'daily_goal_completion', 'server').filter((row) => row.person_id === seedIds.person.anna)).toHaveLength(2);
  });

  it('nur der Tageszielstand ist neu; Zusammenfassungen bleiben ohne Projectors der Bereiche alt, Anna synchronisiert nicht', () => {
    const summaries = (state: 'initial' | 'target') => manifest[state].devices['philipp-iphone']!.rows.partner_summary;
    expect(summaries('target')).toEqual(summaries('initial'));
    expect(manifest.target.devices['anna-android']).toEqual(manifest.initial.devices['anna-android']);
    const changed = manifest.target.server.change_log!.slice(manifest.initial.server.change_log!.length);
    expect(changed).toEqual([expect.objectContaining({ entity_type: 'partner_daily_goal_status', entity_id: seedIds.partnerDailyGoalStatus.anna, recipient_person_id: philipp })]);
    expect(manifest.target.devices['philipp-iphone']!.cursor).toBe(manifest.target.server.sync_clock![0]!.position);
  });
});
