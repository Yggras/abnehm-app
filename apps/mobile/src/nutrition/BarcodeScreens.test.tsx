/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';
import type * as ReactNative from 'react-native';
import { Dimensions, StyleSheet, type TextStyle } from 'react-native';

import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { ownFoodBarcodeId } from '@abnehm/contracts/nutrition';
import { seedClock, seedIds, seedManifests } from '@abnehm/contracts/seeds';

import { testCapabilities } from '../build-capabilities';
import { textScale, type as typeTokens } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { createLocalDatabases } from '../local-db/local-databases';
import { nutritionEntry, ownFood } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { expoNotificationPort } from '../notifications/expo-port';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import type { FakeNotificationPort } from '../test-capabilities/notifications';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appNutrition, createNutrition, foodFavoriteEntity, nutritionEntryEntity, ownFoodEntity, type FoodProductSource } from '.';
import { createFakeFoodProductSource, unknownFakeBarcode, type FakeFoodProductSource } from './testing/fake-food-product-source';
import type * as TestCatalogModule from './testing/test-catalog';
import { withoutNetwork } from './testing/without-network';

// Nachweis für #160 am gerenderten Bildschirm: „Barcode scannen“ im Hinzufügen-Bildschirm mit dem echten
// Verzeichnis `src/app`, dem echten Ernährungsmodul über einer mit `solo` geseedeten SQLite-Datei und dem Fake der
// `FoodProductSource`. Die Kamera ist eine Attrappe von expo-camera, die Freigabe und Treffer steuerbar macht; das
// echte Kamerabild prüft der Gerätelauf. Geprüft werden alle Folgezustände, „Kein Netz – …“, die abgelehnte
// Kamerafreigabe, deutsche zugängliche Namen, 48 dp und Schriftfaktor 2,0.

jest.setTimeout(30_000);
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('expo-sqlite', () => {
  const { createContext, createElement, useContext } = jest.requireActual<typeof React>('react');
  const { openTestCatalog } = jest.requireActual<typeof TestCatalogModule>('./testing/test-catalog');
  const catalog = openTestCatalog();
  const context = createContext<unknown>(null);
  return {
    openDatabaseSync: () => ({ getAllSync: () => [{ version: 'test-1' }], closeSync: () => {} }),
    SQLiteProvider: ({ children }: { children: React.ReactNode }) => createElement(context.Provider, { value: { getAllSync: catalog.database.all } }, children),
    useSQLiteContext: () => useContext(context),
  };
});

/** Zustand der Kamera-Attrappe: Freigabe, Antwort im Systemdialog und der zuletzt angemeldete Treffer-Handler. */
const mockCamera = {
  status: 'undetermined' as 'undetermined' | 'granted' | 'denied',
  canAskAgain: true,
  answer: 'granted' as 'granted' | 'denied',
  requests: 0,
  barcodeTypes: [] as string[],
  onScan: undefined as undefined | ((result: { type: string; data: string }) => void),
};
jest.mock('expo-camera', () => {
  const { createElement, useState } = jest.requireActual<typeof React>('react');
  const { View } = jest.requireActual<typeof ReactNative>('react-native');
  const response = () => ({ status: mockCamera.status, granted: mockCamera.status === 'granted', canAskAgain: mockCamera.canAskAgain, expires: 'never' });
  return {
    useCameraPermissions() {
      const [permission, setPermission] = useState(response);
      const request = async () => {
        mockCamera.requests += 1;
        mockCamera.status = mockCamera.answer;
        // Wie iOS: Nach einer Ablehnung fragt das System nicht noch einmal.
        mockCamera.canAskAgain = mockCamera.answer === 'granted';
        setPermission(response());
        return response();
      };
      return [permission, request];
    },
    CameraView(props: { onBarcodeScanned?: (result: { type: string; data: string }) => void; barcodeScannerSettings?: { barcodeTypes: string[] }; accessibilityLabel?: string }) {
      mockCamera.onScan = props.onBarcodeScanned;
      mockCamera.barcodeTypes = props.barcodeScannerSettings?.barcodeTypes ?? [];
      return createElement(View, { testID: 'kamera', accessible: true, accessibilityLabel: props.accessibilityLabel });
    },
  };
});

const appDir = 'src/app';
const user = userEvent.setup();
const cleanups: (() => void)[] = [];
beforeEach(() => {
  Object.assign(mockCamera, { status: 'undetermined', canAskAgain: true, answer: 'granted', requests: 0, barcodeTypes: [], onScan: undefined });
});

/**
 * Die Systemeinstellungen öffnet der Mitteilungs-Port (#125); in Jest ist er der Fake aus `jest/setup.js`, der das
 * Öffnen zählt.
 */
const settingsOpened = () => (expoNotificationPort as FakeNotificationPort).settingsOpened();
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const philipp = EntityId.parse(seedIds.person.philipp);
const yoghurt = '4000000000013';
/** Aus `solo`: Korrektur des Skyrs, Haferdrink im Cache, unvollständiges Knäckebrot im Cache (#160). */
const skyr = '4000000000051';
const knaeckebrot = '4000000000068';

let ids = 0;

/** Hinzufügen-Bildschirm des Abendessens über `solo`, mit der gegebenen Produktquelle. */
async function openCapture(source: FoodProductSource | FakeFoodProductSource = withoutNetwork.foodProducts) {
  const clock = testCapabilities!.clock;
  clock.fix({ instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) });
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests.solo, 'philipp-iphone');
  const newId = () => EntityId.parse(`10000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  const nutrition = createNutrition({ ...withoutNetwork,
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, ownFoodEntity, foodFavoriteEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
    foodProducts: source,
  });
  const release = appNutrition.opened(nutrition);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
    clock.release();
  });
  await renderRouter(appDir, { initialUrl: '/capture/food?meal=abendessen&localDate=2026-10-14' });
  await screen.findByTestId('platz-barcode');
  return {
    entries: () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all()).filter((row) => row.deletedAt === null),
    ownFoods: () => database.read((tx) => sqliteOf(tx).select().from(ownFood).all()),
  };
}

const startScan = () => user.press(screen.getByRole('button', { name: 'Barcode scannen' }));

/** Hält einen Barcode vor die Kamera-Attrappe. */
async function scan(data: string, type = 'ean13') {
  await act(async () => mockCamera.onScan?.({ type, data }));
}

const sheet = () => screen.getByTestId('sheet');
/** Wartet auf die Mengenprüfung des Lebensmittels. */
const amountReview = async (name: string) => within(await screen.findByTestId('sheet')).findByRole('header', { name });
const form = () => screen.getByTestId('eigenes-lebensmittel');

describe('Barcode scannen (#160)', () => {
  it('fragt die Kamera beim ersten Scannen, pausiert nach dem ersten Treffer und führt mit Quellenangabe in die Mengenprüfung', async () => {
    const source = createFakeFoodProductSource();
    const { entries } = await openCapture(source);
    // Vor dem ersten Scannen fragt die App nicht.
    expect(mockCamera.requests).toBe(0);

    await startScan();
    expect(await screen.findByLabelText('Kamerabild zum Scannen')).toBeOnTheScreen();
    expect(mockCamera.requests).toBe(1);
    expect(mockCamera.barcodeTypes).toEqual(['ean13', 'ean8', 'upc_a', 'upc_e']);
    expect(screen.getByRole('header', { name: 'Barcode scannen' })).toBeOnTheScreen();
    expect(screen.getByText('Halte den Barcode in den Rahmen. Der Scan startet von selbst.')).toBeOnTheScreen();

    const handler = mockCamera.onScan;
    await scan(yoghurt);
    // Ein zweiter Treffer im selben Moment löst nichts mehr aus.
    await act(async () => handler?.({ type: 'ean13', data: yoghurt }));
    expect(await amountReview('Naturjoghurt 3,5 %')).toBeOnTheScreen();
    expect(source.calls).toEqual([yoghurt]);
    expect(within(sheet()).getByText('Daten von Open Food Facts (openfoodfacts.org), ODbL')).toBeOnTheScreen();

    await user.press(within(sheet()).getByRole('button', { name: 'Hinzufügen' }));
    expect(entries().at(-1)).toMatchObject({ meal: 'abendessen', captureMethod: 'barcode', foodRefType: 'off', foodRefKey: yoghurt, snapshotSource: 'off' });
  });

  it('übergeht Treffer, die kein Lebensmittel-Barcode sind', async () => {
    const source = createFakeFoodProductSource();
    await openCapture(source);
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan('12345', 'ean8');
    expect(screen.getByLabelText('Kamerabild zum Scannen')).toBeOnTheScreen();
    expect(source.calls).toEqual([]);
  });

  it('abgelehnte Kamerafreigabe: Weg zu den Systemeinstellungen, ohne erneut zu fragen; „Abbrechen“ führt zurück', async () => {
    mockCamera.answer = 'denied';
    await openCapture(createFakeFoodProductSource());
    await startScan();
    expect(await screen.findByText('Die Kamera ist für die App ausgeschaltet. Erlaube sie in den Einstellungen oder such das Lebensmittel.')).toBeOnTheScreen();
    const before = settingsOpened();
    await user.press(screen.getByRole('button', { name: 'Einstellungen öffnen' }));
    expect(settingsOpened()).toBe(before + 1);

    await user.press(screen.getByRole('button', { name: 'Abbrechen' }));
    await startScan();
    expect(await screen.findByRole('button', { name: 'Einstellungen öffnen' })).toBeOnTheScreen();
    expect(mockCamera.requests).toBe(1);
    await user.press(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByLabelText('Lebensmittel suchen')).toBeOnTheScreen();
  });

  it('noch erfragbare Freigabe: „Kamera erlauben“ fragt erneut', async () => {
    Object.assign(mockCamera, { status: 'denied', canAskAgain: true });
    await openCapture(createFakeFoodProductSource());
    await startScan();
    expect(await screen.findByText('Zum Scannen braucht die App die Kamera. Bilder werden nicht gespeichert.')).toBeOnTheScreen();
    expect(mockCamera.requests).toBe(0);
    await user.press(screen.getByRole('button', { name: 'Kamera erlauben' }));
    expect(await screen.findByLabelText('Kamerabild zum Scannen')).toBeOnTheScreen();
  });

  it('not_found: „Eigenes Lebensmittel anlegen“ mit Barcode; danach gilt die eigene Fassung für diesen Barcode', async () => {
    const source = createFakeFoodProductSource();
    const { ownFoods, entries } = await openCapture(source);
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan(unknownFakeBarcode);

    expect(await screen.findByRole('header', { name: 'Eigenes Lebensmittel anlegen' })).toBeOnTheScreen();
    expect(within(form()).getByText('Open Food Facts kennt dieses Produkt noch nicht. Trag die Werte vom Etikett ein; ab dann gilt deine Fassung für diesen Barcode.')).toBeOnTheScreen();
    await user.type(within(form()).getByLabelText('Name'), 'Hofmilch 3,8 %');
    await user.press(within(form()).getByRole('radio', { name: 'ml' }));
    await user.type(within(form()).getByLabelText('Energie'), '67');
    await user.type(within(form()).getByLabelText('Eiweiß'), '3,4');
    await user.type(within(form()).getByLabelText('Kohlenhydrate'), '4,8');
    await user.type(within(form()).getByLabelText('Fett'), '3,8');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));

    const id = ownFoodBarcodeId(philipp, unknownFakeBarcode);
    expect(ownFoods()).toContainEqual(expect.objectContaining({ id, name: 'Hofmilch 3,8 %', baseUnit: 'ml', originType: 'off', originKey: unknownFakeBarcode }));
    expect(await amountReview('Hofmilch 3,8 %')).toBeOnTheScreen();
    await user.press(within(sheet()).getByRole('button', { name: 'Hinzufügen' }));
    expect(entries().at(-1)).toMatchObject({ captureMethod: 'barcode', foodRefType: 'eigen', foodRefKey: id });
  });

  it('incomplete: das Formular kommt mit allen bekannten Werten; der fehlende bleibt leer', async () => {
    const source = createFakeFoodProductSource();
    await openCapture(source);
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan(knaeckebrot);

    expect(await screen.findByText('Bei diesem Produkt fehlen Werte. Ergänze sie vom Etikett; ab dann gilt deine Fassung für diesen Barcode.')).toBeOnTheScreen();
    expect(within(form()).getByLabelText('Name')).toHaveDisplayValue('Vollkornknäckebrot');
    expect(within(form()).getByLabelText('Energie')).toHaveDisplayValue('');
    expect(within(form()).getByLabelText('Eiweiß')).toHaveDisplayValue('10');
    expect(within(form()).getByLabelText('Kohlenhydrate')).toHaveDisplayValue('60');
    // Aus dem Cache; weil der Eintrag älter als 30 Tage ist, fragt die App OFF im Hintergrund neu.
    expect(source.calls).toEqual([knaeckebrot]);
  });

  it('offline_unknown: „Kein Netz – …“ mit manuellem Weg; „Später scannen“ führt zurück', async () => {
    await openCapture();
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan(yoghurt);

    expect(await screen.findByText('Kein Netz – Produkt manuell anlegen oder später scannen')).toBeOnTheScreen();
    expect(screen.getByText('Barcode 4000000000013')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Später scannen' }));
    expect(screen.getByLabelText('Lebensmittel suchen')).toBeOnTheScreen();

    await startScan();
    await scan(yoghurt);
    await user.press(await screen.findByRole('button', { name: 'Produkt manuell anlegen' }));
    expect(await screen.findByText('Trag die Werte vom Etikett ein; ab dann gilt deine Fassung für diesen Barcode.')).toBeOnTheScreen();
  });

  it('unavailable: neutraler Hinweis mit „Erneut versuchen“, der danach das Produkt findet', async () => {
    const source = createFakeFoodProductSource({ mode: 'http_503' });
    await openCapture(source);
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan(yoghurt);

    expect(await screen.findByText('Open Food Facts antwortet gerade nicht. Versuch es gleich noch einmal oder leg das Produkt selbst an.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Produkt manuell anlegen' })).toBeOnTheScreen();
    source.setMode('katalog');
    await user.press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await amountReview('Naturjoghurt 3,5 %')).toBeOnTheScreen();
    expect(source.calls).toEqual([yoghurt, yoghurt]);
  });

  it('ein eigenes Lebensmittel mit diesem Barcode überdeckt den Cache und lässt sich ändern, aber nicht löschen', async () => {
    const source = createFakeFoodProductSource();
    await openCapture(source);
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan(skyr);

    expect(await amountReview('Skyr Natur')).toBeOnTheScreen();
    expect(within(sheet()).getByText('Eigenes Lebensmittel')).toBeOnTheScreen();
    expect(source.calls).toEqual([]);
    await user.press(within(sheet()).getByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByRole('header', { name: 'Eigenes Lebensmittel bearbeiten' })).toBeOnTheScreen();
    expect(within(form()).queryByRole('button', { name: 'Löschen' })).not.toBeOnTheScreen();
  });

  it('„Werte korrigieren“ eines Produkts nennt Open Food Facts und legt das eigene Lebensmittel mit deterministischer ID an', async () => {
    const { ownFoods } = await openCapture(createFakeFoodProductSource());
    await startScan();
    await screen.findByLabelText('Kamerabild zum Scannen');
    await scan(yoghurt);
    await user.press(await within(sheet()).findByRole('button', { name: 'Werte korrigieren' }));

    expect(await screen.findByText('Die Daten von Open Food Facts bleiben unverändert. Deine Fassung gilt ab jetzt für diesen Barcode.')).toBeOnTheScreen();
    await user.clear(within(form()).getByLabelText('Energie'));
    await user.type(within(form()).getByLabelText('Energie'), '70');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));
    expect(ownFoods()).toContainEqual(expect.objectContaining({ id: ownFoodBarcodeId(philipp, yoghurt), milliKcal: 70_000, originType: 'off', originKey: yoghurt }));
  });

  it('ein per Link hinterlegter Barcode ersetzt in Test-Artefakten die Kamera', async () => {
    const source = createFakeFoodProductSource();
    await openCapture(source);
    testCapabilities!.redirectSystemPath('abnehmapp-dev://produkt?scan=4000000000020');
    await startScan();
    expect(await amountReview('Orangensaft')).toBeOnTheScreen();
    expect(mockCamera.requests).toBe(0);
    expect(source.calls).toEqual(['4000000000020']);
  });
});

describe('Suche: gescannte Produkte (#160)', () => {
  it('zeigt gescannte Produkte als „Produkt“; ein überdecktes nur einmal, als eigenes Lebensmittel', async () => {
    await openCapture();
    await user.type(screen.getByLabelText('Lebensmittel suchen'), 'Haferdrink');
    expect(screen.getByRole('button', { name: 'Haferdrink Barista, 59 kcal je 100 ml, Produkt' })).toBeOnTheScreen();

    await user.clear(screen.getByLabelText('Lebensmittel suchen'));
    await user.type(screen.getByLabelText('Lebensmittel suchen'), 'Skyr');
    expect(screen.getAllByRole('button', { name: /^Skyr Natur/ }).map((button) => button.props.accessibilityLabel)).toEqual(['Skyr Natur, 63 kcal je 100 g, Eigen']);
  });
});

describe('Barcode: Zugänglichkeit (#160)', () => {
  const fits = (name: string) => {
    const area = hitArea(screen.getByRole('button', { name }));
    expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
  };

  it('Aktionen haben mindestens 48 × 48 dp', async () => {
    mockCamera.answer = 'denied';
    await openCapture(createFakeFoodProductSource({ mode: 'http_429' }));
    fits('Barcode scannen');
    await startScan();
    await screen.findByRole('button', { name: 'Einstellungen öffnen' });
    fits('Einstellungen öffnen');
    fits('Abbrechen');
    await user.press(screen.getByRole('button', { name: 'Abbrechen' }));

    Object.assign(mockCamera, { status: 'granted', canAskAgain: true });
    await startScan();
    await scan(yoghurt);
    await screen.findByRole('button', { name: 'Erneut versuchen' });
    fits('Erneut versuchen');
    fits('Produkt manuell anlegen');
    fits('Später scannen');
  });

  describe('Schriftfaktor 2,0', () => {
    const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
    beforeEach(() => Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } }));
    afterEach(() => Dimensions.set(initial));

    it('Texte des Scanners und der Hinweise wachsen mit und bleiben bedienbar', async () => {
      mockCamera.status = 'granted';
      await openCapture();
      await startScan();
      await screen.findByLabelText('Kamerabild zum Scannen');
      await scan(yoghurt);
      await screen.findByText('Kein Netz – Produkt manuell anlegen oder später scannen');

      const limits = Object.entries(textScale.limit).map(([token, limit]) => [typeTokens[token as keyof typeof textScale.limit].fontSize, limit] as const);
      for (const text of screen.queryAllByText(/[\s\S]+/, { includeHiddenElements: true })) {
        const { fontSize } = StyleSheet.flatten(text.props.style as TextStyle) ?? {};
        expect(text.props.allowFontScaling).not.toBe(false);
        expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(limits.find(([size]) => size === fontSize)?.[1] ?? textScale.max);
      }
      await user.press(screen.getByRole('button', { name: 'Produkt manuell anlegen' }));
      expect(await screen.findByRole('header', { name: 'Eigenes Lebensmittel anlegen' })).toBeOnTheScreen();
    });
  });
});
