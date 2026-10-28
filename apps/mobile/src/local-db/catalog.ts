// Mitgelieferte Katalogdatenbanken (Spezifikation 2, Abschnitt 3): schreibgeschützte SQLite-Dateien,
// die die App getrennt von der Fachdatenbank öffnet, zuerst den BLS-Katalog. Sie gehören keinem Konto
// und werden nicht synchronisiert. Bereichscode liest sie nur über `CatalogDatabase`; produktiv öffnet
// sie `CatalogProvider`, in Tests `testing/better-sqlite-catalog.ts`.

export type CatalogValue = string | number | null;

/** Lesender Zugriff auf eine Katalogdatenbank. */
export type CatalogDatabase = {
  /** Alle Zeilen einer Abfrage mit gebundenen Parametern. */
  all<Row>(sql: string, params?: readonly CatalogValue[]): Row[];
};

/**
 * Ein mitgelieferter Katalog: Dateiname im Datenbankverzeichnis, Katalogversion und das gebündelte
 * Asset (`require(…)`). Jede Katalogdatei trägt ihre Version in der Tabelle `catalog_info`.
 */
export type BundledCatalog = Readonly<{ databaseName: string; version: string; assetId: number }>;

/** Die auf dem Gerät installierten Katalogdateien. */
export type InstalledCatalogs = {
  /** Version der installierten Datei; `null`, wenn sie fehlt oder kein Katalog ist. */
  version(databaseName: string): string | null;
};

/**
 * `assetSource` für `SQLiteProvider`: Fehlt die Datei, kopiert expo-sqlite das Asset ohnehin. Eine
 * vorhandene Datei ersetzt es nur mit `forceOverwrite`, und das nur bei einer neuen Katalogversion
 * (https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/, `SQLiteProviderAssetSource`).
 */
export function catalogAssetSource(
  catalog: BundledCatalog,
  installed: InstalledCatalogs,
): { assetId: number; forceOverwrite: boolean } {
  return { assetId: catalog.assetId, forceOverwrite: installed.version(catalog.databaseName) !== catalog.version };
}

/** Katalogversion einer geöffneten Datei; `null` für eine leere oder fremde Datei. */
export function catalogVersion(database: CatalogDatabase): string | null {
  try {
    return database.all<{ version: string }>('SELECT version FROM catalog_info')[0]?.version ?? null;
  } catch {
    // Ohne Tabelle `catalog_info` ist die Datei kein Katalog, etwa die leere Datei, die expo-sqlite
    // beim Öffnen einer fehlenden Datei anlegt.
    return null;
  }
}
