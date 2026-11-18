/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';

import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { photoDraftSnapshot } from '@abnehm/contracts/nutrition';
import { seedClock, seedDays, seedIds, seedManifests } from '@abnehm/contracts/seeds';

import { testCapabilities } from '../build-capabilities';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { createLocalDatabases } from '../local-db/local-databases';
import { nutritionEntry, ownFood } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appNutrition, createNutrition, nutritionEntryEntity, ownFoodEntity } from '.';
import type * as TestCatalogModule from './testing/test-catalog';

// Nachweis für #155 und #157 am gerenderten Bildschirm: Protokoll und Hinzufügen-Bildschirm mit dem
// echten Verzeichnis `src/app`, dem echten Ernährungsmodul über einer mit `solo` geseedeten SQLite-Datei
// und einem kleinen BLS-Testkatalog. Ein Eintrag aus der Suche landet im Protokoll; „Rückgängig“ entfernt
// ihn wieder. Eigene Lebensmittel entstehen im Formular, aus einer Korrektur oder einer fehlenden
// Umrechnung und werden in Stück oder Portion erfasst.

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
    writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, ownFoodEntity]), clock, newId }),
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
    nutrition,
    entries: () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all()).filter((row) => row.deletedAt === null),
    ownFoods: () => database.read((tx) => sqliteOf(tx).select().from(ownFood).all()),
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

  it('kennzeichnet Einträge aus einem Foto mit dem Foto-/KI-Symbol und „KI-Schätzung“ im zugänglichen Namen (#162)', async () => {
    const { nutrition } = await openAccount();
    // Eine Bestätigung aus dem Fotoentwurf: ein unveränderter KI-Bestandteil zum Mittagessen.
    nutrition.confirmPhotoDraft({
      draftId: EntityId.parse('5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03'),
      localDate: LocalDate.parse(seedDays.heute),
      meal: 'mittagessen',
      components: [{
        foodRef: null,
        snapshot: photoDraftSnapshot({ name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 }),
        displayUnit: 'g',
        displayAmountMilli: 180_000,
      }],
    });
    await renderRouter(appDir, { initialUrl: '/log' });

    const lunch = meal('mittagessen');
    const fromPhoto = await within(lunch).findByLabelText('Mittagessen: Bratkartoffeln, 180 g, 270 kcal, KI-Schätzung');
    expect(within(fromPhoto).getByTestId('icon-camera', { includeHiddenElements: true })).toBeOnTheScreen();
    // Einträge aus der Suche tragen weder Symbol noch Hinweis.
    const fromSearch = within(meal('fruehstueck')).getByLabelText('Frühstück: Hafer Flocken, 60 g, 209 kcal');
    expect(within(fromSearch).queryByTestId('icon-camera', { includeHiddenElements: true })).not.toBeOnTheScreen();
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

describe('Eigene Lebensmittel und Portionsumrechnungen (#157)', () => {
  async function openCapture() {
    const account = await openAccount();
    await renderRouter(appDir, { initialUrl: '/capture/food?meal=fruehstueck&localDate=2026-10-14' });
    await screen.findByLabelText('Lebensmittel suchen');
    return account;
  }
  const search = async (query: string) => {
    await user.clear(screen.getByLabelText('Lebensmittel suchen'));
    await user.type(screen.getByLabelText('Lebensmittel suchen'), query);
  };
  const form = () => screen.getByTestId('eigenes-lebensmittel');
  const fill = async (label: string, value: string) => {
    const field = within(form()).getByLabelText(label);
    await user.clear(field);
    if (value !== '') await user.type(field, value);
  };
  const sheet = () => screen.getByTestId('sheet');

  it('legt ein fehlendes Lebensmittel als letzten Platz an, prüft die Eingaben mit Lösungsweg und erfasst es in Portionen', async () => {
    const { entries, ownFoods, operations } = await openCapture();

    await user.press(within(screen.getByTestId('platz-eigenes_lebensmittel')).getByRole('button', { name: 'Eigenes Lebensmittel anlegen' }));
    expect(within(form()).getByRole('header', { name: 'Eigenes Lebensmittel anlegen' })).toBeOnTheScreen();
    expect(within(form()).getByLabelText('Werte gelten für')).toHaveDisplayValue('100');

    await fill('Fett', '60');
    await fill('Eiweiß', '50');
    await fill('Kohlenhydrate', 'viel');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));

    for (const problem of [
      'Gib einen Namen ein, etwa „Bircher-Müsli“.',
      'Gib die kcal von der Packung ein, etwa 150.',
      'Gib eine Zahl ein, etwa 4,5.',
    ]) {
      expect(within(form()).getByText(problem, { includeHiddenElements: true })).toBeOnTheScreen();
    }
    expect(within(form()).getByLabelText('Name')).toHaveProp('accessibilityHint', 'Fehler: Gib einen Namen ein, etwa „Bircher-Müsli“.');
    // „Speichern“ liegt unter den Feldern: Ein Satz darüber nennt die betroffenen Felder.
    expect(within(form()).getByText('Prüfe die markierten Felder: Name, Energie, Kohlenhydrate.')).toBeOnTheScreen();
    expect(ownFoods()).toEqual([expect.objectContaining({ name: 'Bircher-Müsli, selbst gemacht' }), expect.objectContaining({ name: 'Apfel roh' })]);

    await fill('Kohlenhydrate', '0');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));
    expect(within(form()).getByText(/wiegen zusammen mehr als die Menge, für die die Werte gelten/)).toBeOnTheScreen();
    expect(within(form()).getByText('Prüfe die markierten Felder: Name, Energie, Eiweiß, Kohlenhydrate und Fett.')).toBeOnTheScreen();

    await fill('Name', 'Linsen-Dal');
    await fill('Energie', '120');
    await fill('Eiweiß', '6,5');
    await fill('Kohlenhydrate', '15');
    await fill('Fett', '3');
    await fill('1 Portion hat', '300');
    await fill('Bezeichnung für Portion', '1 Schüssel');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));

    expect(ownFoods()).toHaveLength(3);
    expect(ownFoods()[2]).toMatchObject({ name: 'Linsen-Dal', milliKcal: 120_000, proteinMg: 6_500, portions: [{ unit: 'portion', label: '1 Schüssel', baseAmount: 300_000 }], originType: null });
    // Danach direkt in die Mengenprüfung: vorbelegt ist die bekannte Portion.
    expect(within(sheet()).getByRole('header', { name: 'Linsen-Dal' })).toBeOnTheScreen();
    expect(within(sheet()).getByText('Eigenes Lebensmittel')).toBeOnTheScreen();
    expect(within(sheet()).getAllByRole('radio').map((chip) => chip.props.accessibilityLabel)).toEqual(['g', '1 Schüssel']);
    expect(within(sheet()).getByRole('radio', { name: '1 Schüssel' })).toBeChecked();
    expect(within(sheet()).getByLabelText('Menge')).toHaveDisplayValue('1');
    expect(within(sheet()).getByText('360 kcal')).toBeOnTheScreen();

    await user.clear(within(sheet()).getByLabelText('Menge'));
    await user.type(within(sheet()).getByLabelText('Menge'), '0,5');
    expect(within(sheet()).getByText('180 kcal')).toBeOnTheScreen();
    await user.press(within(sheet()).getByRole('button', { name: 'Hinzufügen' }));

    expect(screen).toHavePathname('/log');
    expect(entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ captureMethod: 'eigenes_lebensmittel', foodRefType: 'eigen', displayUnit: 'portion', displayAmountMilli: 500, baseAmount: 150_000, totalMilliKcal: 180_000 }),
    ]));
    expect(operations()).toEqual(['upsert_entity', 'upsert_entity']);
    expect(await within(meal('fruehstueck')).findByLabelText('Frühstück: Linsen-Dal, 0,5 Portionen, 180 kcal')).toBeOnTheScreen();
  });

  it('bietet ohne Suchtreffer „Eigenes Lebensmittel anlegen“ mit vorausgefülltem Namen an', async () => {
    await openCapture();

    await search('Zimtschnecke ');

    expect(screen.getByText('Keine Treffer für „Zimtschnecke“.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: '„Zimtschnecke“ als eigenes Lebensmittel anlegen' }));
    expect(within(form()).getByLabelText('Name')).toHaveDisplayValue('Zimtschnecke');

    await user.press(within(form()).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByLabelText('Lebensmittel suchen')).toHaveDisplayValue('Zimtschnecke ');
  });

  it('zeigt Stück und Portion nur bei bekannter Umrechnung', async () => {
    await openCapture();

    await search('Bircher');
    await user.press(screen.getByRole('button', { name: 'Bircher-Müsli, selbst gemacht, 150 kcal je 100 g, Eigen' }));
    expect(within(sheet()).getAllByRole('radio').map((chip) => chip.props.accessibilityLabel)).toEqual(['g', '1 Glas']);
    expect(within(sheet()).getByRole('button', { name: 'Stück eintragen' })).toBeOnTheScreen();
    await user.press(within(sheet()).getByRole('button', { name: 'Schließen' }));

    await search('Haferflocken');
    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));
    expect(within(sheet()).getAllByRole('radio').map((chip) => chip.props.accessibilityLabel)).toEqual(['g']);
    expect(within(sheet()).getByRole('button', { name: 'Stück oder Portion eintragen' })).toBeOnTheScreen();
  });

  it('trägt eine fehlende Umrechnung eines BLS-Lebensmittels ein: Daraus entsteht ein eigenes Lebensmittel', async () => {
    const { ownFoods } = await openCapture();
    await search('Haferflocken');
    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));

    await user.press(within(sheet()).getByRole('button', { name: 'Stück oder Portion eintragen' }));
    expect(within(sheet()).getByRole('header', { name: 'Umrechnung eintragen' })).toBeOnTheScreen();
    await user.press(within(sheet()).getByRole('radio', { name: 'Portion' }));
    await user.press(within(sheet()).getByRole('button', { name: 'Speichern' }));
    expect(within(sheet()).getByText('Gib ein, wie viel g 1 Portion hat, etwa 250.', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(ownFoods()).toHaveLength(2);

    await user.type(within(sheet()).getByLabelText('1 Portion hat'), '40');
    await user.type(within(sheet()).getByLabelText('Bezeichnung für Portion'), '1 Schale');
    await user.press(within(sheet()).getByRole('button', { name: 'Speichern' }));

    expect(ownFoods()[2]).toMatchObject({ name: 'Hafer Flocken', milliKcal: 348_000, portions: [{ unit: 'portion', label: '1 Schale', baseAmount: 40_000 }], originType: 'bls', originKey: 'C133000' });
    expect(within(sheet()).getByRole('radio', { name: '1 Schale' })).toBeChecked();
    expect(within(sheet()).getByLabelText('Menge')).toHaveDisplayValue('1');
    // 348 kcal je 100 g × 0,4 = 139,2 kcal.
    expect(within(sheet()).getByText('139 kcal')).toBeOnTheScreen();
    expect(within(sheet()).getByText('Eigenes Lebensmittel')).toBeOnTheScreen();

    await user.press(within(sheet()).getByRole('button', { name: 'Schließen' }));
    // Die Quelle erscheint nur noch einmal, als eigenes Lebensmittel.
    expect(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, Eigen' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' })).not.toBeOnTheScreen();
  });

  it('korrigiert die Werte eines BLS-Lebensmittels; gespeicherte Einträge behalten ihre Werte', async () => {
    const { entries, ownFoods } = await openCapture();
    await search('Haferflocken');
    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));

    await user.press(within(sheet()).getByRole('button', { name: 'Werte korrigieren' }));
    expect(within(form()).getByRole('header', { name: 'Werte korrigieren' })).toBeOnTheScreen();
    expect(within(form()).getByText('Die BLS-Daten bleiben unverändert. Deine Fassung ersetzt das Lebensmittel ab jetzt in der Suche.')).toBeOnTheScreen();
    expect(within(form()).getByLabelText('Name')).toHaveDisplayValue('Hafer Flocken');
    expect(within(form()).getByLabelText('Energie')).toHaveDisplayValue('348');
    expect(within(form()).getByLabelText('Eiweiß')).toHaveDisplayValue('13,22');
    await fill('Energie', '372');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));

    expect(ownFoods()[2]).toMatchObject({ name: 'Hafer Flocken', milliKcal: 372_000, originType: 'bls', originKey: 'C133000' });
    // Die Vorbelegung gilt je Referenz: Die Korrektur hat noch keine Einträge und beginnt bei 100 g.
    expect(within(sheet()).getByText('372 kcal')).toBeOnTheScreen();
    expect(entries().find((entry) => entry.snapshotName === 'Hafer Flocken')).toMatchObject({ snapshotMilliKcal: 348_000, totalMilliKcal: 208_800 });
  });

  it('legt nichts an, wenn die Person ein BLS-Lebensmittel ohne Änderung speichert', async () => {
    const { ownFoods, operations } = await openCapture();
    await search('Haferflocken');
    await user.press(screen.getByRole('button', { name: 'Hafer Flocken, 348 kcal je 100 g, BLS' }));

    await user.press(within(sheet()).getByRole('button', { name: 'Werte korrigieren' }));
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));

    expect(ownFoods()).toHaveLength(2);
    expect(operations()).toEqual([]);
    // Zurück in der Mengenprüfung der unveränderten Quelle.
    expect(within(sheet()).getByText('Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0')).toBeOnTheScreen();
    expect(within(sheet()).getByLabelText('Menge')).toHaveDisplayValue('60');
  });

  it('ändert und löscht ein eigenes Lebensmittel nach Rückfrage', async () => {
    const { ownFoods, operations } = await openCapture();
    await search('Bircher');
    await user.press(screen.getByRole('button', { name: 'Bircher-Müsli, selbst gemacht, 150 kcal je 100 g, Eigen' }));
    await user.press(within(sheet()).getByRole('button', { name: 'Bearbeiten' }));
    expect(within(form()).getByRole('header', { name: 'Eigenes Lebensmittel bearbeiten' })).toBeOnTheScreen();
    expect(within(form()).getByLabelText('1 Portion hat')).toHaveDisplayValue('250');

    await fill('Energie', '160');
    await user.press(within(form()).getByRole('button', { name: 'Speichern' }));
    expect(ownFoods()[0]).toMatchObject({ id: seedIds.ownFood.philippBircher, milliKcal: 160_000 });
    await user.press(within(sheet()).getByRole('button', { name: 'Bearbeiten' }));

    await user.press(within(form()).getByRole('button', { name: 'Löschen' }));
    expect(within(form()).getByText('„Bircher-Müsli, selbst gemacht“ löschen? Einträge damit behalten ihre Werte.')).toBeOnTheScreen();
    await user.press(within(form()).getByRole('button', { name: 'Endgültig löschen' }));

    expect(ownFoods()[0]).toMatchObject({ id: seedIds.ownFood.philippBircher, deletedAt: expect.any(String) });
    expect(operations()).toEqual(['upsert_entity', 'delete_entity']);
    // Zurück in der Suche: Das eigene Lebensmittel ist weg, der BLS-Treffer bleibt.
    expect(screen.getByLabelText('Lebensmittel suchen')).toHaveDisplayValue('Bircher');
    expect(screen.queryByText('Bircher-Müsli, selbst gemacht')).not.toBeOnTheScreen();
    expect(screen.getByText('Müslimischung Bircher Art (mit Trockenfrüchten und Nüssen) ungesüßt')).toBeOnTheScreen();
  });
});
