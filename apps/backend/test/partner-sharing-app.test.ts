import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, LocalDate } from '@abnehm/contracts/base';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { readPartnerCache } from '../../mobile/src/partner-cache/index.ts';
import { createPartner, type Partner, type SharingView } from '../../mobile/src/partner/partner.ts';
import { appWirContributions } from '../../mobile/src/shell/app-wir.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { invalidatePartnerSummaries } from '../src/partner-projections/invalidations.ts';
import { securityLog } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart, worldToday } from './support/coupled-world.ts';
import { testNutritionProjector, testRecorders } from './support/partner-projectors.ts';
import { withoutPartnerPhotos } from '../../mobile/src/partner/testing/fake-partner-photos.ts';

// Nachweis für #129: Anna schaltet auf ihrem Gerät die Ernährungs-Freigabe über den Partnerbereich der App ab, wie der
// Schalter auf „Partner & Freigaben“ es tut. Engine, Outbox und Partnercache der App laufen auf echtem SQLite gegen die
// echte Hono-App mit Postgres und dem Test-Projector für Ernährung aus #106. Nach dem Pull fehlt die Zusammenfassung
// auf Philipps Gerät; schaltet Anna sie wieder an, sieht er eine neue Generation.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open(accountId);
  const clock = createTestClock(worldStart);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry(foundationSyncEntities);
  const http = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport: http, clock, installationId: newId() });
  const partner: Partner = createPartner({ ...withoutPartnerPhotos,
    wirContributions: appWirContributions.source,
    database, clock, newId, writer: createSyncWriter({ registry, clock, newId }), sync: () => engine.sync(),
    observeOnline: () => () => {},
    refresh: () => () => {},
  });
  let sharing: SharingView | undefined;
  const stop = partner.sharing.subscribe((next) => (sharing = next));
  cleanups.push(() => {
    stop();
    databases.lock();
    files.remove();
  });
  return {
    partner,
    sharing: () => sharing,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    summaries: () => database.read((tx) => readPartnerCache(tx).summaries),
  };
}

async function setup() {
  const clock = createTestClock(worldStart);
  const backend = await createTestBackend({ clock, partnerSummaryProjectors: [testNutritionProjector()] });
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  await coupleByInvitation(backend, anna.device, philipp.device);
  const annasPhone = await phone(backend, anna.accountId, anna.device);
  const philippsPhone = await phone(backend, philipp.accountId, philipp.device);
  await annasPhone.sync();
  await philippsPhone.sync();
  // Anna erfasst ihr Frühstück; der Ernährungsbereich meldet die Änderung wie ein echter Fachbefehl.
  await backend.database.db.transaction(async (tx) => {
    await testRecorders.ernaehrung.meal(tx, anna.personId, worldToday, 'fruehstueck');
    await invalidatePartnerSummaries(tx, { type: 'bereich', ownerPersonId: EntityId.parse(anna.personId), area: 'ernaehrung', localDate: LocalDate.parse(worldToday) },
      new Date(clock.read().instant));
  });
  return { backend, anna, annasPhone, philippsPhone };
}

describe('Partner & Freigaben App ↔ Backend', () => {
  it('Anna schaltet die Ernährungs-Freigabe ab: Nach dem Pull fehlt die Zusammenfassung bei Philipp; wieder an bringt eine neue Generation', async () => {
    const { backend, anna, annasPhone, philippsPhone } = await setup();
    // Nach der Kopplung gelten die Startwerte: alles zusammengefasst, Fotos geteilt.
    expect(annasPhone.sharing()).toMatchObject({
      type: 'coupled', partnerDisplayName: 'Philipp', areas: { ernaehrung: true, wasser: true, sport: true, gewicht: true }, photos: true,
    });
    await philippsPhone.sync();
    const [before] = philippsPhone.summaries();
    expect(before).toMatchObject({ type: 'ernaehrung', content: { recordedMealCategories: 1 }, generation: 1 });

    expect(annasPhone.partner.share({ type: 'area', area: 'ernaehrung', shared: false })).toEqual({ type: 'saved' });
    // Sofort lokal, noch vor dem Push.
    expect(annasPhone.sharing()).toMatchObject({ areas: { ernaehrung: false, wasser: true } });
    await annasPhone.sync();
    await philippsPhone.sync();

    expect(philippsPhone.summaries()).toEqual([]);
    const log = await backend.database.db.select().from(securityLog);
    expect(log.filter((entry) => entry.accountId === anna.accountId && entry.eventType === 'freigabeaenderung').map((entry) => entry.details))
      .toEqual([expect.objectContaining({ scope: 'ernaehrung', level: 'privat' })]);

    annasPhone.partner.share({ type: 'area', area: 'ernaehrung', shared: true });
    await annasPhone.sync();
    await philippsPhone.sync();

    const [again] = philippsPhone.summaries();
    expect(again).toMatchObject({ type: 'ernaehrung', content: { recordedMealCategories: 1 }, generation: 2 });
    expect(again?.id).not.toBe(before?.id);
  });
});
