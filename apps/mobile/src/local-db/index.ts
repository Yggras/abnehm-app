import { openExpoSqlite } from './expo-connection';
import { createLocalDatabases, type LocalDatabases } from './local-databases';

// Lokale Fachdatenbank der App (Spezifikation 0, Abschnitte 1, 8 und 9). Bereichscode kennt nur
// diese Schnittstelle: kontogetrennte Datenbanken, Transaktionen mit opakem Kontext und
// Beobachtungen. Drizzle- und expo-sqlite-Typen tauchen hier nicht auf; fachliche Repositories
// öffnen den Kontext mit `sqliteOf` aus `./sqlite`. Dazu kommen die mitgelieferten, schreibgeschützten
// Kataloge (Spezifikation 2, Abschnitt 3) über `CatalogProvider` und `useCatalogDatabase`.
export type { BundledCatalog, CatalogDatabase, CatalogValue } from './catalog';
export { CatalogProvider, useCatalogDatabase } from './CatalogProvider';
export type { ReadContext, TransactionContext } from './context';
export { LocalDatabaseClosedError, type LocalDatabase } from './local-database';
export type { LocalDatabases } from './local-databases';

/** Kontogetrennte Datenbanken des Geräts über expo-sqlite. */
export function createDeviceLocalDatabases(options: { onError: (error: unknown) => void }): LocalDatabases {
  return createLocalDatabases({ openSqlite: openExpoSqlite, onError: options.onError });
}
