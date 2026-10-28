// Lokale Fachdatenbank der App (Spezifikation 0, Abschnitte 1, 8 und 9). Bereichscode kennt nur
// diese Schnittstelle: kontogetrennte Datenbanken, Transaktionen mit opakem Kontext und
// Beobachtungen. Drizzle- und expo-sqlite-Typen tauchen hier nicht auf; fachliche Repositories
// öffnen den Kontext mit `sqliteOf` aus `./sqlite`. Die Datenbanken des Geräts über expo-sqlite
// erzeugt nur der Composition Root (`./device-databases`), damit diese Schnittstelle auch in
// Node-Integrationstests ohne expo-sqlite lädt.
export type { ReadContext, TransactionContext } from './context';
export { LocalDatabaseClosedError, type LocalDatabase } from './local-database';
export type { LocalDatabases } from './local-databases';
