import { openDatabaseSync, SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useMemo, useState, type ReactNode } from 'react';

import { catalogAssetSource, catalogVersion, type BundledCatalog, type CatalogDatabase, type InstalledCatalogs } from './catalog';

// Produktiver Öffner der Katalogdatenbanken (Spezifikation 2, Abschnitt 3): `SQLiteProvider` mit
// `assetSource` kopiert das gebündelte Asset ins Datenbankverzeichnis und öffnet es mit einer eigenen
// Verbindung, getrennt von den Kontodatenbanken (https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/).
// Bis die Datei offen ist, rendert er nichts.

const installedCatalogs: InstalledCatalogs = {
  version(databaseName) {
    // Fehlt die Datei, legt `openDatabaseSync` eine leere an; sie hat keine Version, also ersetzt
    // `SQLiteProvider` sie anschließend durch das Asset.
    const client = openDatabaseSync(databaseName);
    try {
      return catalogVersion(catalogDatabase(client));
    } finally {
      client.closeSync();
    }
  },
};

/** Öffnet einen mitgelieferten Katalog für die Kinder; `useCatalogDatabase` liest ihn. */
export function CatalogProvider({ catalog, children }: { catalog: BundledCatalog; children: ReactNode }) {
  // Einmal je Einbindung entschieden: Nach dem Kopieren trägt die Datei schon die neue Version.
  const [assetSource] = useState(() => catalogAssetSource(catalog, installedCatalogs));
  return (
    <SQLiteProvider databaseName={catalog.databaseName} assetSource={assetSource} onInit={queryOnly}>
      {children}
    </SQLiteProvider>
  );
}

/** Die Katalogdatenbank des umgebenden `CatalogProvider`. */
export function useCatalogDatabase(): CatalogDatabase {
  const client = useSQLiteContext();
  return useMemo(() => catalogDatabase(client), [client]);
}

/** Der Katalog ist schreibgeschützt: Schreibende Anweisungen scheitern (https://www.sqlite.org/pragma.html#pragma_query_only). */
async function queryOnly(client: SQLiteDatabase): Promise<void> {
  await client.execAsync('PRAGMA query_only = ON');
}

function catalogDatabase(client: SQLiteDatabase): CatalogDatabase {
  return { all: <Row,>(sql: string, params: readonly (string | number | null)[] = []) => client.getAllSync<Row>(sql, [...params]) };
}
