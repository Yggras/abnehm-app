import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, LocalDate } from '@abnehm/contracts/base';
import { photoDraftSnapshot, type PhotoAnalysisResult } from '@abnehm/contracts/nutrition';

import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity } from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { mealPhoto as localMealPhoto, nutritionEntry as localNutritionEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createNutrition, mealPhotoEntity, nutritionEntryEntity, confirmPhotoDraftCommand, type PhotoDraftConfirmation } from '../../mobile/src/nutrition/index.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../mobile/src/sync/index.ts';
import { mealPhoto, nutritionEntry } from '../src/db/schema/index.ts';
import { testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { analyzedDraft, lunchtime, photoWorld } from './support/meal-photos.ts';
import { withoutPhotos } from '../../mobile/src/nutrition/testing/without-photos.ts';

// Nachweis für #162 über die App-Engine: „Mahlzeit hinzufügen“ im App-Modul „Ernährung“ geht als ein
// Fachbefehl `confirmPhotoDraft` über die echte Hono-App nach Postgres. Mit gültigem Entwurf übernimmt
// das Gerät das kanonische Foto samt Bildschlüssel; ohne gültigen Entwurf übernimmt es die kanonischen
// Einträge ohne Foto und entfernt sein lokales Foto. App-Code läuft auf echtem SQLite (better-sqlite3).

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Eine Installation wie im Composition Root: Sync mit Befehls-Registry, Persistenzdienst und Ernährungsmodul. */
async function phone(backend: TestBackend, accountId: string, device: Device, clock: TestClock) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity, nutritionEntryEntity, mealPhotoEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const commands = createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, confirmPhotoDraftCommand({ persistence })] });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId(), onCanonicalChanges: persistence.onCanonicalChanges, commands });
  return {
    nutrition: createNutrition({ ...withoutPhotos, database, clock, writer, persistence, newId }),
    sync: () => engine.sync(),
    rows: () => database.read((tx) => ({ photos: sqliteOf(tx).select().from(localMealPhoto).all(), entries: sqliteOf(tx).select().from(localNutritionEntry).all() })),
  };
}

/** Alle Bestandteile unverändert übernommen, zum Mittagessen von heute. */
function lunchOf(draft: PhotoAnalysisResult): PhotoDraftConfirmation {
  return {
    draftId: draft.draftId,
    localDate: LocalDate.parse('2026-10-14'),
    meal: 'mittagessen',
    components: draft.components.map((component) => ({
      foodRef: null,
      snapshot: photoDraftSnapshot(component),
      displayUnit: component.baseUnit,
      displayAmountMilli: component.baseUnit === 'g' ? component.baseAmount : component.baseAmount * 1_000,
    })),
  };
}

async function setup() {
  const clock = createTestClock(lunchtime);
  const { backend, anna } = await photoWorld({ clock });
  const app = await phone(backend, anna.accountId, anna.device, clock);
  await app.sync();
  return { backend, anna, app, clock };
}

describe('Fotoentwurf bestätigen über die App-Engine', () => {
  it('mit gültigem Entwurf übernimmt das Gerät das kanonische Foto samt Bildschlüssel und die verknüpften Einträge', async () => {
    const { backend, anna, app } = await setup();
    const draft = await analyzedDraft(backend, anna.device);

    app.nutrition.confirmPhotoDraft(lunchOf(draft.result));
    const [localPhoto] = app.rows().photos;
    expect(localPhoto!.imageKey).toBe(`entwurf:${draft.result.draftId}`);
    expect(await app.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(mealPhoto).where(eq(mealPhoto.id, localPhoto!.id));
    const { photos, entries } = app.rows();
    expect(photos).toEqual([expect.objectContaining({
      id: localPhoto!.id,
      imageKey: draft.imageKey,
      capturedAt: draft.createdAt.toISOString(),
      sharedWithPartner: true,
      serverVersion: stored!.serverVersion.toString(),
    })]);
    expect(entries).toHaveLength(draft.result.components.length);
    expect(entries.every((entry) => entry.mealPhotoId === localPhoto!.id && entry.serverVersion !== null)).toBe(true);
  });

  it('mit abgelaufenem Entwurf: kanonische Antwort ohne Foto, das Gerät entfernt sein Foto und behält die Einträge', async () => {
    const { backend, anna, app, clock } = await setup();
    const draft = await analyzedDraft(backend, anna.device);
    // Die Person bestätigt offline; das Gerät erreicht den Server erst nach Ablauf des Entwurfs.
    app.nutrition.confirmPhotoDraft(lunchOf(draft.result));
    const [localPhoto] = app.rows().photos;
    clock.set(draft.result.expiresAt);

    expect(await app.sync()).toEqual({ push: 'done', pull: 'done' });

    expect(await backend.database.db.select().from(mealPhoto)).toEqual([]);
    const serverEntries = await backend.database.db.select().from(nutritionEntry);
    expect(serverEntries.map((entry) => entry.mealPhotoId)).toEqual(draft.result.components.map(() => null));
    const { photos, entries } = app.rows();
    expect(photos.filter((photo) => photo.id === localPhoto!.id)).toEqual([]);
    expect(entries.map(({ id, mealPhotoId, serverVersion }) => [id, mealPhotoId, serverVersion !== null]).sort()).toEqual(
      serverEntries.map(({ id }) => [id, null, true]).sort(),
    );
  });
});
