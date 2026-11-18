import { describe, expect, it } from 'vitest';

import { seedClock, seedDays, seedManifests, type SeedRow, type SeedScenarioKey } from '../seeds/index.ts';
import { DailyGoalSnapshot } from '../src/daily-goals.ts';
import { MaterializeDailyGoals } from '../src/plan.ts';

// Nachweis für #131 auf Manifest-Ebene: „Tage ohne App-Öffnung“ und „Zeitzonen“ (Spezifikation 1,
// Abschnitt 12) beschreiben, was sie heißen. Dass das Plan-Modul auf dem Gerät tatsächlich so
// materialisiert und das wiederholte Seeden idempotent ist, prüft `apps/backend/test/seed-manifeste-app.test.ts`.

const iphone = 'philipp-iphone';

const rowsOf = (scenario: SeedScenarioKey, state: 'initial' | 'target', table: string, side: 'server' | typeof iphone = iphone): SeedRow[] => {
  const manifest = seedManifests[scenario];
  return (side === 'server' ? manifest[state].server[table] : manifest[state].devices[side]!.rows[table]) ?? [];
};
const daysOf = (rows: readonly SeedRow[]) => [...new Set(rows.map((row) => String(row.local_date)))].sort();
const endOf = (rows: readonly SeedRow[], localDate: string) => String(rows.find((row) => row.local_date === localDate)!.day_ends_at);
const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

describe.each(['tage_ohne_app_oeffnung', 'zeitzonen_reisen'] as const)('%s', (scenario) => {
  const manifest = seedManifests[scenario];

  it('nutzt Philipp allein, die feste Uhr und gültige Snapshots mit IDs aus Person, Tag und Platz', () => {
    expect(manifest.clock).toEqual(seedClock);
    expect(manifest.accounts.map(({ key }) => key)).toEqual(['philipp']);
    expect(manifest.installations.map(({ key }) => key)).toEqual([iphone]);
    for (const goal of rowsOf(scenario, 'target', 'daily_goal')) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    for (const operation of manifest.target.devices[iphone]!.outbox) {
      if (operation.type === 'materializeDailyGoals') expect(MaterializeDailyGoals.safeParse(operation.payload).success).toBe(true);
    }
  });

  it('lässt den Server unverändert und materialisierte Tage, wie sie sind; neue Tage sind lokal und unbestätigt', () => {
    expect(manifest.target.server).toEqual(manifest.initial.server);
    const before = rowsOf(scenario, 'initial', 'daily_goal');
    const after = rowsOf(scenario, 'target', 'daily_goal');
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).every((row) => row.server_version === null)).toBe(true);
    expect(manifest.steps.every((step) => step.type === 'tagesziele_sicherstellen')).toBe(true);
  });
});

describe('tage_ohne_app_oeffnung', () => {
  const scenario = 'tage_ohne_app_oeffnung';

  it('legt bei der App-Öffnung genau die letzten 7 lokalen Tage an; der 06. und 07.10. bleiben ohne Tagesziele', () => {
    expect(seedManifests[scenario].steps).toEqual([expect.objectContaining({ type: 'tagesziele_sicherstellen', installation: iphone })]);
    expect(daysOf(rowsOf(scenario, 'initial', 'daily_goal'))).toEqual(['2026-10-05']);
    expect(daysOf(rowsOf(scenario, 'target', 'daily_goal'))).toEqual([
      '2026-10-05', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', seedDays.heute,
    ]);
  });

  it('Wasser im Fenster erfüllt das Wasserziel beim Tagesabschluss, Wasser davor zählt nur für den Tracker', () => {
    expect(rowsOf(scenario, 'target', 'water_entry').map((row) => row.local_date)).toEqual(['2026-10-07', '2026-10-10']);
    expect(rowsOf(scenario, 'target', 'daily_goal_completion').map((row) => [row.local_date, row.slot, row.baustein])).toEqual([['2026-10-10', 2, 'wasserziel']]);
    expect(rowsOf(scenario, 'target', 'energy_booking').map((row) => row.booking_key)).toEqual([`tagesziel:${seedManifests[scenario].accounts[0]!.personId}:2026-10-10:2`]);
    expect(seedManifests[scenario].target.devices[iphone]!.outbox.map((operation) => [operation.type, 'payload' in operation ? operation.payload.localDate : null])).toEqual([
      ...['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', seedDays.heute].map((day) => ['materializeDailyGoals', day]),
      ['completeDailyGoal', '2026-10-10'],
    ]);
  });
});

describe('zeitzonen_reisen', () => {
  const scenario = 'zeitzonen_reisen';
  const goals = rowsOf(scenario, 'target', 'daily_goal');
  const zoneOf = (localDate: string) => goals.find((row) => row.local_date === localDate)!.time_zone;

  it('legt nach Reisen neue Tage in der Zone des Geräts an; die Tage in Berlin behalten Zone und Tagesende', () => {
    expect(seedManifests[scenario].steps.map((step) => ('timeZone' in step ? step.timeZone : null))).toEqual(['Asia/Tokyo', 'America/New_York', 'Europe/Berlin', 'Europe/Berlin']);
    expect([zoneOf('2026-10-14'), endOf(goals, '2026-10-14')]).toEqual(['Europe/Berlin', '2026-10-14T22:00:00.000Z']);
    expect([zoneOf('2026-10-15'), endOf(goals, '2026-10-15')]).toEqual(['Asia/Tokyo', '2026-10-15T15:00:00.000Z']);
    expect([zoneOf('2026-10-16'), endOf(goals, '2026-10-16')]).toEqual(['America/New_York', '2026-10-17T04:00:00.000Z']);
  });

  it('gibt dem 25.10.2026 25 und dem 28.03.2027 23 Stunden in Berlin', () => {
    expect(hours(endOf(goals, '2026-10-24'), endOf(goals, '2026-10-25'))).toBe(25);
    expect(hours(endOf(goals, '2027-03-27'), endOf(goals, '2027-03-28'))).toBe(23);
  });

  it('holt nur im 7-Tage-Fenster nach: Der 17. und 18.10. und der 21.03.2027 bleiben ohne Tagesziele', () => {
    const days = daysOf(goals);
    expect(days.filter((day) => day > '2026-10-16' && day < '2026-10-19')).toEqual([]);
    expect(days.filter((day) => day >= '2027-03-01')).toEqual(['2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27', '2027-03-28']);
  });
});
