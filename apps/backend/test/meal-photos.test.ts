import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { ConfirmPhotoDraft, MealPhotoRecord, NutritionEntryRecord } from '@abnehm/contracts/nutrition';
import type { PushResult } from '@abnehm/contracts/sync';

import { changeLog, mealPhoto, nutritionEntry, photoDraft } from '../src/db/schema/index.ts';
import { createPhotoStorage } from '../src/nutrition/photo-storage.ts';
import { authorizationCases, personWithSession } from './support/authorization.ts';
import { analyzedDraft, confirmation, confirmOp, confirmPhotoDraftScenario, lunchtime, photoWorld } from './support/meal-photos.ts';
import { deleteOp, installationB, pullAll, push, upsertOp } from './support/sync.ts';

// Nachweis für #162: Fotoentwurf bestätigen und Fotoablage (Spezifikation 2, Abschnitte 8, 9 und 11)
// über HTTP gegen die echte Hono-App mit isoliertem Postgres und dem Fake des `MealVisionAnalyzer`.
// Der Server legt alle Einträge immer an; das Mahlzeitenfoto nur aus einem gültigen, eigenen und nicht
// abgelaufenen Entwurf.

const HOUR = 60 * 60_000;
/** Abstand der Aufräumläufe von Entwürfen und Fotoablage. */
const CLEANUP_INTERVAL_MS = 5 * 60_000;

function applied(result: PushResult | undefined) {
  if (result?.type !== 'applied' && result?.type !== 'already_applied') throw new Error(`Bestätigung erwartet: ${JSON.stringify(result)}`);
  return result;
}

async function rows(backend: Awaited<ReturnType<typeof photoWorld>>['backend']) {
  const db = backend.database.db;
  return {
    photos: await db.select().from(mealPhoto),
    entries: await db.select().from(nutritionEntry),
    drafts: await db.select().from(photoDraft),
  };
}

const storageOf = (backend: { photoStorageDirectory: string }) => createPhotoStorage({ directory: backend.photoStorageDirectory });

describe('confirmPhotoDraft: gültiger Entwurf', () => {
  it('legt Foto und Einträge in einer Operation an, verknüpft sie und löscht den Entwurf', async () => {
    const clock = createTestClock(lunchtime);
    const { backend, anna } = await photoWorld({ clock });
    const draft = await analyzedDraft(backend, anna.device);
    clock.advanceBy(10 * 60_000);
    const payload = confirmation(draft.result, { sharedWithPartner: false });

    const [result] = await push(backend, anna.device, [confirmOp(payload)]);

    const { changes } = applied(result);
    const { photos, entries, drafts } = await rows(backend);
    expect(drafts).toEqual([]);
    expect(photos).toHaveLength(1);
    // Bildschlüssel des Entwurfs, Aufnahmezeit ist die Analyse, der Schalter wie gewählt.
    expect(photos[0]).toMatchObject({ id: payload.photoId, personId: anna.personId, imageKey: draft.imageKey, sharedWithPartner: false, deletedAt: null });
    expect(photos[0]!.capturedAt.toISOString()).toBe(draft.createdAt.toISOString());
    expect(entries.map((entry) => entry.id).sort()).toEqual(payload.entries.map((item) => item.id).sort());
    expect(entries.every((entry) => entry.mealPhotoId === payload.photoId && entry.personId === anna.personId && entry.captureMethod === 'foto')).toBe(true);
    // Das Foto steht vor den Einträgen, die darauf verweisen; jede Zeile hat ihre Serverversion im Änderungsprotokoll.
    expect(changes?.map((change) => [change.entityType, change.entityId])).toEqual([
      ['meal_photo', payload.photoId],
      ...payload.entries.map((item) => ['nutrition_entry', item.id]),
    ]);
    const photoRecord = changes![0]!;
    if (photoRecord.type !== 'record') throw new Error('Datensatz erwartet');
    expect(MealPhotoRecord.parse(photoRecord.data)).toEqual({
      imageKey: draft.imageKey,
      capturedAt: draft.createdAt.toISOString(),
      sharedWithPartner: false,
      personId: anna.personId,
      createdAt: '2026-10-14T10:10:00.000Z',
      updatedAt: '2026-10-14T10:10:00.000Z',
    });
    const log = await backend.database.db.select().from(changeLog).where(inArray(changeLog.entityId, [payload.photoId, ...payload.entries.map((item) => item.id)]));
    expect(log).toHaveLength(1 + payload.entries.length);
  });

  it('legt Vorschau und vergrößerte Fassung als JPEG ohne Metadaten in der Fotoablage ab', async () => {
    const { backend, anna } = await photoWorld();
    const draft = await analyzedDraft(backend, anna.device);

    applied((await push(backend, anna.device, [confirmOp(confirmation(draft.result))]))[0]);

    const storage = storageOf(backend);
    const preview = await storage.readPhoto(draft.imageKey, 'vorschau');
    const large = await storage.readPhoto(draft.imageKey, 'gross');
    expect(preview).not.toBeNull();
    expect(large).not.toBeNull();
    const previewMeta = await sharp(preview!).metadata();
    const largeMeta = await sharp(large!).metadata();
    // 1.600 × 1.200 px: lange Kante 400 bzw. 1.280 px, Seitenverhältnis bleibt.
    expect([previewMeta.format, previewMeta.width, previewMeta.height]).toEqual(['jpeg', 400, 300]);
    expect([largeMeta.format, largeMeta.width, largeMeta.height]).toEqual(['jpeg', 1_280, 960]);
    for (const meta of [previewMeta, largeMeta]) {
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }
    expect(Buffer.from(large!).includes('Anna Beispiel')).toBe(false);
  });

  it('ein zweites Gerät derselben Person erhält Foto und Einträge per Pull, der Partner nichts davon', async () => {
    const { backend, anna } = await photoWorld();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const draft = await analyzedDraft(backend, anna.device);
    const payload = confirmation(draft.result);
    applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);

    const { changes } = await pullAll(backend, anna.device);
    const photo = changes.find((change) => change.entityType === 'meal_photo');
    expect(photo).toMatchObject({ type: 'record', entityId: payload.photoId });
    expect(changes.filter((change) => change.entityType === 'nutrition_entry')).toHaveLength(payload.entries.length);
    expect((await pullAll(backend, philipp.device)).changes.filter((change) => ['meal_photo', 'nutrition_entry'].includes(change.entityType))).toEqual([]);
  });
});

describe('confirmPhotoDraft: ohne gültigen Entwurf legt der Server die Einträge ohne Foto an', () => {
  it('abgelaufener Entwurf: kanonische Einträge ohne Foto, der Entwurf bleibt dem Aufräumjob', async () => {
    const clock = createTestClock(lunchtime);
    const { backend, anna } = await photoWorld({ clock });
    const draft = await analyzedDraft(backend, anna.device);
    clock.set(draft.result.expiresAt);
    const payload = confirmation(draft.result);

    const { changes } = applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);

    expect(changes?.map((change) => change.entityType)).toEqual(payload.entries.map(() => 'nutrition_entry'));
    for (const change of changes ?? []) {
      if (change.type !== 'record') throw new Error('Datensatz erwartet');
      expect(NutritionEntryRecord.parse(change.data).mealPhotoId).toBeNull();
    }
    const { photos, entries, drafts } = await rows(backend);
    expect(photos).toEqual([]);
    expect(entries.map((entry) => entry.mealPhotoId)).toEqual(payload.entries.map(() => null));
    expect(drafts.map((row) => row.id)).toEqual([draft.result.draftId]);
    expect(await storageOf(backend).readPhoto(draft.imageKey, 'vorschau')).toBeNull();
  });

  it('fremder Entwurf: Einträge ohne Foto; der Entwurf der anderen Person bleibt unberührt', async () => {
    const { backend, anna } = await photoWorld();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const annasDraft = await analyzedDraft(backend, anna.device);
    const payload = confirmation(annasDraft.result);

    const { changes } = applied((await push(backend, philipp.device, [confirmOp(payload)]))[0]);

    expect(changes?.map((change) => change.entityType)).toEqual(payload.entries.map(() => 'nutrition_entry'));
    const { photos, entries, drafts } = await rows(backend);
    expect(photos).toEqual([]);
    expect(entries.every((entry) => entry.personId === philipp.personId && entry.mealPhotoId === null)).toBe(true);
    expect(drafts.map((row) => row.id)).toEqual([annasDraft.result.draftId]);
    expect(await storageOf(backend).readDraft(annasDraft.imageKey)).not.toBeNull();
    // Anna bestätigt danach ihren eigenen Entwurf wie gewohnt.
    applied((await push(backend, anna.device, [confirmOp(confirmation(annasDraft.result))]))[0]);
    expect((await rows(backend)).photos).toHaveLength(1);
  });

  it('unbekannter Entwurf, etwa nach dem Aufräumen: Einträge ohne Foto', async () => {
    const { backend, anna } = await photoWorld();
    const draft = await analyzedDraft(backend, anna.device);
    const payload = confirmation({ ...draft.result, draftId: EntityId.parse(randomUUID()) });

    const { changes } = applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);

    expect(changes?.map((change) => change.entityType)).toEqual(payload.entries.map(() => 'nutrition_entry'));
    expect((await rows(backend)).photos).toEqual([]);
  });

  it('ein Entwurf ist nur einmal bestätigbar; eine zweite Bestätigung bleibt ohne Foto', async () => {
    const { backend, anna } = await photoWorld();
    const draft = await analyzedDraft(backend, anna.device);
    applied((await push(backend, anna.device, [confirmOp(confirmation(draft.result))]))[0]);

    const second = confirmation(draft.result);
    const { changes } = applied((await push(backend, anna.device, [confirmOp(second)]))[0]);

    expect(changes?.map((change) => change.entityType)).toEqual(second.entries.map(() => 'nutrition_entry'));
    expect((await rows(backend)).photos).toHaveLength(1);
  });
});

describe('confirmPhotoDraft: Idempotenz und Ablehnung', () => {
  it('doppelte Bestätigung mit neuer Operations-ID: already_applied mit denselben kanonischen Ergebnissen, nichts doppelt', async () => {
    const { backend, anna } = await photoWorld();
    const draft = await analyzedDraft(backend, anna.device);
    const payload = confirmation(draft.result);
    const first = applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);

    const [again] = await push(backend, anna.device, [confirmOp(payload)]);

    expect(again?.type).toBe('already_applied');
    expect(applied(again).changes).toEqual(first.changes);
    const { photos, entries } = await rows(backend);
    expect(photos).toHaveLength(1);
    expect(entries).toHaveLength(payload.entries.length);
  });

  it('verlorene Antwort: derselbe Retry erhält dasselbe Ergebnis, auch nach dem Aufräumen des Entwurfsbilds', async () => {
    const clock = createTestClock(lunchtime);
    const { backend, anna } = await photoWorld({ clock });
    const draft = await analyzedDraft(backend, anna.device);
    const operation = confirmOp(confirmation(draft.result));
    const first = applied((await push(backend, anna.device, [operation]))[0]);
    // Die Antwort ging verloren; inzwischen hat der Aufräumjob das Bild des bestätigten Entwurfs entfernt.
    clock.advanceBy(HOUR);
    await backend.jobs.runDue();
    expect(await storageOf(backend).readDraft(draft.imageKey)).toBeNull();

    const [retry] = await push(backend, anna.device, [operation]);

    expect(retry).toEqual({ ...first, type: 'already_applied' });
    expect((await rows(backend)).photos).toHaveLength(1);
    expect(await storageOf(backend).readPhoto(draft.imageKey, 'gross')).not.toBeNull();
  });

  it('dieselbe Foto-ID mit anderem Inhalt ist ein operation_conflict', async () => {
    const { backend, anna } = await photoWorld();
    const draft = await analyzedDraft(backend, anna.device);
    const payload = confirmation(draft.result);
    applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);

    const [conflict] = await push(backend, anna.device, [confirmOp({ ...payload, sharedWithPartner: false })]);

    expect(conflict).toMatchObject({ type: 'permanently_rejected', error: { code: 'operation_conflict' } });
  });

  it('eine Ablehnung rollt alle Zeilen zurück: kein Eintrag, kein Foto, der Entwurf bleibt bestätigbar', async () => {
    const clock = createTestClock(lunchtime);
    const { backend, anna } = await photoWorld({ clock });
    const draft = await analyzedDraft(backend, anna.device);
    // Zwei Tage nach dem heutigen Tag der Person, einer mehr als die Toleranz. Das Foto ist zu diesem
    // Zeitpunkt schon geschrieben; die Ablehnung muss auch es zurückrollen.
    const tooLate = confirmation(draft.result, { meal: { localDate: LocalDate.parse('2026-10-16') } });

    const [rejected] = await push(backend, anna.device, [confirmOp(tooLate)]);

    expect(rejected).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' }, canonical: { type: 'absent' } });
    const { photos, entries, drafts } = await rows(backend);
    expect([photos, entries]).toEqual([[], []]);
    expect(drafts.map((row) => row.id)).toEqual([draft.result.draftId]);
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityType, 'meal_photo'))).toEqual([]);

    const retry = confirmation(draft.result);
    const { changes } = applied((await push(backend, anna.device, [confirmOp(retry)]))[0]);
    expect(changes?.[0]).toMatchObject({ entityType: 'meal_photo', entityId: retry.photoId });
  });

  it('lehnt einen fachlichen Schlüssel ab, der nicht zur Foto-ID passt, und vergebene Eintrags-IDs', async () => {
    const { backend, anna } = await photoWorld();
    const draft = await analyzedDraft(backend, anna.device);
    const payload = confirmation(draft.result);

    const [wrongKey] = await push(backend, anna.device, [confirmOp(payload, { businessKey: `mahlzeitenfoto:${randomUUID()}` })]);
    expect(wrongKey).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });

    applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);
    const second = confirmation(draft.result);
    const reusedIds = ConfirmPhotoDraft.parse({ ...second, entries: second.entries.map((item, index) => ({ ...item, id: payload.entries[index]!.id })) });
    const [taken] = await push(backend, anna.device, [confirmOp(reusedIds)]);
    expect(taken).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
  });
});

describe('Mahlzeitenfoto im generischen Sync', () => {
  async function confirmed() {
    const world = await photoWorld();
    const draft = await analyzedDraft(world.backend, world.anna.device);
    const payload = confirmation(draft.result);
    applied((await push(world.backend, world.anna.device, [confirmOp(payload)]))[0]);
    return { ...world, draft, payload };
  }

  it('ändert den Freigabeschalter per Upsert und löscht per Tombstone', async () => {
    const { backend, anna, payload } = await confirmed();

    const [shared] = await push(backend, anna.device, [upsertOp(payload.photoId, { sharedWithPartner: false }, { entityType: 'meal_photo' })]);
    expect(shared).toMatchObject({ type: 'applied', canonical: { type: 'record', data: { sharedWithPartner: false } } });

    const [deleted] = await push(backend, anna.device, [deleteOp(payload.photoId, { entityType: 'meal_photo' })]);
    expect(deleted).toMatchObject({ type: 'applied', canonical: { type: 'tombstone', entityId: payload.photoId } });
    // Die Einträge bleiben (Spezifikation 2, Abschnitt 9).
    expect((await rows(backend)).entries.every((entry) => entry.deletedAt === null)).toBe(true);
  });

  it('kennt kein generisches Create und keine Bildfelder im Upsert', async () => {
    const { backend, anna, payload, draft } = await confirmed();

    const [created] = await push(backend, anna.device, [upsertOp(randomUUID(), { sharedWithPartner: true }, { entityType: 'meal_photo' })]);
    expect(created).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    const [imageKey] = await push(backend, anna.device, [upsertOp(payload.photoId, { sharedWithPartner: true, imageKey: draft.imageKey }, { entityType: 'meal_photo' })]);
    expect(imageKey).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect((await rows(backend)).photos).toHaveLength(1);
  });

  it('ein Eintrag verweist nur auf eigene Fotos, sonst permanently_rejected', async () => {
    const { backend, payload } = await confirmed();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const entry = payload.entries[0]!.entry;

    const [foreign] = await push(backend, philipp.device, [upsertOp(randomUUID(), entry, { entityType: 'nutrition_entry' })]);

    expect(foreign).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect((await rows(backend)).entries.filter((row) => row.personId === philipp.personId)).toEqual([]);
  });
});

describe('Fotoablage aufräumen', () => {
  it('entfernt das Bild eines bestätigten Entwurfs und die Dateien gelöschter Fotos, behält alles Übrige', async () => {
    const clock = createTestClock(lunchtime);
    const { backend, anna } = await photoWorld({ clock });
    const confirmedDraft = await analyzedDraft(backend, anna.device);
    const open = await analyzedDraft(backend, anna.device);
    const payload = confirmation(confirmedDraft.result);
    applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);
    const storage = storageOf(backend);
    expect(await storage.readDraft(confirmedDraft.imageKey)).not.toBeNull();

    await backend.jobs.runDue();

    expect(await storage.readDraft(confirmedDraft.imageKey)).toBeNull();
    expect(await storage.readPhoto(confirmedDraft.imageKey, 'vorschau')).not.toBeNull();
    expect(await storage.readDraft(open.imageKey)).not.toBeNull();

    await push(backend, anna.device, [deleteOp(payload.photoId, { entityType: 'meal_photo' })]);
    clock.advanceBy(CLEANUP_INTERVAL_MS);
    await backend.jobs.runDue();
    expect(await storage.readPhoto(confirmedDraft.imageKey, 'vorschau')).toBeNull();
    expect(await storage.readPhoto(confirmedDraft.imageKey, 'gross')).toBeNull();
  });

  it('Dateien einer zurückgerollten Bestätigung bleiben beim Entwurf und gehen mit seinem Ablauf', async () => {
    const clock = createTestClock(lunchtime);
    const { backend, anna } = await photoWorld({ clock });
    const draft = await analyzedDraft(backend, anna.device);
    const storage = storageOf(backend);
    // So sähe die Ablage aus, wenn die Transaktion nach dem Schreiben der Dateien zurückrollt.
    const image = (await storage.readDraft(draft.imageKey))!;
    await storage.savePhoto(draft.imageKey, { vorschau: image, gross: image });
    // Dazu ein halb geschriebener Ordner ohne jeden Besitzer.
    const orphan = storage.newImageKey();
    await mkdir(join(backend.photoStorageDirectory, 'fotos', `${orphan}.teil`), { recursive: true });
    await writeFile(join(backend.photoStorageDirectory, 'fotos', `${orphan}.teil`, 'vorschau.jpg'), image);

    await backend.jobs.runDue();
    expect(await storage.readPhoto(draft.imageKey, 'gross')).not.toBeNull();
    expect((await storage.storedKeys()).photos).toEqual([draft.imageKey]);

    clock.set(draft.result.expiresAt);
    await backend.jobs.runDue();
    // Der Entwurfsjob löscht Zeile und Bild, der Ablagejob spätestens im nächsten Lauf die verwaisten Fassungen.
    clock.advanceBy(CLEANUP_INTERVAL_MS);
    await backend.jobs.runDue();
    expect(await storage.storedKeys()).toEqual({ drafts: [], photos: [] });
  });
});

describe('Autorisierung von confirmPhotoDraft', () => {
  for (const testCase of authorizationCases({ ...confirmPhotoDraftScenario, command: 'confirmPhotoDraft' })) it(testCase.name, testCase.run, 30_000);

  it('ein Mahlzeitenfoto des Partners ist auch für Upsert und Löschen verweigert', async () => {
    const { backend, anna } = await photoWorld();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const draft = await analyzedDraft(backend, anna.device);
    const payload = confirmation(draft.result);
    applied((await push(backend, anna.device, [confirmOp(payload)]))[0]);

    const [upsert, remove] = await push(backend, philipp.device, [
      upsertOp(payload.photoId, { sharedWithPartner: false }, { entityType: 'meal_photo' }),
      deleteOp(payload.photoId, { entityType: 'meal_photo' }),
    ], installationB);

    for (const result of [upsert, remove]) expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'forbidden' }, canonical: { type: 'absent' } });
    expect((await rows(backend)).photos[0]).toMatchObject({ sharedWithPartner: true, deletedAt: null });
  });
});
