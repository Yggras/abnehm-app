import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { EntityId } from '@abnehm/contracts/base';
import type { ConfirmPhotoDraft, MealPhotoVariant } from '@abnehm/contracts/nutrition';

import { policies } from '../src/authorization/authorization.ts';
import { changeLog, mealPhoto, nutritionEntry, photoSharing, securityLog } from '../src/db/schema/index.ts';
import { createPhotoStorage } from '../src/nutrition/photo-storage.ts';
import { testBaseUrl, type TestBackend } from './support/app.ts';
import { type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, resourceProbe, type AuthorizationWorld } from './support/authorization.ts';
import { coupledWorld, uncouple, type CoupledWorld, type WorldPerson } from './support/coupled-world.ts';
import { analyzedDraft, confirmation, confirmOp } from './support/meal-photos.ts';
import { deleteOp, pullAll, push, upsertOp } from './support/sync.ts';

// Nachweis für #164: eigene Mahlzeitenfotos ansehen, vom Teilen ausnehmen und löschen (Spezifikation 2,
// Abschnitt 9) über HTTP gegen die echte Hono-App mit isoliertem Postgres. Der Bildabruf der Eigentümerin
// ist online, authentifiziert und nicht cachebar; „Foto löschen“ ist ein Tombstone, dessen Bilddateien der
// Server beim Übernehmen sofort löscht; ein seit 24 Stunden verwaistes Foto setzt der Aufräumjob auf
// Tombstone.

const HOUR = 60 * 60_000;
/** Abstand der Läufe des Aufräumjobs für verwaiste Fotos (Designwert, wie die übrigen Fotojobs). */
const ORPHAN_INTERVAL_MS = 5 * 60_000;

const storageOf = (backend: TestBackend) => createPhotoStorage({ directory: backend.photoStorageDirectory });
const photoPath = (photoId: string, variant: string) => `/v1/nutrition/meal-photos/${photoId}/${variant}`;

/** Bildabruf als rohe Antwort, damit die Bytes unverändert ankommen. */
async function fetchPhoto(backend: TestBackend, device: Device, photoId: string, variant: string) {
  const headers = new Headers({ 'x-forwarded-for': device.ip });
  if (device.token !== undefined) headers.set('authorization', `Bearer ${device.token}`);
  return backend.app.request(`${testBaseUrl}${photoPath(photoId, variant)}`, { headers });
}

/** Der Ausgang eines Bildabrufs für das Negativtest-Gerüst. */
async function photoOutcome(backend: TestBackend, device: Device, photoId: string, variant = 'vorschau') {
  const response = await fetchPhoto(backend, device, photoId, variant);
  const text = response.headers.get('content-type')?.includes('application/json') ? await response.text() : '';
  return httpOutcome({ status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown), headers: response.headers });
}

/** Bestätigt ein Foto der Person über die echte Fotoanalyse und `confirmPhotoDraft`. */
async function confirmedPhoto(world: CoupledWorld, owner: WorldPerson, options: { sharedWithPartner?: boolean } = {}) {
  const draft = await analyzedDraft(world.backend, owner.device);
  const payload = confirmation(draft.result, { sharedWithPartner: options.sharedWithPartner ?? true });
  const [result] = await push(world.backend, owner.device, [confirmOp(payload)]);
  if (result?.type !== 'applied') throw new Error(`Bestätigung erwartet: ${JSON.stringify(result)}`);
  return { payload, imageKey: draft.imageKey };
}

async function photoRow(backend: TestBackend, photoId: string) {
  const [row] = await backend.database.db.select().from(mealPhoto).where(eq(mealPhoto.id, photoId));
  return row!;
}

/** Löscht alle Einträge des Fotos per Sync, wie es die App beim Löschen der Einträge einer Mahlzeit tut. */
async function deleteEntries(world: CoupledWorld, owner: WorldPerson, payload: ConfirmPhotoDraft) {
  await push(world.backend, owner.device, payload.entries.map(({ id }) => deleteOp(id, { entityType: 'nutrition_entry' })));
}

describe('Bildabruf eigener Mahlzeitenfotos', () => {
  it('liefert Vorschau und vergrößerte Fassung als JPEG aus der Fotoablage, nicht cachebar', async () => {
    const world = await coupledWorld();
    const { payload, imageKey } = await confirmedPhoto(world, world.anna);
    const storage = storageOf(world.backend);

    for (const variant of ['vorschau', 'gross'] as const satisfies readonly MealPhotoVariant[]) {
      const response = await fetchPhoto(world.backend, world.anna.device, payload.photoId, variant);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      // Nicht cachebar (RFC 9111, Abschnitt 5.2.2.5: `no-store`) und nie als etwas anderes interpretiert.
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes).toEqual(await storage.readPhoto(imageKey, variant));
      expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    }
  });

  it('auch ein vom Teilen ausgenommenes Foto sieht die Eigentümerin', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna, { sharedWithPartner: false });

    expect((await fetchPhoto(world.backend, world.anna.device, payload.photoId, 'gross')).status).toBe(200);
  });

  it('ein fremdes Foto am eigenen Endpunkt ist verweigert, auch geteilt und gekoppelt, und landet im Sicherheitslog', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);
    // Gegenprobe: Über die Partnerregel (Fotoliste und Handle, #165) dürfte Philipp das Foto sehen.
    expect(await resourceProbe(world.backend, policies.resource('meal_photo', 'lesen'))(world.philipp.device, { id: payload.photoId }).then(httpOutcome))
      .toBe('erlaubt');

    expect(await photoOutcome(world.backend, world.philipp.device, payload.photoId)).toBe('verweigert');

    const denials = await world.backend.database.db.select().from(securityLog).where(eq(securityLog.eventType, 'fotozugriff_verweigert'));
    expect(denials.map((entry) => entry.details)).toEqual([{ accountId: world.philipp.accountId, operation: 'bildabruf' }]);
  });

  it('ein gelöschtes Foto ist nicht mehr abrufbar, generisch verweigert', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);

    await push(world.backend, world.anna.device, [deleteOp(payload.photoId, { entityType: 'meal_photo' })]);

    expect(await photoOutcome(world.backend, world.anna.device, payload.photoId)).toBe('verweigert');
  });

  it('kennt nur Vorschau und vergrößerte Fassung', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);

    const response = await fetchPhoto(world.backend, world.anna.device, payload.photoId, 'original');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'invalid_payload', retryable: false });
  });

  it('nach dem Entkoppeln bleibt das eigene Foto abrufbar', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);

    await uncouple(world);

    expect((await fetchPhoto(world.backend, world.anna.device, payload.photoId, 'vorschau')).status).toBe(200);
  });
});

describe('Autorisierung des Bildabrufs eigener Fotos', () => {
  type World = AuthorizationWorld & { photoId: EntityId; foreignPhotoId: EntityId };
  const cases = authorizationCases({
    policy: policies.resource('meal_photo_own', 'lesen'),
    route: { method: 'GET', path: '/v1/nutrition/meal-photos/:id/:variant' },
    arrange: async (): Promise<World> => {
      const world = await coupledWorld();
      const own = await confirmedPhoto(world, world.anna);
      const foreign = await confirmedPhoto(world, world.philipp);
      // Der Partner ist ebenfalls fremd: Geteilte Fotos sieht er nur über Fotoliste und Handle.
      return { backend: world.backend, actor: world.anna.device, alsoForeign: [world.philipp.device], photoId: own.payload.photoId,
        foreignPhotoId: foreign.payload.photoId };
    },
    attempt: (world, device) => photoOutcome(world.backend, device, world.photoId),
    manipulierte_id: (world) => photoOutcome(world.backend, world.actor, world.foreignPhotoId),
    verbotene_operation: async (world) =>
      httpOutcome(await resourceProbe(world.backend, policies.resource('meal_photo_own', 'upsert'))(world.actor, { id: world.photoId })),
  });
  for (const testCase of cases) it(testCase.name, testCase.run, 30_000);
});

describe('Foto löschen', () => {
  it('löscht beim Übernehmen des Tombstones sofort beide Bilddateien; die Einträge bleiben', async () => {
    const world = await coupledWorld();
    const { payload, imageKey } = await confirmedPhoto(world, world.anna);
    const storage = storageOf(world.backend);
    expect(await storage.readPhoto(imageKey, 'gross')).not.toBeNull();

    const [deleted] = await push(world.backend, world.anna.device, [deleteOp(payload.photoId, { entityType: 'meal_photo' })]);

    expect(deleted).toMatchObject({ type: 'applied', canonical: { type: 'tombstone', entityId: payload.photoId } });
    // Ohne Lauf eines Aufräumjobs.
    expect(await storage.readPhoto(imageKey, 'vorschau')).toBeNull();
    expect(await storage.readPhoto(imageKey, 'gross')).toBeNull();
    expect((await storage.storedKeys()).photos).not.toContain(imageKey);
    const entries = await world.backend.database.db.select().from(nutritionEntry).where(eq(nutritionEntry.mealPhotoId, payload.photoId));
    expect(entries.map((entry) => entry.deletedAt)).toEqual(payload.entries.map(() => null));
  });

  it('„Mit Partner teilen“ aus: Der Partner verliert den Zugriff sofort, die Eigentümerin nicht', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);
    const partnerView = () => resourceProbe(world.backend, policies.resource('meal_photo', 'lesen'))(world.philipp.device, { id: payload.photoId }).then(httpOutcome);
    expect(await partnerView()).toBe('erlaubt');

    const [result] = await push(world.backend, world.anna.device, [upsertOp(payload.photoId, { sharedWithPartner: false }, { entityType: 'meal_photo' })]);

    expect(result).toMatchObject({ type: 'applied', canonical: { type: 'record', data: { sharedWithPartner: false } } });
    expect(await partnerView()).toBe('verweigert');
    expect((await fetchPhoto(world.backend, world.anna.device, payload.photoId, 'vorschau')).status).toBe(200);
  });
});

describe('Aufräumjob für verwaiste Mahlzeitenfotos', () => {
  it('setzt ein Foto 24 Stunden nach dem Löschen seines letzten Eintrags auf Tombstone und löscht die Dateien', async () => {
    const world = await coupledWorld();
    const { payload, imageKey } = await confirmedPhoto(world, world.anna);
    const storage = storageOf(world.backend);
    await deleteEntries(world, world.anna, payload);
    // Der Partner sieht es schon ab dem ersten Moment ohne nicht gelöschten Eintrag nicht mehr.
    expect(await resourceProbe(world.backend, policies.resource('meal_photo', 'lesen'))(world.philipp.device, { id: payload.photoId }).then(httpOutcome))
      .toBe('verweigert');

    world.clock.advanceBy(24 * HOUR - ORPHAN_INTERVAL_MS);
    await world.backend.jobs.runDue();
    expect((await photoRow(world.backend, payload.photoId)).deletedAt).toBeNull();
    expect(await storage.readPhoto(imageKey, 'gross')).not.toBeNull();

    world.clock.advanceBy(ORPHAN_INTERVAL_MS);
    await world.backend.jobs.runDue();

    const row = await photoRow(world.backend, payload.photoId);
    expect(row.deletedAt?.toISOString()).toBe(world.clock.read().instant);
    expect(await storage.readPhoto(imageKey, 'vorschau')).toBeNull();
    expect(await storage.readPhoto(imageKey, 'gross')).toBeNull();
    // Der Tombstone steht im Änderungsprotokoll und erreicht die Geräte der Eigentümerin per Pull.
    const [logged] = await world.backend.database.db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.entityId, payload.photoId), eq(changeLog.position, row.serverVersion)));
    expect(logged).toMatchObject({ entityType: 'meal_photo', operation: 'delete', ownerPersonId: world.anna.personId });
    const { changes } = await pullAll(world.backend, world.anna.device);
    expect(changes.find((change) => change.entityId === payload.photoId)).toMatchObject({ type: 'tombstone', entityType: 'meal_photo' });
  });

  it('lässt Fotos mit nicht gelöschtem Eintrag stehen, auch nach „Rückgängig“ mit einem neuen Eintrag', async () => {
    const world = await coupledWorld();
    const living = await confirmedPhoto(world, world.anna);
    const undone = await confirmedPhoto(world, world.anna);
    await deleteEntries(world, world.anna, undone.payload);
    // „Rückgängig“ legt einen neuen Eintrag mit identischem Inhalt samt Fotoverknüpfung an.
    const restored = undone.payload.entries[0]!.entry;
    await push(world.backend, world.anna.device, [upsertOp(randomUUID(), restored, { entityType: 'nutrition_entry' })]);

    world.clock.advanceBy(48 * HOUR);
    await world.backend.jobs.runDue();

    expect((await photoRow(world.backend, living.payload.photoId)).deletedAt).toBeNull();
    expect((await photoRow(world.backend, undone.payload.photoId)).deletedAt).toBeNull();
    expect(await storageOf(world.backend).readPhoto(undone.imageKey, 'gross')).not.toBeNull();
  });

  it('zählt vom Löschen des letzten Eintrags an, nicht von der Aufnahme', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);
    // Der Fake schätzt drei Bestandteile: den ersten gleich löschen, die übrigen erst nach 20 Stunden.
    const [first, ...rest] = payload.entries;
    expect(rest.length).toBeGreaterThan(0);
    await push(world.backend, world.anna.device, [deleteOp(first!.id, { entityType: 'nutrition_entry' })]);
    world.clock.advanceBy(20 * HOUR);
    await push(world.backend, world.anna.device, rest.map(({ id }) => deleteOp(id, { entityType: 'nutrition_entry' })));

    world.clock.advanceBy(23 * HOUR);
    await world.backend.jobs.runDue();
    expect((await photoRow(world.backend, payload.photoId)).deletedAt).toBeNull();

    world.clock.advanceBy(HOUR);
    await world.backend.jobs.runDue();
    expect((await photoRow(world.backend, payload.photoId)).deletedAt).not.toBeNull();
  });

  it('ist idempotent und lässt schon gelöschte Fotos unverändert', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna);
    await deleteEntries(world, world.anna, payload);
    world.clock.advanceBy(24 * HOUR);
    await world.backend.jobs.runDue();
    const first = await photoRow(world.backend, payload.photoId);

    world.clock.advanceBy(ORPHAN_INTERVAL_MS);
    await world.backend.jobs.runDue();

    expect(await photoRow(world.backend, payload.photoId)).toEqual(first);
    const log = await world.backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, payload.photoId));
    expect(log.filter((entry) => entry.operation === 'delete')).toHaveLength(1);
  });

  it('ein Foto ohne Fotofreigabe oder Kopplung verwaist genauso', async () => {
    const world = await coupledWorld();
    const { payload } = await confirmedPhoto(world, world.anna, { sharedWithPartner: false });
    await world.backend.database.db.update(photoSharing).set({ level: 'privat' }).where(eq(photoSharing.ownerPersonId, world.anna.personId));
    await uncouple(world);
    await deleteEntries(world, world.anna, payload);

    world.clock.advanceBy(24 * HOUR);
    await world.backend.jobs.runDue();

    expect((await photoRow(world.backend, payload.photoId)).deletedAt).not.toBeNull();
  });
});
