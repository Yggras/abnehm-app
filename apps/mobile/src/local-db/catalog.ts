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
