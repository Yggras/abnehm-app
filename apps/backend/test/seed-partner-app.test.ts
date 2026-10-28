import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, type AreaKey } from '@abnehm/contracts/base';
import { revocationNoticeId } from '@abnehm/contracts/partner';
import {
  buildSeedState,
  canonicalRows,
  gekoppeltParts,
  SeedManifest,
  seedIds,
  seedManifests,
  uncoupledState,
  type SeedKey,
  type SeedPart,
  type SeedState,
} from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import { dailyGoalCompletionEntity } from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { couplingMember as localMember } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { readPartnerCache } from '../../mobile/src/partner-cache/index.ts';
import {
  createHttpSyncTransport,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationSyncEntities,
  setPartnerSharing,
} from '../../mobile/src/sync/index.ts';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { dumpServer, seedServer } from '../dev/seed/server-seed.ts';
import { policies } from '../src/authorization/authorization.ts';
import { partnerSummary, revocationNotice } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { signIn, type Device } from './support/auth-client.ts';
import { httpOutcome, resourceProbe } from './support/authorization.ts';
import { coupleByInvitation } from './support/coupled-world.ts';
import { completeOp } from './support/daily-goals.ts';
import { uncoupleAs } from './support/shared-actions.ts';
import { push } from './support/sync.ts';

// Nachweis für #117: die Partner-Szenarien `gekoppelt` und `nach_entkopplung` (Spezifikation 0,
// Abschnitt 12) auf Postgres und auf beiden Geräten, deren Engine und Adapter auf echtem SQLite
// (better-sqlite3) gegen die echte Hono-App laufen. Jedes Szenario wird im Ausgangszustand exakt und
// wiederholbar hergestellt; nach den benannten Schritten des Manifests stimmen Postgres und beide
// SQLite-Datenbanken mit dem Sollzustand überein. Dazu führen die Tests Kopplungs-, Projektions- und
// Entkopplungsübergänge aus und prüfen die widerrufbaren Daten auf beiden Geräten.

const gekoppelt = seedManifests.gekoppelt;
const nachEntkopplung = seedManifests.nach_entkopplung;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Alle Sync-Entitäten der App, wie im Composition Root (`src/session/device-session.ts`). */
const registry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity]);

type Phone = Readonly<{
  device: Device;
  personId: string;
  database: LocalDatabase;
  sync(): Promise<void>;
  partner(): ReturnType<typeof readPartnerCache>;
  setSharing(area: AreaKey, level: 'privat' | 'zusammengefasst'): void;
}>;

/** Ein angemeldetes Gerät einer Installation, die lokale Datenbank im Ausgangszustand des Manifests. */
async function phone(backend: TestBackend, manifest: SeedManifest, key: SeedKey): Promise<Phone> {
  const installation = manifest.installations.find((candidate) => candidate.key === key)!;
  const account = manifest.accounts.find((candidate) => candidate.key === installation.account)!;
  const { reply, device } = await signIn(backend, account.email, account.password);
  if (reply.status !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${reply.status}`);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(account.accountId);
  seedLocalDatabase(database, manifest, key);
  const clock = createTestClock(manifest.clock);
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: InstallationId.parse(installation.installationId) });
  const writer = createSyncWriter({ registry, clock, newId: () => EntityId.parse(randomUUID()) });
  return {
    device,
    personId: account.personId,
    database,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    partner: () => database.read((tx) => readPartnerCache(tx)),
    setSharing: (area, level) => database.transaction((tx) => setPartnerSharing(tx, writer, { area, level }, Instant.parse(clock.read().instant))),
  };
}

type World = Readonly<{ backend: TestBackend; manifest: SeedManifest; phones: Readonly<Record<SeedKey, Phone>> }>;

/** Seedet Postgres und die Geräte aller Installationen; die Uhr des Backends steht auf der des Manifests. */
async function seeded(manifest: SeedManifest): Promise<World> {
  const backend = await createTestBackend({ clock: createTestClock(manifest.clock) });
  await seedServer(backend.database, manifest);
  const phones: Record<SeedKey, Phone> = {};
  for (const { key } of manifest.installations) phones[key] = await phone(backend, manifest, key);
  return { backend, manifest, phones };
}

/** Führt die benannten Schritte des Manifests aus; `entkoppeln` über die Test-Harness des Kerns (#107). */
async function runSteps({ backend, manifest, phones }: World) {
  for (const step of manifest.steps) {
    switch (step.type) {
      case 'sync':
        await phones[step.installation]!.sync();
        break;
      case 'entkoppeln': {
        const requester = manifest.accounts.find((account) => account.key === step.account)!;
        const result = await uncoupleAs(backend, { couplingId: step.couplingId, requesterPersonId: requester.personId, actionId: step.actionId, at: new Date(step.at) });
        expect(result.status).toBe('angenommen');
        break;
      }
    }
  }
}

/** Kanonischer Gesamtzustand: Postgres ohne Better-Auth-Tabellen und Sicherheitslog, je Installation SQLite. */
async function stateOf({ backend, phones }: World): Promise<SeedState> {
  return {
    server: await dumpServer(backend.database.db),
    devices: Object.fromEntries(Object.entries(phones).map(([key, { database }]) => [key, dumpLocalDatabase(database)])),
  };
}

function canonical(state: SeedState): SeedState {
  return { server: canonicalRows(state.server), devices: Object.fromEntries(Object.entries(state.devices).map(([key, device]) => [key, canonicalDevice(device)])) };
}

const probe = (backend: TestBackend, entity: 'meal_photo' | 'partner_photo_list', device: Device, id?: string) =>
  resourceProbe(backend, policies.resource(entity, 'lesen'))(device, id === undefined ? {} : { id }).then(httpOutcome);

describe('Szenario gekoppelt', () => {
  it('stellt Postgres und beide Geräte exakt her und ist im Ausgangszustand idempotent', async () => {
    const world = await seeded(gekoppelt);
    expect(await stateOf(world)).toEqual(canonical(gekoppelt.initial));

    await world.backend.database.db.update(partnerSummary).set({ content: { progressPercent: 1 } });
    await world.phones['anna-android']!.sync();
    await seedServer(world.backend.database, gekoppelt);
    for (const [key, { database }] of Object.entries(world.phones)) seedLocalDatabase(database, gekoppelt, key);

    // Kanonisch gleich, nicht nur dieselbe Zeilenzahl.
    expect(await stateOf(world)).toEqual(canonical(gekoppelt.initial));
  });

  it('erreicht nach den benannten Schritten (Sync beider Geräte) den Sollzustand; der Sync ändert nichts', async () => {
    const world = await seeded(gekoppelt);
    await runSteps(world);
    expect(await stateOf(world)).toEqual(canonical(gekoppelt.target));
    expect(gekoppelt.target).toEqual(gekoppelt.initial);
  });

  it('ein vollständiger Pull ergibt genau den geseedeten Gerätezustand: Sichtbarkeit und Partnercache passen zum Server', async () => {
    const world = await seeded(gekoppelt);
    // Was der Sync heute überträgt: Entitäten mit Eintrag im Änderungsprotokoll. Tagesziele, Einträge und Fotos
    // melden erst die Spezifikationen 1–3 an; die behält das Gerät samt eigener Person, an der sie hängen.
    const synced = new Set(gekoppelt.initial.server.change_log!.map((entry) => String(entry.entity_type)));
    synced.delete('person');

    for (const key of ['philipp-iphone', 'anna-android']) {
      const seededDevice = gekoppelt.initial.devices[key]!;
      const unsynced = Object.fromEntries(Object.entries(seededDevice.rows).filter(([table]) => !synced.has(table)));
      const withoutPull = SeedManifest.parse({ ...gekoppelt, initial: { ...gekoppelt.initial, devices: { [key]: { rows: unsynced, cursor: null, outbox: [] } } } });
      const fresh = await phone(world.backend, withoutPull, key);

      await fresh.sync();

      expect(dumpLocalDatabase(fresh.database)).toEqual(canonicalDevice(seededDevice));
    }
  });

  it('jedes Gerät zeigt vom Partner nur die freigegebenen Zusammenfassungen und den groben Tageszielstand', async () => {
    const { phones } = await seeded(gekoppelt);
    const philipp = phones['philipp-iphone']!;
    const anna = phones['anna-android']!;

    expect(philipp.partner()).toEqual({
      dailyGoalStatus: expect.objectContaining({ ownerPersonId: anna.personId, stage: 'fast_geschafft' }),
      summaries: [
        expect.objectContaining({ type: 'wasser', ownerPersonId: anna.personId, content: { progressPercent: 100 } }),
        expect.objectContaining({ type: 'sport', content: { countedMinutes: 45, weeklyTargetMinutes: 120 } }),
        expect.objectContaining({ type: 'gewicht', content: { changeKg: null, direction: 'noch_nicht_verfuegbar' } }),
      ],
    });
    expect(anna.partner()).toEqual({
      dailyGoalStatus: expect.objectContaining({ ownerPersonId: philipp.personId, stage: 'unterwegs' }),
      summaries: [
        expect.objectContaining({ type: 'ernaehrung', ownerPersonId: philipp.personId, content: { recordedMealCategories: 1 } }),
        expect.objectContaining({ type: 'wasser', content: { progressPercent: 50 } }),
        expect.objectContaining({ type: 'sport', content: { countedMinutes: 65, weeklyTargetMinutes: 150 } }),
        expect.objectContaining({ type: 'gewicht', content: { changeKg: null, direction: 'noch_nicht_verfuegbar' } }),
      ],
    });
  });

  it('Mahlzeitenfotos: Online-Sichtbarkeit wie im Erweiterungspunkt, ohne Bereichsfreigabe Ernährung', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const photos = gekoppelt.extensions?.mealPhotos;
    expect(photos?.version).toBe(1);
    const deviceOf = (account: SeedKey) => Object.values(phones).find(({ personId }) => personId === seedIds.person[account as 'philipp' | 'anna'])!.device;

    for (const photo of photos!.photos) {
      expect(await probe(backend, 'meal_photo', deviceOf(photo.account), photo.id)).toBe('erlaubt');
      for (const viewer of photo.visibleTo) {
        // Annas Ernährung ist privat; ihr Foto sieht Philipp trotzdem (Fotofreigabe `geteilt`).
        expect(await probe(backend, 'meal_photo', deviceOf(viewer), photo.id)).toBe('erlaubt');
        expect(await probe(backend, 'partner_photo_list', deviceOf(viewer))).toBe('erlaubt');
      }
    }
  });

  it('Projektionsübergang: Anna stellt Wasser auf privat; Philipps Gerät verliert genau diese Zusammenfassung', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const philipp = phones['philipp-iphone']!;
    const anna = phones['anna-android']!;
    expect(philipp.partner().summaries.map(({ type }) => type)).toEqual(['wasser', 'sport', 'gewicht']);

    anna.setSharing('wasser', 'privat');
    await anna.sync();
    await philipp.sync();

    expect(philipp.partner().summaries.map(({ type }) => type)).toEqual(['sport', 'gewicht']);
    expect(philipp.partner().dailyGoalStatus).toMatchObject({ stage: 'fast_geschafft' });
    const [notice] = await backend.database.db
      .select()
      .from(revocationNotice)
      .where(and(eq(revocationNotice.recipientPersonId, philipp.personId), eq(revocationNotice.projectionId, seedIds.partnerSummary.anna.wasser)));
    expect(notice).toMatchObject({ reason: 'freigabe_entzogen', id: revocationNoticeId(ServerVersion.parse(notice!.serverVersion.toString())) });
  });

  it('Projektionsübergang: Philipp erfüllt ein weiteres Tagesziel; Annas Gerät zeigt „fast geschafft“', async () => {
    const { backend, phones } = await seeded(gekoppelt);
    const anna = phones['anna-android']!;
    const water = { id: EntityId.parse(seedIds.dailyGoal.philippHeute[1]), personId: EntityId.parse(seedIds.person.philipp), localDate: LocalDate.parse('2026-10-14'), slot: 2, baustein: 'wasserziel' } as const;

    expect((await push(backend, phones['philipp-iphone']!.device, [completeOp(water, { completedAt: '2026-10-14T11:50:00.000Z' })]))[0]?.type).toBe('applied');
    await anna.sync();

    expect(anna.partner().dailyGoalStatus).toMatchObject({ id: seedIds.partnerDailyGoalStatus.philipp, stage: 'fast_geschafft' });
  });
});

describe('Szenario nach_entkopplung', () => {
  it('startet im Zustand von gekoppelt: Beide Geräte zeigen den Partner', async () => {
    expect(nachEntkopplung.initial).toEqual(gekoppelt.initial);
    const world = await seeded(nachEntkopplung);
    expect(await stateOf(world)).toEqual(canonical(nachEntkopplung.initial));
    for (const { partner } of Object.values(world.phones)) {
      expect(partner().dailyGoalStatus).not.toBeNull();
      expect(partner().summaries.length).toBeGreaterThan(0);
    }
  });

  it('erreicht nach Entkopplungs-Kern und Sync beider Geräte exakt den Sollzustand in Postgres und SQLite', async () => {
    const world = await seeded(nachEntkopplung);
    expect(nachEntkopplung.steps.map(({ type }) => type)).toEqual(['entkoppeln', 'sync', 'sync']);

    await runSteps(world);

    expect(await stateOf(world)).toEqual(canonical(nachEntkopplung.target));
  });

  it('widerruft tatsächlich: Kopplung und Insel archiviert, Notices an beide, Partnercaches leer, Namen bleiben', async () => {
    const world = await seeded(nachEntkopplung);
    await runSteps(world);
    const { server } = await stateOf(world);
    const couplingId = seedIds.coupling.philippAnna;

    expect(server.coupling).toEqual([expect.objectContaining({ id: couplingId, status: 'archiviert', ended_at: '2026-10-14T12:00:00.000Z' })]);
    expect(server.island).toEqual([expect.objectContaining({ state: 'archiviert' })]);
    expect(server.shared_action).toEqual([
      expect.objectContaining({ id: seedIds.sharedAction.annasEntkopplung, kind: 'entkoppeln', status: 'angenommen', requester_person_id: seedIds.person.anna }),
    ]);
    expect(server.revocation_notice?.map(({ recipient_person_id, target_type, reason }) => [recipient_person_id, target_type, reason]).sort()).toEqual([
      [seedIds.person.philipp, 'kopplung', 'entkopplung'],
      [seedIds.person.anna, 'kopplung', 'entkopplung'],
    ]);
    for (const table of ['partner_summary', 'partner_daily_goal_status']) {
      expect(server[table]?.every(({ deleted_at }) => deleted_at !== null)).toBe(true);
    }
    for (const { database, partner } of Object.values(world.phones)) {
      expect(partner()).toEqual({ dailyGoalStatus: null, summaries: [] });
      const members = database.read((tx) => sqliteOf(tx).select({ name: localMember.displayName, status: localMember.couplingStatus }).from(localMember).all());
      expect(members.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: 'Anna', status: 'archiviert' },
        { name: 'Philipp', status: 'archiviert' },
      ]);
    }
  });

  it('beendet offene gemeinsame Aktionen der Kopplung; der Sollzustand sagt das voraus', async () => {
    // Bis Spezifikation 4 das Deko-Geschenk liefert (#198), steht hier eine offene Aktion der Test-Art `rollentausch`.
    const open: SeedPart = {
      area: 'spiel',
      entities: [
        {
          table: 'shared_action',
          entityType: 'shared_action',
          couplingId: seedIds.coupling.philippAnna,
          row: {
            id: '5eed0045-0000-4000-8000-0000000000f1',
            coupling_id: seedIds.coupling.philippAnna,
            kind: 'rollentausch',
            requester_person_id: seedIds.person.philipp,
            payload: {},
            status: 'offen',
            decided_at: null,
            created_at: '2026-10-14T11:00:00.000Z',
            updated_at: '2026-10-14T11:00:00.000Z',
            deleted_at: null,
          },
        },
      ],
    };
    const initial = buildSeedState({
      parts: [...gekoppeltParts, open],
      createdAt: gekoppelt.clock.instant,
      devices: {
        'philipp-iphone': { personId: seedIds.person.philipp, cursor: 'latest' },
        'anna-android': { personId: seedIds.person.anna, cursor: 'latest' },
      },
    });
    const [step] = nachEntkopplung.steps;
    if (step?.type !== 'entkoppeln') throw new Error('Erster Schritt ist die Entkopplung');
    const manifest = SeedManifest.parse({
      ...nachEntkopplung,
      initial,
      target: uncoupledState(initial, { ...step, requesterPersonId: seedIds.person.anna }),
    });
    const world = await seeded(manifest);

    await runSteps(world);

    const state = await stateOf(world);
    expect(state).toEqual(canonical(manifest.target));
    expect(state.server.shared_action?.find(({ id }) => id === open.entities[0]!.row.id)).toMatchObject({ status: 'zurueckgezogen' });
  });

  it('nach der Entkopplung sieht der frühere Partner die Mahlzeitenfotos nicht mehr', async () => {
    const world = await seeded(nachEntkopplung);
    await runSteps(world);
    const philipp = world.phones['philipp-iphone']!.device;
    const anna = world.phones['anna-android']!.device;

    expect(await probe(world.backend, 'meal_photo', philipp, seedIds.mealPhoto.annaHeute)).toBe('verweigert');
    expect(await probe(world.backend, 'meal_photo', anna, seedIds.mealPhoto.philippHeute)).toBe('verweigert');
    expect(await probe(world.backend, 'partner_photo_list', philipp)).toBe('verweigert');
    expect(await probe(world.backend, 'meal_photo', anna, seedIds.mealPhoto.annaHeute)).toBe('erlaubt');
  });

  it('Kopplungsübergang: Dasselbe Paar koppelt erneut; Rollen und Freigaben kehren zurück, Projektionen entstehen neu', async () => {
    const world = await seeded(nachEntkopplung);
    await runSteps(world);
    const philipp = world.phones['philipp-iphone']!;
    const anna = world.phones['anna-android']!;

    expect(await coupleByInvitation(world.backend, philipp.device, anna.device)).toEqual({ couplingId: seedIds.coupling.philippAnna, reactivated: true });
    await philipp.sync();
    await anna.sync();

    const { server } = await stateOf(world);
    expect(server.coupling).toEqual([expect.objectContaining({ status: 'aktiv', reactivated_at: '2026-10-14T12:00:00.000Z' })]);
    expect(server.coupling_member?.map(({ person_id, role }) => [person_id, role]).sort()).toEqual([
      [seedIds.person.philipp, 'bauen'],
      [seedIds.person.anna, 'natur'],
    ]);
    expect(server.partner_sharing?.find(({ id }) => id === seedIds.partnerSharing.anna.ernaehrung)).toMatchObject({ level: 'privat' });
    // Gelöschtes wird nicht wiederbelebt: Der Tageszielstand kommt mit neuer ID.
    expect(philipp.partner().dailyGoalStatus).toMatchObject({ stage: 'fast_geschafft' });
    expect(philipp.partner().dailyGoalStatus?.id).not.toBe(seedIds.partnerDailyGoalStatus.anna);
    expect(anna.partner().dailyGoalStatus).toMatchObject({ stage: 'unterwegs' });
    expect(anna.partner().dailyGoalStatus?.id).not.toBe(seedIds.partnerDailyGoalStatus.philipp);
  });
});
