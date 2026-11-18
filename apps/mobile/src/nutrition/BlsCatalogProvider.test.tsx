import { render, screen } from '@testing-library/react-native';
import type * as React from 'react';
import { Text } from 'react-native';

import { blsCatalogVersion } from './bls-catalog-version';
import { useCatalogDatabase } from '../local-db/CatalogProvider';
import { BlsCatalogProvider } from './BlsCatalogProvider';
import { createFoodSearch } from './food-search';
import { noOwnFoods } from './testing/test-catalog';
import type * as TestCatalogModule from './testing/test-catalog';

// Nachweis für #154: Die App öffnet den BLS-Katalog über `SQLiteProvider` mit `assetSource`, getrennt
// von den Kontodatenbanken, und setzt `forceOverwrite` nur bei einer neuen Katalogversion. expo-sqlite
// ist hier ersetzt: `openDatabaseSync` liefert die installierte Version, `SQLiteProvider` merkt sich
// seine Props und reicht einen Testkatalog an die Kinder. Dass gleiche Versionen bleiben und neue
// ersetzen, belegt `local-db/catalog.test.ts` mit echten Dateien.

const mockInstalled: { version: string | null; closed: number } = { version: null, closed: 0 };
const mockProviderProps: Record<string, unknown>[] = [];

jest.mock('expo-sqlite', () => {
  const { createContext, createElement, useContext } = jest.requireActual<typeof React>('react');
  const { openTestCatalog } = jest.requireActual<typeof TestCatalogModule>('./testing/test-catalog');
  const catalog = openTestCatalog();
  const context = createContext<unknown>(null);
  return {
    openDatabaseSync: () => ({
      getAllSync: () => {
        // So antwortet SQLite auf eine leere Datei ohne Tabelle `catalog_info`.
        if (mockInstalled.version === null) throw new Error('no such table: catalog_info');
        return [{ version: mockInstalled.version }];
      },
      closeSync: () => {
        mockInstalled.closed += 1;
      },
    }),
    SQLiteProvider: ({ children, ...props }: { children: React.ReactNode }) => {
      mockProviderProps.push(props);
      return createElement(context.Provider, { value: { getAllSync: catalog.database.all } }, children);
    },
    useSQLiteContext: () => useContext(context),
  };
});

function FirstHit({ query }: { query: string }) {
  const result = createFoodSearch({ catalog: useCatalogDatabase(), ownFoods: noOwnFoods }).search(query);
  return <Text>{result.type === 'treffer' ? result.hits[0]?.snapshot.name : result.type}</Text>;
}

async function renderCatalog() {
  await render(
    <BlsCatalogProvider>
      <FirstHit query="Haferflocken" />
    </BlsCatalogProvider>,
  );
  return mockProviderProps.at(-1);
}

beforeEach(() => {
  mockProviderProps.length = 0;
  mockInstalled.closed = 0;
});

describe('BlsCatalogProvider', () => {
  it('öffnet den Katalog über SQLiteProvider mit dem gebündelten Asset', async () => {
    mockInstalled.version = blsCatalogVersion;

    expect(await renderCatalog()).toMatchObject({
      databaseName: 'bls-katalog.db',
      assetSource: { assetId: require('../../assets/catalog/bls-katalog.db'), forceOverwrite: false },
    });
    // Die Verbindung der Versionsprüfung ist zu, bevor SQLiteProvider die Datei ersetzen könnte.
    expect(mockInstalled.closed).toBe(1);
    expect(screen.getByText('Hafer Flocken')).toBeOnTheScreen();
  });

  it('setzt forceOverwrite bei einer anderen installierten Version', async () => {
    mockInstalled.version = 'bls-4.0+0';

    expect(await renderCatalog()).toMatchObject({ assetSource: { forceOverwrite: true } });
  });

  it('setzt forceOverwrite, wenn noch kein Katalog installiert ist', async () => {
    mockInstalled.version = null;

    expect(await renderCatalog()).toMatchObject({ assetSource: { forceOverwrite: true } });
  });
});
