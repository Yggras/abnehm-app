// Lokale Fachdatenbank der App (Spezifikation 0, Abschnitte 1, 8 und 9). Bereichscode kennt nur
// diese Schnittstelle: kontogetrennte Datenbanken, Transaktionen mit opakem Kontext und
// Beobachtungen. Drizzle- und expo-sqlite-Typen tauchen hier nicht auf; fachliche Repositories
// öffnen den Kontext mit `sqliteOf` aus `./sqlite`. Dazu kommen die mitgelieferten, schreibgeschützten
// Kataloge (Spezifikation 2, Abschnitt 3) als `CatalogDatabase`.
//
// Diese Schnittstelle lädt kein expo-sqlite, damit Node-Integrationstests sie laden. Was expo-sqlite
// braucht, hat einen eigenen Einstieg: Die Datenbanken des Geräts erzeugt der Composition Root
// (`./device-databases`), Kataloge öffnet `CatalogProvider` mit `useCatalogDatabase` (`./CatalogProvider`).
export type { BundledCatalog, CatalogDatabase, CatalogValue } from './catalog';
export type { ReadContext, TransactionContext } from './context';
export { LocalDatabaseClosedError, type LocalDatabase } from './local-database';
export type { LocalDatabases } from './local-databases';
