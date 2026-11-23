/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native';
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
import { withoutNetwork } from './testing/without-network';

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
/** Philipps zweites Foto zum Mittagessen, einzeln vom Teilen ausgenommen (#164). */
const privatePhotoId = EntityId.parse(seedIds.mealPhoto.philippNichtGeteilt);
/** In `gekoppelt` hat Philipps Mittagessen zwei Fotos: zuerst das geteilte, dann das ausgenommene. */
const sharedThumb = 'Mahlzeitenfoto 1 von 2, Mittagessen';
const privateThumb = 'Mahlzeitenfoto 2 von 2, Mittagessen';
const lunchEntry = EntityId.parse(seedIds.nutritionEntry.philippMittag);
const lunchLabel = 'Mittagessen: Linsensuppe, 300 g, 270 kcal, KI-Schätzung';

/**
 * Bildabruf und Netzstatus als Test-Adapter: Online liefert jede Fassung ein erkennbares Bild, sonst
 * `offline`; `answer` legt einen anderen Ausgang fest. `setOnline` meldet den Wechsel wie Expo Network.
 */
function photoSource() {
  const network = { online: true, answer: null as OnlineResult<MealPhotoImage> | null };
  const listeners = new Set<(online: boolean) => void>();
  const calls: [EntityId, MealPhotoVariant][] = [];
  const images = async (id: EntityId, variant: MealPhotoVariant): Promise<OnlineResult<MealPhotoImage>> => {
    calls.push([id, variant]);
    if (!network.online) return { type: 'offline' };
    return network.answer ?? { type: 'ok', value: { uri: `data:image/jpeg;base64,${variant}` } };
  };
  const observeOnline = (listener: (online: boolean) => void) => {
    listener(network.online);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const setOnline = (online: boolean) => {
    network.online = online;
    for (const listener of listeners) listener(online);
  };
  return { network, calls, images, observeOnline, setOnline };
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
  const nutrition = createNutrition({ ...withoutNetwork,
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, mealPhotoEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
    photoImages: source.images,
    observeOnline: source.observeOnline,
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
    operations: () => database.read((tx) => pendingOperations(tx, 100)).map((operation) => ({
      type: operation.type,
      entityType: 'entityType' in operation ? operation.entityType : undefined,
      payload: 'payload' in operation ? operation.payload : undefined,
    })),
  };
}

const lunch = () => screen.getByTestId('mahlzeit-mittagessen');

/** Öffnet die Fotoansicht über eine Vorschau des Mittagessens. */
async function openPhoto(name = sharedThumb) {
  await user.press(await within(lunch()).findByRole('button', { name }));
  return screen.findByRole('header', { name: 'Mahlzeitenfoto' });
}

describe('Mahlzeitenfotos im Protokoll', () => {
  it('online zeigt das Mittagessen die Vorschauen seiner Fotos, mit deutschen zugänglichen Namen und 48 dp', async () => {
    const { source } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });

    const thumb = await within(lunch()).findByRole('button', { name: sharedThumb });
    expect(await within(lunch()).findByRole('button', { name: privateThumb })).toBeOnTheScreen();
    expect(within(thumb).getByTestId('mahlzeitenfoto-vorschau', { includeHiddenElements: true }).props.source).toEqual({ uri: 'data:image/jpeg;base64,vorschau' });
    expect(Math.min(hitArea(thumb).width, hitArea(thumb).height)).toBeGreaterThanOrEqual(48);
    expect(source.calls).toEqual([[photoId, 'vorschau'], [privatePhotoId, 'vorschau']]);
    // Der Eintrag behält sein Foto-/KI-Symbol; Mahlzeiten ohne Foto zeigen keine Vorschau.
    expect(within(lunch()).getByLabelText(lunchLabel)).toBeOnTheScreen();
    expect(within(screen.getByTestId('mahlzeit-fruehstueck')).queryByRole('button', { name: /Mahlzeitenfoto/ })).not.toBeOnTheScreen();
  });

  it('geht das Gerät offline, verschwinden die Vorschauen; wieder online sind sie zurück', async () => {
    const { source } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });
    await within(lunch()).findByRole('button', { name: sharedThumb });

    await act(async () => source.setOnline(false));

    expect(within(lunch()).queryByRole('button', { name: /Mahlzeitenfoto/ })).not.toBeOnTheScreen();
    expect(within(lunch()).getByLabelText(lunchLabel)).toBeOnTheScreen();

    await act(async () => source.setOnline(true));

    expect(await within(lunch()).findByRole('button', { name: sharedThumb })).toBeOnTheScreen();
  });

  it('offline zeigt das Protokoll nur das Foto-/KI-Symbol', async () => {
    const { source } = await openAccount();
    source.network.online = false;
    await renderRouter(appDir, { initialUrl: '/log' });

    const entry = await within(lunch()).findByLabelText(lunchLabel);
    expect(within(entry).getByTestId('icon-camera', { includeHiddenElements: true })).toBeOnTheScreen();
    await waitFor(() => expect(within(lunch()).queryByLabelText('Foto lädt')).not.toBeOnTheScreen());
    expect(within(lunch()).queryByRole('button', { name: /Mahlzeitenfoto/ })).not.toBeOnTheScreen();
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
    expect(screen.getByText('Geteilte Fotos von heute sieht dein Partner unter „Wir“, ohne Namen, Mengen oder kcal.')).toBeOnTheScreen();

    await user.press(toggle);

    expect(screen.getByRole('switch', { name: 'Mit Partner teilen' })).not.toBeChecked();
    expect(photo()!.sharedWithPartner).toBe(false);
    expect(operations()).toEqual([{ type: 'upsert_entity', entityType: 'meal_photo', payload: { sharedWithPartner: false } }]);
  });

  it('ein einzeln vom Teilen ausgenommenes Foto zeigt den Schalter aus', async () => {
    await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });

    await openPhoto(privateThumb);

    expect(await screen.findByRole('switch', { name: 'Mit Partner teilen' })).not.toBeChecked();
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

    await openPhoto('Mahlzeitenfoto, Mittagessen');

    expect(await screen.findByRole('image', { name: 'Mahlzeitenfoto, Mittagessen' })).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Foto löschen' })).toBeOnTheScreen();
  });

  it('offline: Kommt das vergrößerte Foto nicht an, nennt die Ansicht den Grund und lädt erneut', async () => {
    const { source } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });
    await within(lunch()).findByRole('button', { name: sharedThumb });
    source.network.online = false;

    await openPhoto();

    expect(await screen.findByText('Das Foto lässt sich gerade nicht laden. Es braucht Internet.')).toBeOnTheScreen();
    // Schalter und Löschen funktionieren auch offline; sie laufen über die Outbox.
    expect(screen.getByRole('switch', { name: 'Mit Partner teilen' })).toBeOnTheScreen();

    source.network.online = true;
    await user.press(screen.getByRole('button', { name: 'Erneut laden' }));

    expect(await screen.findByRole('image', { name: 'Mahlzeitenfoto, Mittagessen' })).toBeOnTheScreen();
  });

  it('ein auf dem Server schon gelöschtes Foto nennt die Ansicht nicht mehr verfügbar statt „braucht Internet“', async () => {
    const { source } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });
    await within(lunch()).findByRole('button', { name: sharedThumb });
    source.network.answer = { type: 'rejected', code: 'forbidden' };

    await openPhoto();

    expect(await screen.findByText('Das Foto ist nicht mehr verfügbar.')).toBeOnTheScreen();
    expect(screen.queryByText(/braucht Internet/)).not.toBeOnTheScreen();
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
    // Die Vorschau ist weg, nur das zweite Foto bleibt; der Eintrag behält sein Foto-/KI-Symbol.
    expect(within(lunch()).queryByRole('button', { name: sharedThumb })).not.toBeOnTheScreen();
    expect(within(lunch()).getByRole('button', { name: 'Mahlzeitenfoto, Mittagessen' })).toBeOnTheScreen();
    expect(within(lunch()).getByLabelText(lunchLabel)).toBeOnTheScreen();
    expect(entries().find((row) => row.id === lunchEntry)).toMatchObject({ mealPhotoId: photoId });
  });
});
