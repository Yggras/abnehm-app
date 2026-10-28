import { describe, expect, it } from 'vitest';

import {
  buildSeedState,
  SeedManifest,
  seedClock,
  seedIds,
  seedManifests,
  seedPassword,
  type SeedPart,
} from '../seeds/index.ts';
import { soloParts } from '../seeds/solo.ts';
import { AreaKey, LocalDate, ServerVersion } from '../src/base.ts';
import { DailyGoalSnapshot } from '../src/daily-goals.ts';
import { EnergyBooking } from '../src/energy.ts';
import { PartnerSummaryEnvelope, partnerSummaryPeriodOf, revocationNoticeId } from '../src/partner.ts';

// Nachweis für #112 und #117: Format der Seed-Manifeste, Baukasten der Bereichsbeiträge und die
// Partner-Szenarien `gekoppelt` und `nach_entkopplung`. Dass Server und Geräte die Manifeste tatsächlich
// so herstellen und erreichen, prüft `apps/backend/test/seed-partner-app.test.ts`.

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

  it('spiegeln Kopplungsdaten nur auf Geräte aktiver Mitglieder, Adressiertes nur auf das des Empfängers', () => {
    const couplingId = '5eed0040-0000-4000-8000-000000000099';
    const member = (personId: string, status: string) => ({
      table: 'coupling_member',
      couplingId,
      row: { id: `5eed0041-0000-4000-8000-0000000000${personId.endsWith('1') ? '91' : '92'}`, coupling_id: couplingId, person_id: personId, coupling_status: status },
    });
    const parts = (status: string): SeedPart[] => [
      {
        area: 'fundament',
        entities: [
          { table: 'coupling', entityType: 'coupling', couplingId, row: { id: couplingId } },
          member(philipp, status),
          member(seedIds.person.anna, status),
          { table: 'island', couplingId, row: { id: '5eed0042-0000-4000-8000-000000000099' } },
          { table: 'partner_summary', recipientPersonId: seedIds.person.anna, row: { id: '5eed0050-0000-4000-8000-000000000099' } },
        ],
      },
    ];
    const devices = { 'philipp-iphone': { personId: philipp, cursor: 'latest' }, 'anna-android': { personId: seedIds.person.anna, cursor: 'latest' } } as const;
    const tables = (state: ReturnType<typeof buildSeedState>, key: string) => Object.keys(state.devices[key]!.rows).sort();

    const active = buildSeedState({ parts: parts('aktiv'), createdAt: seedClock.instant, devices });
    expect(tables(active, 'philipp-iphone')).toEqual(['coupling', 'coupling_member', 'island']);
    expect(tables(active, 'anna-android')).toEqual(['coupling', 'coupling_member', 'island', 'partner_summary']);
    expect(active.server.change_log).toEqual([expect.objectContaining({ entity_type: 'coupling', coupling_id: couplingId, owner_person_id: null })]);
    // Nach dem Entkoppeln bleibt nur der Archivstatus, also die Kopplung selbst, sichtbar.
    const archived = buildSeedState({ parts: parts('archiviert'), createdAt: seedClock.instant, devices });
    expect(tables(archived, 'philipp-iphone')).toEqual(['coupling']);
  });
});

const gekoppelt = seedManifests.gekoppelt;
const nachEntkopplung = seedManifests.nach_entkopplung;
const anna = seedIds.person.anna;

describe('Szenario gekoppelt', () => {
  const { server } = gekoppelt.initial;
  const byId = (table: string, id: string) => server[table]?.find((row) => row.id === id);

  it('Philipp (iPhone) und Anna (Android) mit dokumentiertem Testpasswort, beide Geräte auf dem Stand des Servers', () => {
    expect(gekoppelt.accounts.map(({ email, password }) => [email, password])).toEqual([
      ['philipp@example.test', seedPassword],
      ['anna@example.test', seedPassword],
    ]);
    expect(gekoppelt.installations.map(({ key, account, platform }) => [key, account, platform])).toEqual([
      ['philipp-iphone', 'philipp', 'ios'],
      ['anna-android', 'anna', 'android'],
    ]);
    for (const device of Object.values(gekoppelt.initial.devices)) expect(device).toMatchObject({ cursor: server.sync_clock![0]!.position, outbox: [] });
    expect(gekoppelt.steps).toEqual([
      { type: 'sync', installation: 'philipp-iphone' },
      { type: 'sync', installation: 'anna-android' },
    ]);
    expect(gekoppelt.target).toEqual(gekoppelt.initial);
  });

  it('fertiges Onboarding, Ziel- und Wochenplanversionen und je drei Tagesziele von heute', () => {
    expect(server.person?.map(({ display_name, onboarding_status }) => [display_name, onboarding_status])).toEqual([
      ['Philipp', 'abgeschlossen'],
      ['Anna', 'abgeschlossen'],
    ]);
    for (const personId of [philipp, anna]) {
      expect(server.goal_version?.filter((row) => row.person_id === personId)).toHaveLength(1);
      expect(server.weekly_plan_day?.filter((row) => row.person_id === personId)).toHaveLength(7);
      const goals = server.daily_goal?.filter((row) => row.person_id === personId) ?? [];
      expect(goals.map(({ local_date, slot }) => [local_date, slot])).toEqual([
        ['2026-10-14', 1],
        ['2026-10-14', 2],
        ['2026-10-14', 3],
      ]);
      for (const goal of goals) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
    }
  });

  it('teilweise erfüllte Tracker: Philipp eine, Anna zwei Tageszielerfüllungen, jede mit +1-Gutschrift', () => {
    const completions = (personId: string) => server.daily_goal_completion?.filter((row) => row.person_id === personId) ?? [];
    expect(completions(philipp).map(({ baustein }) => baustein)).toEqual(['sporteinheit']);
    expect(completions(anna).map(({ baustein }) => baustein).sort()).toEqual(['sporteinheit', 'wasserziel']);
    for (const completion of server.daily_goal_completion ?? []) {
      const bookings = server.energy_booking?.filter((row) => row.daily_goal_completion_id === completion.id) ?? [];
      expect(bookings).toHaveLength(1);
      const { id, person_id, type, amount, local_date, booking_key, trigger, created_at } = bookings[0]!;
      const booking = { id, personId: person_id, type, amount, localDate: local_date, bookingKey: booking_key, trigger, createdAt: created_at };
      expect(EnergyBooking.safeParse(booking).success).toBe(true);
    }
  });

  it('aktive Kopplung, Philipp baut, Anna ist Natur, die Insel ist geschlüpft', () => {
    expect(server.coupling).toEqual([expect.objectContaining({ id: seedIds.coupling.philippAnna, status: 'aktiv', ended_at: null })]);
    expect(server.coupling_member?.map(({ person_id, role, display_name }) => [person_id, role, display_name])).toEqual([
      [philipp, 'bauen', 'Philipp'],
      [anna, 'natur', 'Anna'],
    ]);
    expect(server.island).toEqual([expect.objectContaining({ state: 'aktiv', hatched_at: expect.any(String), time_zone: 'Europe/Berlin' })]);
  });

  it('Philipp teilt alle vier Bereiche, Anna hält Ernährung privat; beide teilen ihre Fotos', () => {
    const levels = (personId: string) =>
      Object.fromEntries((server.partner_sharing ?? []).filter((row) => row.owner_person_id === personId).map((row) => [row.area, row.level]));
    expect(levels(philipp)).toEqual({ ernaehrung: 'zusammengefasst', wasser: 'zusammengefasst', sport: 'zusammengefasst', gewicht: 'zusammengefasst' });
    expect(levels(anna)).toEqual({ ernaehrung: 'privat', wasser: 'zusammengefasst', sport: 'zusammengefasst', gewicht: 'zusammengefasst' });
    expect(server.photo_sharing?.map(({ owner_person_id, level }) => [owner_person_id, level])).toEqual([
      [philipp, 'geteilt'],
      [anna, 'geteilt'],
    ]);
  });

  it('Zusammenfassungen nur für freigegebene Bereiche, grober Tageszielstand passend zu den Erfüllungen, alles gültig für den Partner', () => {
    const areas = (ownerId: string) => (server.partner_summary ?? []).filter((row) => row.owner_person_id === ownerId).map((row) => row.area);
    expect(areas(philipp)).toEqual(['ernaehrung', 'wasser', 'sport', 'gewicht']);
    expect(areas(anna)).toEqual(['wasser', 'sport', 'gewicht']);
    for (const row of server.partner_summary ?? []) {
      const envelope = {
        type: row.area,
        id: row.id,
        generation: row.generation,
        ownerPersonId: row.owner_person_id,
        recipientPersonId: row.recipient_person_id,
        couplingId: row.coupling_id,
        period: partnerSummaryPeriodOf(AreaKey.parse(row.area), LocalDate.parse(row.period_from), LocalDate.parse(row.period_to)),
        dataAsOf: row.data_as_of,
        serverVersion: row.server_version,
        content: row.content,
      };
      expect(PartnerSummaryEnvelope.safeParse(envelope).success, String(row.area)).toBe(true);
    }
    expect(byId('partner_daily_goal_status', seedIds.partnerDailyGoalStatus.philipp)).toMatchObject({ recipient_person_id: anna, stage: 'unterwegs' });
    expect(byId('partner_daily_goal_status', seedIds.partnerDailyGoalStatus.anna)).toMatchObject({ recipient_person_id: philipp, stage: 'fast_geschafft' });
  });

  it('kein Gerät erhält fremde Gesundheits-Rohdaten, Freigaben oder Fotos des Partners', () => {
    const ownerColumns = ['person_id', 'owner_person_id', 'recipient_person_id'];
    for (const [key, own] of [['philipp-iphone', philipp], ['anna-android', anna]] as const) {
      const { rows } = gekoppelt.initial.devices[key]!;
      for (const [table, tableRows] of Object.entries(rows)) {
        if (['coupling_member', 'partner_summary', 'partner_daily_goal_status'].includes(table)) continue;
        for (const row of tableRows) {
          for (const column of ownerColumns) if (column in row) expect(row[column], `${key}: ${table}.${column}`).toBe(own);
        }
      }
      expect(rows.person?.map(({ id }) => id)).toEqual([own]);
      // Zusammenfassungen und Tageszielstand nur als an das Gerät adressierte Projektion.
      for (const table of ['partner_summary', 'partner_daily_goal_status']) {
        for (const row of rows[table] ?? []) expect(row.recipient_person_id).toBe(own);
      }
    }
  });

  it('reserviert versionierte Erweiterungspunkte für die Fotodaten (#162) und das Deko-Geschenk (#198)', () => {
    expect(gekoppelt.extensions?.mealPhotos).toEqual({
      version: 1,
      photos: [
        { id: seedIds.mealPhoto.philippHeute, account: 'philipp', nutritionEntryId: seedIds.nutritionEntry.philippMittag, visibleTo: ['anna'] },
        { id: seedIds.mealPhoto.annaHeute, account: 'anna', nutritionEntryId: seedIds.nutritionEntry.annaMittag, visibleTo: ['philipp'] },
      ],
    });
    for (const photo of server.meal_photo ?? []) expect(photo).toMatchObject({ shared_with_partner: true, deleted_at: null });
    expect(gekoppelt.extensions?.decoGift).toEqual({ version: 1, state: 'reserviert', actionId: seedIds.sharedAction.dekoGeschenk, from: 'anna', to: 'philipp' });
    expect(server.shared_action).toBeUndefined();
  });

  it('prüft die Erweiterungspunkte: Fotos müssen samt Eintrag existieren, eine reservierte ID bleibt frei', () => {
    const issues = (manifest: unknown) => SeedManifest.safeParse(manifest).error?.issues.map(({ message }) => message);
    const unknownPhoto = '5eed0032-0000-4000-8000-000000000099';
    const photos = { version: 1, photos: [{ id: unknownPhoto, account: 'anna', nutritionEntryId: seedIds.nutritionEntry.annaMittag, visibleTo: ['niemand'] }] };
    expect(issues({ ...gekoppelt, extensions: { mealPhotos: photos } })).toEqual([
      `Mahlzeitenfoto ${unknownPhoto}: unbekanntes Konto niemand`,
      `Mahlzeitenfoto ${unknownPhoto} fehlt im Ausgangszustand`,
      `Mahlzeitenfoto ${unknownPhoto}: Ernährungseintrag ${seedIds.nutritionEntry.annaMittag} fehlt`,
    ]);
    const used = { ...gekoppelt.extensions?.decoGift, actionId: seedIds.coupling.philippAnna };
    expect(issues({ ...gekoppelt, extensions: { decoGift: used } })).toEqual([
      'initial: reservierte ID des Deko-Geschenks ist belegt',
      'target: reservierte ID des Deko-Geschenks ist belegt',
    ]);
  });
});

describe('Szenario nach_entkopplung', () => {
  const step = nachEntkopplung.steps[0];
  const before = gekoppelt.initial.server;
  const { server, devices } = nachEntkopplung.target;
  const last = Number(before.sync_clock![0]!.position);

  it('startet im Zustand von gekoppelt; Anna entkoppelt über den Kern, danach synchronisieren beide Geräte', () => {
    expect(nachEntkopplung.initial).toEqual(gekoppelt.initial);
    expect(nachEntkopplung.steps).toEqual([
      { type: 'entkoppeln', account: 'anna', couplingId: seedIds.coupling.philippAnna, actionId: seedIds.sharedAction.annasEntkopplung, at: seedClock.instant },
      { type: 'sync', installation: 'philipp-iphone' },
      { type: 'sync', installation: 'anna-android' },
    ]);
    expect(SeedManifest.safeParse({ ...nachEntkopplung, steps: [{ ...step, account: 'niemand' }] }).error?.issues[0]?.message).toBe(
      'Schritt entkoppeln: unbekanntes Konto niemand',
    );
  });

  it('Sollzustand in Postgres: Kopplung und Insel archiviert, Projektionen gelöscht, Notices an beide früheren Empfänger', () => {
    expect(server.coupling).toEqual([expect.objectContaining({ status: 'archiviert', ended_at: seedClock.instant, server_version: String(last + 1) })]);
    expect(server.coupling_member?.map(({ coupling_status }) => coupling_status)).toEqual(['archiviert', 'archiviert']);
    expect(server.island).toEqual([expect.objectContaining({ state: 'archiviert', server_version: String(last + 2) })]);
    expect(server.shared_action).toEqual([expect.objectContaining({ kind: 'entkoppeln', status: 'angenommen', requester_person_id: anna })]);
    for (const table of ['partner_summary', 'partner_daily_goal_status']) {
      expect(server[table]?.every(({ deleted_at }) => deleted_at === seedClock.instant)).toBe(true);
    }
    expect(server.revocation_notice?.map(({ id, recipient_person_id, server_version }) => [recipient_person_id, id === revocationNoticeId(ServerVersion.parse(server_version))])).toEqual([
      [philipp, true],
      [anna, true],
    ]);
    // Lückenlose Positionen: jede neue Version genau einmal im Änderungsprotokoll.
    const added = server.change_log!.slice(before.change_log!.length).map(({ position }) => Number(position));
    expect(added).toEqual(added.map((_, index) => last + index + 1));
    expect(server.sync_clock).toEqual([{ id: 1, position: String(last + added.length) }]);
  });

  it('Sollzustand der Geräte: archivierte Kopplung, Partnercache leer, eigene Daten unverändert', () => {
    for (const [key, device] of Object.entries(devices)) {
      const initial = gekoppelt.initial.devices[key]!;
      expect(device.cursor).toBe(server.sync_clock![0]!.position);
      expect(device.rows.coupling).toEqual(server.coupling);
      expect(device.rows.partner_summary).toEqual([]);
      expect(device.rows.partner_daily_goal_status).toEqual([]);
      // Insel und Freigaben kommen nach dem Entkoppeln nicht mehr an; das Gerät behält seinen Stand.
      for (const table of ['person', 'island', 'partner_sharing', 'daily_goal_completion', 'energy_booking']) expect(device.rows[table]).toEqual(initial.rows[table]);
    }
  });
});
