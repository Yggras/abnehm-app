/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';

import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { seedClock, seedIds, seedManifests } from '@abnehm/contracts/seeds';

import { testCapabilities } from '../build-capabilities';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { createLocalDatabases } from '../local-db/local-databases';
import { nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appNutrition, createNutrition, nutritionEntryEntity } from '.';
import type * as TestCatalogModule from './testing/test-catalog';

// Nachweis für #155 am gerenderten Bildschirm: Protokoll und Hinzufügen-Bildschirm mit dem echten
// Verzeichnis `src/app`, dem echten Ernährungsmodul über einer mit `solo` geseedeten SQLite-Datei und
// einem kleinen BLS-Testkatalog. Ein Eintrag aus der Suche landet im Protokoll; „Rückgängig“ entfernt
// ihn wieder.

jest.setTimeout(30_000);
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
// Der BLS-Katalog kommt als Testkatalog (dreizehn Lebensmittel mit Werten aus dem Asset); wie die App
// ihn öffnet, belegt `BlsCatalogProvider.test.tsx`.
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

const appDir = 'src/app';
const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

let ids = 0;

/** Öffnet eine Kontodatenbank wie die App-Sitzung: `solo` geseedet oder nur mit der Person, Uhr des Manifests. */
async function openAccount({ seeded = true }: { seeded?: boolean } = {}) {
  const clock = testCapabilities!.clock;
  clock.fix({ instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) });
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  if (seeded) seedLocalDatabase(database, seedManifests.solo, 'philipp-iphone');
  else database.transaction((tx) => insertPersonForTest(tx, seedIds.person.philipp));
  const newId = () => EntityId.parse(`10000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`);
  const nutrition = createNutrition({
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
  });
  const release = appNutrition.opened(nutrition);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
    clock.release();
  });
  return {
    entries: () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all()).filter((row) => row.deletedAt === null),
    operations: () => database.read((tx) => pendingOperations(tx, 100)).map(({ type }) => type),
  };
}

const meal = (name: string) => screen.getByTestId(`mahlzeit-${name}`);

describe('Protokoll', () => {
  it('zeigt Datum, Wochentag und Tagessumme sowie die vier Mahlzeiten mit Einträgen und Leerzuständen', async () => {
    await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });

    expect(await screen.findByRole('header', { name: 'Protokoll' })).toBeOnTheScreen();
    expect(screen.getByText('Heute, Mittwoch, 14.10.2026')).toBeOnTheScreen();
    // 60 g Hafer Flocken (208,8 kcal) und 150 g Apfel roh (87 kcal) aus `solo`.
    expect(screen.getByLabelText('Erfasst heute: 296 kcal')).toBeOnTheScreen();
    expect(screen.queryByText(/übrig|drüber|Budget/)).not.toBeOnTheScreen();

    const breakfast = meal('fruehstueck');
    expect(within(breakfast).getByRole('header', { name: 'Frühstück, 296 kcal' })).toBeOnTheScreen();
    expect(within(breakfast).getByLabelText('Frühstück: Hafer Flocken, 60 g, 209 kcal')).toBeOnTheScreen();
    expect(within(breakfast).getByLabelText('Frühstück: Apfel roh, 150 g, 87 kcal')).toBeOnTheScreen();
    expect(within(breakfast).getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['Frühstück hinzufügen']);

    for (const [key, name] of [['mittagessen', 'Mittagessen'], ['abendessen', 'Abendessen'], ['snacks', 'Snacks']] as const) {
      expect(within(meal(key)).getByRole('header', { name })).toBeOnTheScreen();
      expect(within(meal(key)).getByText('Noch nichts eingetragen.')).toBeOnTheScreen();
      // Genau eine Aktion im Leerzustand.
      expect(within(meal(key)).getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([`${name} hinzufügen`]);
    }
  });

  it('zeigt an einem leeren Tag 0 kcal und vier Leerzustände', async () => {
    await openAccount({ seeded: false });
    await renderRouter(appDir, { initialUrl: '/log' });

    expect(await screen.findByLabelText('Erfasst heute: 0 kcal')).toBeOnTheScreen();
    expect(screen.getAllByText('Noch nichts eingetragen.')).toHaveLength(4);
  });

  it('„+“ einer Mahlzeit öffnet capture.food mit Mahlzeit und Tag', async () => {
    await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });

    await user.press(await screen.findByRole('button', { name: 'Abendessen hinzufügen' }));

    expect(screen).toHavePathname('/capture/food');
    expect(screen).toHaveSearchParams({ meal: 'abendessen', localDate: '2026-10-14' });
    expect(await screen.findByRole('header', { name: 'Essen' })).toBeOnTheScreen();
    expect(screen.getByText('Abendessen · Heute')).toBeOnTheScreen();
  });
});

describe('Hinzufügen und Mengenprüfung', () => {
  async function openCapture(mealKey = 'fruehstueck') {
    const account = await openAccount();
    await renderRouter(appDir, { initialUrl: '/log' });
    await user.press(await screen.findByRole('button', { name: `${{ fruehstueck: 'Frühstück', snacks: 'Snacks' }[mealKey]} hinzufügen` }));
    return account;
  }
  const search = () => screen.getByLabelText('Lebensmittel suchen');

  it('legt die Plätze in fester Reihenfolge an: Suche, Barcode, Foto, Favoriten, Zuletzt verwendet, eigenes Lebensmittel', async () => {
    await openCapture();

    expect(await screen.findByLabelText('Lebensmittel suchen')).toBeOnTheScreen();
    const slots = screen.getAllByTestId(/^platz-/).map((slot) => slot.props.testID as string);
    expect(slots).toEqual([
      'platz-suche', 'platz-barcode', 'platz-foto', 'platz-mahlzeitenfavoriten', 'platz-zuletzt', 'platz-lebensmittelfavoriten', 'platz-eigenes_lebensmittel',
    ]);
  });

  it('sucht ab zwei Zeichen im BLS und zeigt Name, kcal je 100 g und Quelle', async () => {
    await openCapture();

    await user.type(await screen.findByLabelText('Lebensmittel suchen'), 'H');
    expect(screen.queryByText('Hafer Flocken')).not.toBeOnTheScreen();
    expect(screen.getByTestId('platz-barcode')).toBeOnTheScreen();

    await user.type(search(), 'aferflocken');
    expect(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' })).toBeOnTheScreen();
    expect(screen.getByText('348 kcal je 100 g · BLS')).toBeOnTheScreen();
    // Während der Suche stehen die Treffer an der Stelle der übrigen Plätze.
    expect(screen.queryByTestId('platz-barcode')).not.toBeOnTheScreen();

    await user.clear(search());
    await user.type(search(), 'Quark');
    expect(screen.getByText('Keine Treffer für „Quark“.')).toBeOnTheScreen();
  });

  it('belegt die Menge mit der letzten Menge des Lebensmittels vor, sonst mit 100 g, und rechnet kcal und Makros', async () => {
    await openCapture();
    await user.type(await screen.findByLabelText('Lebensmittel suchen'), 'Haferflocken');

    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));

    const sheet = screen.getByTestId('sheet');
    expect(within(sheet).getByRole('header', { name: 'Hafer Flocken' })).toBeOnTheScreen();
    expect(within(sheet).getByText('Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0')).toBeOnTheScreen();
    // `solo` hat heute 60 g Hafer Flocken zum Frühstück.
    expect(within(sheet).getByLabelText('Menge')).toHaveDisplayValue('60');
    expect(within(sheet).getByRole('radio', { name: 'g' })).toBeChecked();
    expect(within(sheet).getByText('209 kcal')).toBeOnTheScreen();
    expect(within(sheet).getByText('Eiweiß 7,9 g · Kohlenhydrate 32 g · Fett 4,0 g')).toBeOnTheScreen();

    await user.press(within(sheet).getByRole('button', { name: 'Schließen' }));
    await user.clear(search());
    await user.type(search(), 'Apfelsaft');
    await user.press(screen.getByRole('button', { name: 'Apfelsaft, 44 kcal je 100 g, BLS' }));

    expect(within(screen.getByTestId('sheet')).getByLabelText('Menge')).toHaveDisplayValue('100');
    expect(within(screen.getByTestId('sheet')).getByText('44 kcal')).toBeOnTheScreen();
  });

  it.each([
    ['0', 'Gib eine Menge über 0 ein, etwa 60.'],
    ['5000,001', 'Höchstens 5.000 g je Eintrag. Teile größere Mengen auf mehrere Einträge auf.'],
    ['zwei', 'Gib die Menge als Zahl ein, etwa 60 oder 0,5.'],
    ['0,0001', 'Gib die Menge als Zahl ein, etwa 60 oder 0,5.'],
    ['1.500', 'Gib die Menge ohne Tausenderpunkt ein, etwa 1500 oder 1,5.'],
    ['', 'Gib eine Menge ein, etwa 60.'],
  ])('zeigt bei „%s“ den Lösungsweg und speichert nichts', async (input, problem) => {
    const { entries } = await openCapture();
    await user.type(await screen.findByLabelText('Lebensmittel suchen'), 'Haferflocken');
    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));
    const sheet = screen.getByTestId('sheet');

    await user.clear(within(sheet).getByLabelText('Menge'));
    if (input !== '') await user.type(within(sheet).getByLabelText('Menge'), input);
    await user.press(within(sheet).getByRole('button', { name: 'Hinzufügen' }));

    // Sichtbar unter dem Feld; Screenreader hören den Satz als Hinweis des Felds.
    expect(within(sheet).getByText(problem, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(within(sheet).getByLabelText('Menge')).toHaveProp('accessibilityHint', `Fehler: ${problem}`);
    expect(screen).toHavePathname('/capture/food');
    expect(entries()).toHaveLength(2);
  });

  it('kehrt nach dem Speichern auch ohne Rückweg ins Protokoll zurück, etwa nach einem Link', async () => {
    const { entries } = await openAccount();
    await renderRouter(appDir, { initialUrl: '/capture/food?meal=abendessen&localDate=2026-10-14' });
    await user.type(await screen.findByLabelText('Lebensmittel suchen'), 'Apfelsaft');
    await user.press(screen.getByRole('button', { name: 'Apfelsaft, 44 kcal je 100 g, BLS' }));

    await user.press(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Hinzufügen' }));

    expect(screen).toHavePathname('/log');
    expect(entries()).toEqual(expect.arrayContaining([expect.objectContaining({ meal: 'abendessen', snapshotName: 'Apfelsaft' })]));
    expect(await within(meal('abendessen')).findByLabelText('Abendessen: Apfelsaft, 100 g, 44 kcal')).toBeOnTheScreen();
  });

  it('„Hinzufügen“ speichert sofort lokal, kehrt zum Protokoll zurück und „Rückgängig“ entfernt den Eintrag genau einmal', async () => {
    const { entries, operations } = await openCapture('snacks');
    await user.type(await screen.findByLabelText('Lebensmittel suchen'), 'Haferflocken');
    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));
    const sheet = screen.getByTestId('sheet');
    await user.clear(within(sheet).getByLabelText('Menge'));
    await user.type(within(sheet).getByLabelText('Menge'), '40,5');

    await user.press(within(sheet).getByRole('button', { name: 'Hinzufügen' }));

    expect(screen).toHavePathname('/log');
    expect(entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ meal: 'snacks', captureMethod: 'suche', localDate: '2026-10-14', displayAmountMilli: 40_500, totalMilliKcal: 140_940 }),
    ]));
    expect(operations()).toEqual(['upsert_entity']);
    // 348 kcal je 100 g × 0,405 = 140,94 kcal.
    expect(await within(meal('snacks')).findByLabelText('Snacks: Hafer Flocken, 40,5 g, 141 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Erfasst heute: 437 kcal')).toBeOnTheScreen();
    expect(screen.getByText('141 kcal zu den Snacks hinzugefügt')).toBeOnTheScreen();

    const undo = screen.getByRole('button', { name: 'Rückgängig' });
    await user.press(undo);
    await user.press(undo);
    await act(async () => {});

    expect(entries()).toHaveLength(2);
    expect(operations()).toEqual(['upsert_entity', 'delete_entity']);
    expect(within(meal('snacks')).getByText('Noch nichts eingetragen.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Erfasst heute: 296 kcal')).toBeOnTheScreen();
  });
});
