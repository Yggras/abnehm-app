/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { seedClock, seedDays, seedIds, seedManifests, type SeedManifest } from '@abnehm/contracts/seeds';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { mealPhoto, nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { createNutrition, InvalidNutritionInputError, mealPhotoEntity, nutritionEntryEntity, type DayLog, type MealPhotoDetail } from '.';
import { withoutNetwork } from './testing/without-network';

// Nachweis für #164 an der Naht des App-Moduls „Ernährung“: eigene Mahlzeitenfotos im Tagesprotokoll, die
// Fotoansicht mit Freigabeschalter, „Mit Partner teilen“ als generisches Upsert, „Foto löschen“ als Tombstone
// und „Rückgängig“ nach dem Löschen eines Eintrags, das nur ein nicht gelöschtes Foto wieder verknüpft.
// Grundlage sind die Seeds `gekoppelt` (Philipps geteiltes Foto vom Mittagessen) und `solo`.

const today = LocalDate.parse(seedDays.heute);
const photoId = EntityId.parse(seedIds.mealPhoto.philippHeute);
const annasPhoto = EntityId.parse(seedIds.mealPhoto.annaHeute);
/** Philipps zweites Foto zum Mittagessen, einzeln vom Teilen ausgenommen; sein verwaistes Foto hat keinen Eintrag mehr. */
const privatePhoto = EntityId.parse(seedIds.mealPhoto.philippNichtGeteilt);
const orphanPhoto = EntityId.parse(seedIds.mealPhoto.philippVerwaist);
const lunchEntry = EntityId.parse(seedIds.nutritionEntry.philippMittag);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup(manifest: SeedManifest = seedManifests.gekoppelt) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  seedLocalDatabase(database, manifest, 'philipp-iphone');
  const clock = createTestClock({ instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, mealPhotoEntity]), clock, newId });
  const reports: unknown[] = [];
  const nutrition = createNutrition({ ...withoutNetwork, database, clock, writer, newId, persistence: { reevaluateDailyGoals: (_tx, ...report) => void reports.push(report) } });
  const dayLog = () => {
    let log: DayLog | null = null;
    nutrition.observeDayLog(today, (next) => (log = next))();
    return log as DayLog | null;
  };
  const detail = (id: EntityId = photoId) => {
    let seen: MealPhotoDetail | null | undefined;
    nutrition.observeMealPhoto(id, (next) => (seen = next))();
    return seen;
  };
  const read = () =>
    database.read((tx) => ({
      photos: sqliteOf(tx).select().from(mealPhoto).all(),
      entries: sqliteOf(tx).select().from(nutritionEntry).all(),
      operations: pendingOperations(tx, 100),
    }));
  return { database, nutrition, dayLog, detail, read, reports };
}

const lunchOf = (log: DayLog | null) => log!.meals.find((meal) => meal.meal === 'mittagessen')!;

describe('Mahlzeitenfotos im Tagesprotokoll', () => {
  it('nennt je Mahlzeit die bestätigten, nicht gelöschten Fotos ihrer Einträge', async () => {
    const { dayLog } = await setup();

    const log = dayLog();

    expect(lunchOf(log).photoIds).toEqual([photoId, privatePhoto]);
    expect(log!.meals.filter((meal) => meal.meal !== 'mittagessen').map((meal) => meal.photoIds)).toEqual([[], [], []]);
  });

  it('ein Foto, dessen Bestätigung noch in der Outbox steht, lässt sich noch nicht abrufen', async () => {
    const { nutrition, dayLog } = await setup();
    nutrition.confirmPhotoDraft({
      draftId: EntityId.parse(randomUUID()),
      localDate: today,
      meal: 'abendessen',
      components: [{ foodRef: null, snapshot: { name: 'Suppe', baseUnit: 'g', referenceAmount: 100_000, milliKcal: 50_000, proteinMg: 1_000,
        carbsMg: 5_000, fatMg: 1_000, portions: [], source: 'ki', attribution: null }, displayUnit: 'g', displayAmountMilli: 300_000 }],
    });

    expect(dayLog()!.meals.find((meal) => meal.meal === 'abendessen')!.photoIds).toEqual([]);
  });
});

describe('Fotoansicht', () => {
  it('zeigt den Freigabeschalter bei aktiver Kopplung', async () => {
    const { detail } = await setup();

    expect(detail()).toEqual({ id: photoId, sharedWithPartner: true, partnerCoupled: true });
    expect(detail(privatePhoto)).toEqual({ id: privatePhoto, sharedWithPartner: false, partnerCoupled: true });
  });

  it('das verwaiste Foto zeigt das Protokoll nicht, die Fotoansicht kennt es aber noch', async () => {
    const { dayLog, detail } = await setup();

    expect(dayLog()!.meals.flatMap((meal) => meal.photoIds)).not.toContain(orphanPhoto);
    expect(detail(orphanPhoto)).toMatchObject({ id: orphanPhoto });
  });

  it('ohne Kopplung verbirgt sie ihn', async () => {
    const { database, detail } = await setup(seedManifests.solo);
    // `solo` hat kein Foto: Philipps Foto aus `gekoppelt` kommt per Pull ohne Kopplung dazu.
    const photo = seedManifests.gekoppelt.initial.devices['philipp-iphone']!.rows.meal_photo!.find((row) => row.id === photoId)!;
    database.transaction((tx) =>
      sqliteOf(tx).insert(mealPhoto).values({
        id: photoId, personId: String(photo.person_id), imageKey: String(photo.image_key), capturedAt: String(photo.captured_at),
        sharedWithPartner: true, createdAt: String(photo.created_at), updatedAt: String(photo.updated_at), serverVersion: '1',
      }).run(),
    );

    expect(detail()).toEqual({ id: photoId, sharedWithPartner: true, partnerCoupled: false });
  });

  it('kennt fremde und unbekannte Fotos nicht', async () => {
    const { detail } = await setup();

    expect(detail(annasPhoto)).toBeNull();
    expect(detail(EntityId.parse(randomUUID()))).toBeNull();
  });
});

describe('„Mit Partner teilen“', () => {
  it('schreibt den Schalter und genau ein generisches Upsert, ohne Tagesmeldung', async () => {
    const { nutrition, detail, read, reports } = await setup();
    const known = read().photos.find((row) => row.id === photoId)!.serverVersion;

    nutrition.setPhotoSharing(photoId, false);

    expect(detail()).toMatchObject({ sharedWithPartner: false });
    expect(read().operations).toEqual([
      expect.objectContaining({ type: 'upsert_entity', entityType: 'meal_photo', entityId: photoId, payload: { sharedWithPartner: false }, knownServerVersion: known }),
    ]);
    expect(reports).toEqual([]);
  });

  it('ein unveränderter Schalter schreibt nichts', async () => {
    const { nutrition, read } = await setup();

    nutrition.setPhotoSharing(photoId, true);

    expect(read().operations).toEqual([]);
  });

  it('lehnt fremde, unbekannte und gelöschte Fotos ab, ohne zu schreiben', async () => {
    const { nutrition, read } = await setup();
    nutrition.deletePhoto(photoId);
    const before = read();

    for (const id of [annasPhoto, EntityId.parse(randomUUID()), photoId]) {
      expect(() => nutrition.setPhotoSharing(id, false)).toThrow(InvalidNutritionInputError);
    }
    expect(read()).toEqual(before);
  });
});

describe('„Foto löschen“', () => {
  it('ist ein Tombstone mit genau einer Löschoperation; die Einträge bleiben samt Verknüpfung', async () => {
    const { nutrition, read, dayLog, detail, reports } = await setup();

    nutrition.deletePhoto(photoId);

    const { photos, entries, operations } = read();
    expect(photos.find((row) => row.id === photoId)!.deletedAt).toBe(seedClock.instant);
    expect(operations).toEqual([expect.objectContaining({ type: 'delete_entity', entityType: 'meal_photo', entityId: photoId })]);
    expect(entries.find((row) => row.id === lunchEntry)).toMatchObject({ deletedAt: null, mealPhotoId: photoId });
    // Das Protokoll zeigt das Foto nicht mehr, der Eintrag behält sein Foto-/KI-Symbol.
    expect(lunchOf(dayLog()).photoIds).toEqual([privatePhoto]);
    expect(lunchOf(dayLog()).entries.find((entry) => entry.id === lunchEntry)).toMatchObject({ fromPhoto: true });
    expect(detail()).toBeNull();
    expect(reports).toEqual([]);
  });

  it('ein zweites Löschen und ein fremdes Foto sind abgelehnt', async () => {
    const { nutrition } = await setup();
    nutrition.deletePhoto(photoId);

    expect(() => nutrition.deletePhoto(photoId)).toThrow(InvalidNutritionInputError);
    expect(() => nutrition.deletePhoto(annasPhoto)).toThrow(InvalidNutritionInputError);
  });
});

describe('„Rückgängig“ nach dem Löschen eines Fotoeintrags', () => {
  it('verknüpft ein nicht gelöschtes Foto wieder mit dem neuen Eintrag', async () => {
    const { nutrition, read, dayLog } = await setup();

    const { undoToken } = nutrition.deleteEntry(lunchEntry);
    expect(lunchOf(dayLog()).photoIds).toEqual([privatePhoto]);
    nutrition.undo(undoToken);

    const restored = read().entries.find((row) => row.deletedAt === null && row.id !== lunchEntry && row.snapshotName === 'Linsensuppe');
    expect(restored).toMatchObject({ captureMethod: 'foto', mealPhotoId: photoId });
    expect(lunchOf(dayLog()).photoIds).toEqual(expect.arrayContaining([photoId, privatePhoto]));
  });

  it('Foto gelöscht, dann Rückgängig: Der neue Eintrag bleibt ohne Foto', async () => {
    const { nutrition, read } = await setup();

    const { undoToken } = nutrition.deleteEntry(lunchEntry);
    nutrition.deletePhoto(photoId);
    nutrition.undo(undoToken);

    const restored = read().entries.find((row) => row.deletedAt === null && row.snapshotName === 'Linsensuppe');
    expect(restored).toMatchObject({ captureMethod: 'foto', mealPhotoId: null });
    const upserted = read().operations.find((operation) => operation.type === 'upsert_entity' && operation.entityId === restored!.id);
    expect(upserted).toMatchObject({ payload: { mealPhotoId: null } });
  });

  it.each([
    ['per Pull gelöscht', 'tombstone'],
    ['als nie bestätigtes Foto entfernt', 'entfernt'],
  ] as const)('auch wenn das Foto %s wurde', async (_name, change) => {
    const { database, nutrition, read } = await setup();
    const { undoToken } = nutrition.deleteEntry(lunchEntry);
    database.transaction((tx) => {
      const db = sqliteOf(tx);
      if (change === 'tombstone') {
        db.update(mealPhoto).set({ deletedAt: seedClock.instant }).run();
      } else {
        // Wie `removeUnconfirmedPhoto`: erst die Einträge lösen, dann die Zeile entfernen.
        db.update(nutritionEntry).set({ mealPhotoId: null }).run();
        db.delete(mealPhoto).run();
      }
    });

    nutrition.undo(undoToken);

    expect(read().entries.find((row) => row.deletedAt === null && row.snapshotName === 'Linsensuppe')).toMatchObject({ mealPhotoId: null });
  });
});
