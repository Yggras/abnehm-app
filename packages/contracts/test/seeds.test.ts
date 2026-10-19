import { describe, expect, it } from 'vitest';

import {
  buildSeedState,
  SeedManifest,
  seedClock,
  seedIds,
  seedManifests,
  type SeedPart,
} from '../seeds/index.ts';
import { soloParts } from '../seeds/solo.ts';
import { DailyGoalSnapshot } from '../src/daily-goals.ts';

// Nachweis für #112: Format der Seed-Manifeste und Baukasten der Bereichsbeiträge.

const solo = seedManifests.solo;
const philipp = seedIds.person.philipp;

describe('Seed-Manifest', () => {
  it('enthält feste Uhr, Zone, lokale Tage, Katalogversion, Konten, Installationen, Ausgangs- und Sollzustand', () => {
    expect(solo.formatVersion).toBe(1);
    expect(solo.clock).toEqual({ instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin' });
    expect(solo.localDates.heute).toBe('2026-10-14');
    expect(solo).toHaveProperty('catalogVersion', null);
    expect(solo.accounts.map(({ email }) => email)).toEqual(['philipp@example.test']);
    expect(solo.installations).toEqual([expect.objectContaining({ key: 'philipp-iphone', platform: 'ios' })]);
    expect(solo.initial.devices['philipp-iphone']).toEqual(expect.objectContaining({ cursor: expect.any(String), outbox: [] }));
    expect(solo.steps).toEqual([{ type: 'sync', installation: 'philipp-iphone' }]);
    expect(solo.target).toEqual(solo.initial);
  });

  it('vergibt Serverversionen lückenlos, führt Sync-Clock und Cursor auf die letzte Position', () => {
    const versioned = Object.entries(solo.initial.server)
      .filter(([table]) => table !== 'change_log' && table !== 'sync_clock')
      .flatMap(([, rows]) => rows.map((row) => row.server_version))
      .filter((version) => version !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
    expect(versioned).toEqual(versioned.map((_, index) => index + 1));
    expect(solo.initial.server.sync_clock).toEqual([{ id: 1, position: String(versioned.length) }]);
    expect(solo.initial.devices['philipp-iphone']!.cursor).toBe(String(versioned.length));
  });

  it('schreibt das Änderungsprotokoll nur für beim Sync angemeldete Entitäten', () => {
    expect(solo.initial.server.change_log).toEqual([
      expect.objectContaining({ entity_type: 'person', entity_id: philipp, owner_person_id: philipp, operation: 'upsert' }),
    ]);
  });

  it('solo: fertige Person ohne Kopplung und ohne Insel, mit Zielen, Wochenplan, drei Tageszielen und eigenen Daten', () => {
    const { server } = solo.initial;
    expect(server.person).toEqual([expect.objectContaining({ onboarding_status: 'abgeschlossen', display_name: 'Philipp' })]);
    for (const table of ['coupling', 'coupling_member', 'island']) expect(server[table]).toBeUndefined();
    expect(server.goal_version).toHaveLength(1);
    expect(server.weekly_plan_day).toHaveLength(7);
    expect(server.daily_goal?.map((goal) => [goal.local_date, goal.slot])).toEqual([
      ['2026-10-14', 1],
      ['2026-10-14', 2],
      ['2026-10-14', 3],
    ]);
    for (const goal of server.daily_goal ?? []) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    for (const table of ['water_entry', 'sport_entry', 'weight_entry']) expect(server[table]?.length).toBeGreaterThan(0);
    // Das iPhone spiegelt alle eigenen Zeilen.
    const device = solo.initial.devices['philipp-iphone']!.rows;
    expect(Object.keys(device).sort()).toEqual(Object.keys(server).filter((table) => !['change_log', 'sync_clock'].includes(table)).sort());
  });

  it('lässt nur synthetische .test-Konten zu', () => {
    const account = { ...solo.accounts[0]!, email: 'philipp@example.com' };
    expect(SeedManifest.safeParse({ ...solo, accounts: [account] }).success).toBe(false);
  });

  it('lehnt E-Mails außerhalb der Konten ab, auch in Gerätezeilen', () => {
    const person = { ...solo.initial.server.person![0]!, display_name: 'philipp@example.test' };
    const server = { ...solo.initial.server, person: [person] };
    expect(SeedManifest.safeParse({ ...solo, initial: { ...solo.initial, server } }).error?.issues[0]?.message).toBe(
      'initial: E-Mail-Adresse außerhalb der Konten',
    );
    const devices = { 'philipp-iphone': { ...solo.target.devices['philipp-iphone']!, rows: { person: [person] } } };
    expect(SeedManifest.safeParse({ ...solo, target: { ...solo.target, devices } }).success).toBe(false);
  });

  it('lehnt Better-Auth-Zeilen, unbekannte Installationen und doppelte Konten ab', () => {
    const issues = (manifest: unknown) => SeedManifest.safeParse(manifest).error?.issues.map(({ message }) => message);
    expect(issues({ ...solo, initial: { ...solo.initial, server: { ...solo.initial.server, session: [] } } })).toEqual([
      'initial: session entsteht aus den Konten, nicht aus Zeilen',
    ]);
    expect(issues({ ...solo, steps: [{ type: 'sync', installation: 'anna-android' }] })).toEqual([
      'Schritt sync: unbekannte Installation anna-android',
    ]);
    expect(issues({ ...solo, accounts: [solo.accounts[0], solo.accounts[0]] })).toContain(`Konto doppelt: key philipp`);
  });
});

describe('Bereichsbeiträge', () => {
  const extra: SeedPart = {
    area: 'ernaehrung',
    entities: [
      {
        table: 'own_food',
        ownerPersonId: philipp,
        row: { id: '5eed0030-0000-4000-8000-000000000001', person_id: philipp },
      },
    ],
  };
  const build = (parts: readonly SeedPart[]) =>
    buildSeedState({ parts, createdAt: seedClock.instant, devices: { 'philipp-iphone': { personId: philipp, cursor: 'latest' } } });

  it('ergänzen ein Szenario unter Wiederverwendung der gemeinsamen IDs, ohne bestehende Versionen zu verschieben', () => {
    const base = build(soloParts);
    const extended = build([...soloParts, extra]);
    expect(extended.server.own_food).toEqual([expect.objectContaining({ person_id: philipp, server_version: String(Number(base.server.sync_clock![0]!.position) + 1) })]);
    expect(extended.server.person).toEqual(base.server.person);
    expect(extended.devices['philipp-iphone']!.rows.own_food).toEqual(extended.server.own_food);
  });

  it('dürfen keine belegte ID überschreiben', () => {
    const duplicate: SeedPart = { area: 'ernaehrung', entities: [{ table: 'person', ownerPersonId: philipp, row: { id: philipp } }] };
    expect(() => build([...soloParts, duplicate])).toThrow(`ernaehrung: person ${philipp} ist schon belegt`);
  });

  it('spiegeln fremde Entitäten nicht auf ein Gerät', () => {
    const foreign: SeedPart = { area: 'tracker', entities: [{ table: 'water_entry', ownerPersonId: seedIds.person.anna, row: { id: '5eed0020-0000-4000-8000-000000000099' } }] };
    expect(build([foreign]).devices['philipp-iphone']!.rows).toEqual({});
  });
});
