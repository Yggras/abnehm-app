/// <reference types="expo-router/build/ts-declarations/expect" />
import { screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { MealPhotoVariant } from '@abnehm/contracts/nutrition';
import { seedClock, seedDays, seedIds, seedManifests, type SeedManifest } from '@abnehm/contracts/seeds';

import { testCapabilities } from '../build-capabilities';
import { hitArea } from '../design/testing/hit-area';
import { createLocalDatabases } from '../local-db/local-databases';
import { mealPhoto, nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import type { OnlineResult } from '../online';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appNutrition, createNutrition, mealPhotoEntity, nutritionEntryEntity, type MealPhotoImage } from '.';

// Nachweis für #164 am gerenderten Bildschirm: Protokoll mit Vorschau und Fotoansicht mit dem echten
// Verzeichnis `src/app` und dem echten Ernährungsmodul über einer geseedeten SQLite-Datei. Den Bildabruf
// ersetzt ein Test-Adapter, der online ein Bild liefert oder offline meldet.

jest.setTimeout(30_000);
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));

const appDir = 'src/app';
const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const photoId = EntityId.parse(seedIds.mealPhoto.philippHeute);
const lunchEntry = EntityId.parse(seedIds.nutritionEntry.philippMittag);
const lunchLabel = 'Mittagessen: Linsensuppe, 300 g, 270 kcal, KI-Schätzung';

/** Bildabruf als Test-Adapter: `online` liefert je Fassung ein erkennbares Bild, sonst `offline`. */
function photoSource() {
  const network = { online: true };
  const calls: [EntityId, MealPhotoVariant][] = [];
  const images = async (id: EntityId, variant: MealPhotoVariant): Promise<OnlineResult<MealPhotoImage>> => {
    calls.push([id, variant]);
    return network.online ? { type: 'ok', value: { uri: `data:image/jpeg;base64,${variant}` } } : { type: 'offline' };
  };
  return { network, calls, images };
}

let ids = 0;

/** Öffnet Philipps Kontodatenbank mit einem Seed, wie die App-Sitzung, mit der Uhr des Manifests. */
async function openAccount(manifest: SeedManifest = seedManifests.gekoppelt) {
  const clock = testCapabilities!.clock;
  clock.fix({ instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) });
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  seedLocalDatabase(database, manifest, 'philipp-iphone');
  const newId = () => EntityId.parse(`10000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  const source = photoSource();
  const nutrition = createNutrition({
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, mealPhotoEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
    photoImages: source.images,
  });
  const release = appNutrition.opened(nutrition);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
    clock.release();
  });
  return {
    database,
    nutrition,
    source,
    photo: () => database.read((tx) => sqliteOf(tx).select().from(mealPhoto).all()).find((row) => row.id === photoId),
    entries: () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all()).filter((row) => row.deletedAt === null),
    operations: () => database.read((tx) => pendingOperations(tx, 100)).map(({ type, entityType, payload }) => ({ type, entityType, payload })),
  };
}

const lunch = () => screen.getByTestId('mahlzeit-mittagessen');

/** Öffnet die Fotoansicht über die Vorschau des Mittagessens. */
async function openPhoto() {
  await user.press(await within(lunch()).findByRole('button', { name: 'Mahlzeitenfoto, Mittagessen' }));
  return screen.findByRole('header', { name: 'Mahlzeitenfoto' });
}

describe('Mahlzeitenfotos im Protokoll', () => {
  it('online zeigt das Mittagessen die Vorschau seines Fotos, mit deutschem zugänglichem Namen und 48 dp', async () => {
    const { source } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });

    const thumb = await within(lunch()).findByRole('button', { name: 'Mahlzeitenfoto, Mittagessen' });
    expect(within(thumb).getByTestId('mahlzeitenfoto-vorschau', { includeHiddenElements: true }).props.source).toEqual({ uri: 'data:image/jpeg;base64,vorschau' });
    expect(Math.min(hitArea(thumb).width, hitArea(thumb).height)).toBeGreaterThanOrEqual(48);
    expect(source.calls).toEqual([[photoId, 'vorschau']]);
    // Der Eintrag behält sein Foto-/KI-Symbol; Mahlzeiten ohne Foto zeigen keine Vorschau.
    expect(within(lunch()).getByLabelText(lunchLabel)).toBeOnTheScreen();
    expect(within(screen.getByTestId('mahlzeit-fruehstueck')).queryByRole('button', { name: /Mahlzeitenfoto/ })).not.toBeOnTheScreen();
  });

  it('offline zeigt das Protokoll nur das Foto-/KI-Symbol', async () => {
    const { source } = await openAccount();
    source.network.online = false;
    await renderRouter(appDir, { initialUrl: '/log' });

    const entry = await within(lunch()).findByLabelText(lunchLabel);
    expect(within(entry).getByTestId('icon-camera', { includeHiddenElements: true })).toBeOnTheScreen();
    await waitFor(() => expect(within(lunch()).queryByLabelText('Foto lädt')).not.toBeOnTheScreen());
    expect(within(lunch()).queryByRole('button', { name: 'Mahlzeitenfoto, Mittagessen' })).not.toBeOnTheScreen();
  });
});

describe('Fotoansicht', () => {
  it('zeigt das vergrößerte Foto und bei aktiver Kopplung „Mit Partner teilen“; Ausschalten schreibt ein Upsert', async () => {
    const { source, photo, operations } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });

    await openPhoto();

    const image = await screen.findByRole('image', { name: 'Mahlzeitenfoto, Mittagessen' });
    expect(image.props.source).toEqual({ uri: 'data:image/jpeg;base64,gross' });
    expect(source.calls).toContainEqual([photoId, 'gross']);
    const toggle = screen.getByRole('switch', { name: 'Mit Partner teilen' });
    expect(toggle).toBeChecked();
    expect(Math.min(hitArea(toggle).width, hitArea(toggle).height)).toBeGreaterThanOrEqual(48);

    await user.press(toggle);

    expect(screen.getByRole('switch', { name: 'Mit Partner teilen' })).not.toBeChecked();
    expect(photo()!.sharedWithPartner).toBe(false);
    expect(operations()).toEqual([{ type: 'upsert_entity', entityType: 'meal_photo', payload: { sharedWithPartner: false } }]);
  });

  it('ohne Kopplung ist der Schalter verborgen', async () => {
    const { nutrition, database } = await openAccount(seedManifests.solo);
    // `solo` hat kein Foto: Philipp bestätigt eines, und der Server hat es angenommen.
    nutrition.confirmPhotoDraft({
      draftId: EntityId.parse('5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03'),
      localDate: LocalDate.parse(seedDays.heute),
      meal: 'mittagessen',
      components: [{ foodRef: null, snapshot: { name: 'Linsensuppe', baseUnit: 'g', referenceAmount: 100_000, milliKcal: 90_000, proteinMg: 6_000,
        carbsMg: 12_000, fatMg: 2_000, portions: [], source: 'ki', attribution: null }, displayUnit: 'g', displayAmountMilli: 300_000 }],
    });
    database.transaction((tx) => sqliteOf(tx).update(mealPhoto).set({ serverVersion: '42' }).run());
    await renderRouter(appDir, { initialUrl: '/log' });

    await openPhoto();

    expect(await screen.findByRole('image', { name: 'Mahlzeitenfoto, Mittagessen' })).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Foto löschen' })).toBeOnTheScreen();
  });

  it('offline: Kommt das vergrößerte Foto nicht an, nennt die Ansicht den Grund und lädt erneut', async () => {
    const { source } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });
    await within(lunch()).findByRole('button', { name: 'Mahlzeitenfoto, Mittagessen' });
    source.network.online = false;

    await openPhoto();

    expect(await screen.findByText('Das Foto lässt sich gerade nicht laden. Es braucht Internet.')).toBeOnTheScreen();
    // Schalter und Löschen funktionieren auch offline; sie laufen über die Outbox.
    expect(screen.getByRole('switch', { name: 'Mit Partner teilen' })).toBeOnTheScreen();

    source.network.online = true;
    await user.press(screen.getByRole('button', { name: 'Erneut laden' }));

    expect(await screen.findByRole('image', { name: 'Mahlzeitenfoto, Mittagessen' })).toBeOnTheScreen();
  });

  it('„Foto löschen“ fragt nach, löscht das Foto endgültig und behält die Einträge', async () => {
    const { photo, entries, operations } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });
    await openPhoto();

    await user.press(screen.getByRole('button', { name: 'Foto löschen' }));
    expect(screen.getByText('Foto endgültig löschen? Die Einträge bleiben.')).toBeOnTheScreen();
    // Abbrechen lässt alles, wie es ist.
    await user.press(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(photo()!.deletedAt).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Foto löschen' }));
    await user.press(screen.getByRole('button', { name: 'Endgültig löschen' }));

    expect(await screen.findByText('Foto gelöscht')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Mahlzeitenfoto' })).not.toBeOnTheScreen();
    expect(photo()!.deletedAt).toBe(seedClock.instant);
    expect(operations()).toEqual([{ type: 'delete_entity', entityType: 'meal_photo', payload: undefined }]);
    // Die Vorschau ist weg, der Eintrag bleibt mit seinem Foto-/KI-Symbol.
    expect(within(lunch()).queryByRole('button', { name: 'Mahlzeitenfoto, Mittagessen' })).not.toBeOnTheScreen();
    expect(within(lunch()).getByLabelText(lunchLabel)).toBeOnTheScreen();
    expect(entries().find((row) => row.id === lunchEntry)).toMatchObject({ mealPhotoId: photoId });
  });
});
