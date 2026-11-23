import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { Instant } from '@abnehm/contracts/base';
import { PartnerPhotoList } from '@abnehm/contracts/partner';
import { seedIds, seedManifests, type SeedKey } from '@abnehm/contracts/seeds';

import { policies } from '../src/authorization/authorization.ts';
import { mealPhoto, nutritionEntry } from '../src/db/schema/index.ts';
import { testBaseUrl, type TestBackend } from './support/app.ts';
import { call, securityLogEntries, type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, resourceProbe, type AuthorizationWorld } from './support/authorization.ts';
import { coupledWorld, insert, otherCouple, setPhotoSharing, uncouple, worldStart, type CoupledWorld, type WorldPerson } from './support/coupled-world.ts';
import { analyzedDraft, confirmation, confirmOp } from './support/meal-photos.ts';
import { seeded } from './support/seed-world.ts';
import { deleteOp, push, upsertOp } from './support/sync.ts';

// Nachweis für #165: Online-Lesepfad für geteilte Mahlzeitenfotos (Spezifikation 2, Abschnitt 9) mit den
// beiden Abläufen aus Spezifikation 0, Abschnitt 5, über HTTP gegen die echte Hono-App mit isoliertem
// Postgres. Die Fotoliste liefert die heute geteilten Fotos der Partnerin mit kurzlebigem Handle, der
// Bildabruf das Bild zum Handle. Beide prüfen die Sichtbarkeitsregeln bei jedem Aufruf.

const MINUTE = 60_000;
const listPath = '/v1/nutrition/partner-photos';
const imagePath = (handle: string, variant: string) => `${listPath}/${handle}/${variant}`;

async function photoList(backend: TestBackend, device: Device) {
  const reply = await call(backend, 'GET', listPath, device);
  if (reply.status !== 200) throw new Error(`Fotoliste erwartet: ${reply.status} ${JSON.stringify(reply.body)}`);
  return { raw: reply.body, list: PartnerPhotoList.parse(reply.body), headers: reply.headers };
}

/** Bildabruf als rohe Antwort, damit die Bytes unverändert ankommen. */
async function fetchImage(backend: TestBackend, device: Device, handle: string, variant = 'vorschau') {
  const headers = new Headers({ 'x-forwarded-for': device.ip });
  if (device.token !== undefined) headers.set('authorization', `Bearer ${device.token}`);
  return backend.app.request(`${testBaseUrl}${imagePath(handle, variant)}`, { headers });
}

async function imageOutcome(backend: TestBackend, device: Device, handle: string, variant = 'vorschau') {
  const response = await fetchImage(backend, device, handle, variant);
  const text = response.headers.get('content-type')?.includes('application/json') ? await response.text() : '';
  return httpOutcome({ status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown), headers: response.headers });
}

/** Ein Foto der Person über die echte Fotoanalyse und `confirmPhotoDraft`, am lokalen Tag der Welt. */
async function confirmedPhoto(world: CoupledWorld, owner: WorldPerson, options: { sharedWithPartner?: boolean } = {}) {
  const draft = await analyzedDraft(world.backend, owner.device);
  const payload = confirmation(draft.result, { sharedWithPartner: options.sharedWithPartner ?? true });
  const [result] = await push(world.backend, owner.device, [confirmOp(payload)]);
  if (result?.type !== 'applied') throw new Error(`Bestätigung erwartet: ${JSON.stringify(result)}`);
  return { payload, imageKey: draft.imageKey };
}

/** Das einzige Handle der Fotoliste. */
async function onlyHandle(world: CoupledWorld, viewer: WorldPerson = world.philipp) {
  const { list } = await photoList(world.backend, viewer.device);
  expect(list.photos).toHaveLength(1);
  return list.photos[0]!.handle;
}

describe('Fotoliste', () => {
  it('liefert Annas heute geteilte Fotos mit Handle und Mahlzeit, ohne Tagesparameter', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);

    const { list, headers } = await photoList(world.backend, world.philipp.device);

    expect(list).toEqual({ photos: [{ handle: expect.any(String), meal: 'mittagessen' }], dataAsOf: worldStart.instant });
    expect(list.photos[0]!.handle).not.toContain(payload.photoId);
    expect(headers.get('cache-control')).toBe('no-store');
  });

  it('enthält höchstens 12 Fotos, nach Aufnahmezeit sortiert', async () => {
    const world = await coupledWorld();
    const meals = ['fruehstueck', 'mittagessen', 'abendessen', 'snacks'] as const;
    // In umgekehrter Reihenfolge angelegt: Die Liste sortiert selbst.
    for (let index = 12; index >= 0; index--) {
      await insert.mealPhoto(world, world.anna, { capturedAt: new Date(Date.parse('2026-10-14T05:00:00.000Z') + index * 10 * MINUTE), meal: meals[index % 4] });
    }

    const { list } = await photoList(world.backend, world.philipp.device);

    expect(list.photos.map(({ meal }) => meal)).toEqual(Array.from({ length: 12 }, (_, index) => meals[index % 4]));
    expect(new Set(list.photos.map(({ handle }) => handle)).size).toBe(12);
  });

  it('rechnet den Tag in der Zeitzone der Eigentümerin: nach Mitternacht in Berlin ist die Liste leer', async () => {
    const world = await coupledWorld();
    await insert.mealPhoto(world, world.anna);
    expect((await photoList(world.backend, world.philipp.device)).list.photos).toHaveLength(1);

    world.clock.set(Instant.parse('2026-10-14T22:30:00.000Z'));

    expect((await photoList(world.backend, world.philipp.device)).list).toEqual({ photos: [], dataAsOf: '2026-10-14T22:30:00.000Z' });
  });

  it('lässt nicht geteilte, gelöschte, verwaiste und eigene Fotos weg', async () => {
    const world = await coupledWorld();
    await insert.mealPhoto(world, world.anna, { meal: 'abendessen' });
    await insert.mealPhoto(world, world.anna, { shared: false });
    await insert.mealPhoto(world, world.anna, { localDate: '2026-10-13' });
    const deleted = await insert.mealPhoto(world, world.anna);
    await world.backend.database.db.update(mealPhoto).set({ deletedAt: new Date(worldStart.instant) }).where(eq(mealPhoto.id, deleted));
    const orphan = await insert.mealPhoto(world, world.anna);
    await world.backend.database.db.update(nutritionEntry).set({ deletedAt: new Date(worldStart.instant) }).where(eq(nutritionEntry.mealPhotoId, orphan));
    await insert.mealPhoto(world, world.philipp);

    const { list } = await photoList(world.backend, world.philipp.device);

    expect(list.photos.map(({ meal }) => meal)).toEqual(['abendessen']);
  });

  it('jedes gelistete Handle gibt der Bildabruf frei: Liste und Regel `meal_photo` sehen dieselben Fotos', async () => {
    const world = await coupledWorld();
    // Gemischter Tag: sichtbare Fotos an beiden Rändern des lokalen Tags, dazu alles, was beide ausschließen müssen.
    await insert.mealPhoto(world, world.anna, { capturedAt: new Date('2026-10-13T22:00:00.000Z'), meal: 'fruehstueck' });
    await insert.mealPhoto(world, world.anna, { meal: 'abendessen' });
    await insert.mealPhoto(world, world.anna, { shared: false });
    await insert.mealPhoto(world, world.anna, { localDate: '2026-10-13' });
    const orphan = await insert.mealPhoto(world, world.anna);
    await world.backend.database.db.update(nutritionEntry).set({ deletedAt: new Date(worldStart.instant) }).where(eq(nutritionEntry.mealPhotoId, orphan));

    const { list } = await photoList(world.backend, world.philipp.device);

    expect(list.photos.map(({ meal }) => meal)).toEqual(['fruehstueck', 'abendessen']);
    for (const { handle } of list.photos) {
      // Ohne Datei in der Fotoablage antwortet der freigegebene Abruf mit 404, verweigert wäre 403.
      expect((await fetchImage(world.backend, world.philipp.device, handle)).status).toBe(404);
    }
  });

  it('enthält keine Namen, Mengen, kcal, Makros, Zeitpunkte oder Roh-IDs', async () => {
    const world = await coupledWorld();
    const { payload, imageKey } = await confirmedPhoto(world, world.anna);
    const [entry] = await world.backend.database.db.select().from(nutritionEntry).where(eq(nutritionEntry.mealPhotoId, payload.photoId));

    const { raw, list } = await photoList(world.backend, world.philipp.device);
    // Die Handles sind zufällige Zeichen; Wörter wie „Mg“ könnten darin zufällig stehen.
    const serialized = list.photos.reduce((text, { handle }) => text.replaceAll(handle, ''), JSON.stringify(raw));

    // Nur die Schlüssel des Vertrags, und außer `dataAsOf` kein Zeitpunkt.
    expect(Object.keys(raw as object).sort()).toEqual(['dataAsOf', 'photos']);
    for (const photo of (raw as { photos: object[] }).photos) expect(Object.keys(photo).sort()).toEqual(['handle', 'meal']);
    expect(serialized.match(/\d{4}-\d{2}-\d{2}T/g)).toHaveLength(1);
    for (const forbidden of [payload.photoId, entry!.id, world.anna.personId, world.couplingId, imageKey, entry!.snapshotName, 'kcal', 'Kcal', 'protein', 'Mg', 'amount']) {
      expect(serialized).not.toContain(forbidden);
    }
    // Auch das Handle selbst trägt keine Roh-ID im Klartext.
    for (const { handle } of list.photos) expect(Buffer.from(handle, 'base64url').toString('hex')).not.toContain(payload.photoId.replaceAll('-', ''));
  });

  it('Fotofreigabe privat: generisch verweigert und im Sicherheitslog', async () => {
    const world = await coupledWorld();
    await insert.mealPhoto(world, world.anna);
    await setPhotoSharing(world, world.anna, 'privat');

    expect(httpOutcome(await call(world.backend, 'GET', listPath, world.philipp.device))).toBe('verweigert');
    expect((await securityLogEntries(world.backend)).filter((entry) => entry.eventType === 'fotozugriff_verweigert')).toEqual([
      { eventType: 'fotozugriff_verweigert', accountId: world.philipp.accountId, details: { accountId: world.philipp.accountId, operation: 'fotoliste' } },
    ]);
  });
});

describe('Bildabruf per Handle', () => {
  it('liefert Vorschau und vergrößerte Fassung mit den Bytes der Fotoablage, nicht cachebar', async () => {
    const world = await coupledWorld();
    const { imageKey } = await confirmedPhoto(world, world.anna);
    const handle = await onlyHandle(world);

    for (const variant of ['vorschau', 'gross'] as const) {
      const response = await fetchImage(world.backend, world.philipp.device, handle, variant);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(await world.backend.photoStorage.readPhoto(imageKey, variant));
    }
  });

  it('ein Handle gilt höchstens 10 Minuten', async () => {
    const world = await coupledWorld();
    await confirmedPhoto(world, world.anna);
    const handle = await onlyHandle(world);

    world.clock.advanceBy(10 * MINUTE - 1);
    expect(await imageOutcome(world.backend, world.philipp.device, handle)).toBe('erlaubt');

    world.clock.advanceBy(1);
    expect(await imageOutcome(world.backend, world.philipp.device, handle)).toBe('verweigert');
    // Eine neue Liste bringt ein neues Handle.
    expect(await imageOutcome(world.backend, world.philipp.device, await onlyHandle(world))).toBe('erlaubt');
  });

  it('ein manipuliertes Handle ist generisch verweigert und im Sicherheitslog', async () => {
    const world = await coupledWorld();
    await confirmedPhoto(world, world.anna);
    const handle = await onlyHandle(world);
    const flipped = `${handle.slice(0, 20)}${handle[20] === 'A' ? 'B' : 'A'}${handle.slice(21)}`;

    for (const manipulated of [flipped, `${handle}A`, handle.slice(0, 40), 'ph_7Kq2mZ9xVt3LwR8b']) {
      expect(await imageOutcome(world.backend, world.philipp.device, manipulated), manipulated).toBe('verweigert');
    }
    const denials = (await securityLogEntries(world.backend)).filter((entry) => entry.eventType === 'fotozugriff_verweigert');
    expect(denials.map((entry) => entry.details)).toEqual(Array.from({ length: 4 }, () => ({ accountId: world.philipp.accountId, operation: 'bildabruf' })));
  });

  it('kennt nur Vorschau und vergrößerte Fassung', async () => {
    const world = await coupledWorld();
    await confirmedPhoto(world, world.anna);
    const handle = await onlyHandle(world);

    const response = await fetchImage(world.backend, world.philipp.device, handle, 'original');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'invalid_payload', retryable: false });
  });

  it.each([
    ['Anna nimmt das Foto vom Teilen aus', async (world: CoupledWorld, photoId: string) =>
      void (await push(world.backend, world.anna.device, [upsertOp(photoId, { sharedWithPartner: false }, { entityType: 'meal_photo' })]))],
    ['Anna löscht das Foto', async (world: CoupledWorld, photoId: string) =>
      void (await push(world.backend, world.anna.device, [deleteOp(photoId, { entityType: 'meal_photo' })]))],
    ['Anna löscht alle Einträge des Fotos (verwaist)', async (world: CoupledWorld, photoId: string) => {
      const entries = await world.backend.database.db.select().from(nutritionEntry).where(eq(nutritionEntry.mealPhotoId, photoId));
      await push(world.backend, world.anna.device, entries.map((entry) => deleteOp(entry.id, { entityType: 'nutrition_entry' })));
    }],
    ['Anna stellt die Fotofreigabe auf privat', async (world: CoupledWorld) => setPhotoSharing(world, world.anna, 'privat')],
    ['die Kopplung endet', async (world: CoupledWorld) => uncouple(world)],
  ])('%s: Ein schon ausgegebenes Handle ist sofort ungültig', async (_name, change) => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);
    const handle = await onlyHandle(world);
    expect(await imageOutcome(world.backend, world.philipp.device, handle)).toBe('erlaubt');

    await change(world, payload.photoId);

    expect(await imageOutcome(world.backend, world.philipp.device, handle)).toBe('verweigert');
  });
});

describe('Autorisierung der Fotoliste', () => {
  type World = AuthorizationWorld & { world: CoupledWorld };
  const cases = authorizationCases({
    policy: policies.resource('partner_photo_list', 'lesen'),
    route: { method: 'GET', path: '/v1/nutrition/partner-photos' },
    arrange: async (): Promise<World> => {
      const world = await coupledWorld();
      await insert.mealPhoto(world, world.anna);
      return { backend: world.backend, actor: world.philipp.device, world };
    },
    attempt: async (world, device) => httpOutcome(await call(world.backend, 'GET', listPath, device)),
    verbotene_operation: async (world) =>
      httpOutcome(await resourceProbe(world.backend, policies.resource('partner_photo_list', 'upsert'))(world.actor)),
    entkopplung: (world) => uncouple(world.world),
    freigabeentzug: (world) => setPhotoSharing(world.world, world.world.anna, 'privat'),
  });
  for (const testCase of cases) it(testCase.name, testCase.run, 30_000);
});

describe('Autorisierung des Bildabrufs per Handle', () => {
  type World = AuthorizationWorld & { world: CoupledWorld; handle: string; foreignHandle: string };
  const cases = authorizationCases({
    policy: policies.resource('meal_photo', 'lesen'),
    route: { method: 'GET', path: '/v1/nutrition/partner-photos/:handle/:variant' },
    arrange: async (): Promise<World> => {
      const world = await coupledWorld();
      await confirmedPhoto(world, world.anna);
      const handle = await onlyHandle(world);
      // Ein fremdes Handle: das Foto eines anderen Paars, ausgegeben an dessen Mitglied.
      const other = await otherCouple(world);
      await confirmedPhoto(other, other.anna);
      const foreignHandle = await onlyHandle(other);
      return { backend: world.backend, actor: world.philipp.device, world, handle, foreignHandle };
    },
    attempt: (world, device) => imageOutcome(world.backend, device, world.handle),
    manipulierte_id: (world) => imageOutcome(world.backend, world.actor, world.foreignHandle),
    entkopplung: (world) => uncouple(world.world),
    freigabeentzug: (world) => setPhotoSharing(world.world, world.world.anna, 'privat'),
  });
  for (const testCase of cases) it(testCase.name, testCase.run, 30_000);
});

describe('Szenario gekoppelt', () => {
  it('Fotoliste und Bildabruf zeigen online genau die Fotos, die der Erweiterungspunkt sichtbar nennt', async () => {
    const { backend, phones } = await seeded(seedManifests.gekoppelt);
    const photos = seedManifests.gekoppelt.extensions?.mealPhotos;
    if (photos?.version !== 2) throw new Error('Fassung 2 erwartet');
    const deviceOf = (account: SeedKey) => Object.values(phones).find(({ personId }) => personId === seedIds.person[account as 'philipp' | 'anna'])!.device;

    for (const viewer of ['philipp', 'anna'] as const) {
      const visible = photos.photos.filter((photo) => photo.visibleTo.includes(viewer));
      const { list } = await photoList(backend, deviceOf(viewer));

      expect(list.photos, viewer).toHaveLength(visible.length);
      for (const [index, entry] of list.photos.entries()) {
        const response = await fetchImage(backend, deviceOf(viewer), entry.handle, 'gross');
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(await backend.photoStorage.readPhoto(visible[index]!.imageKey, 'gross'));
      }
    }
  });
});
