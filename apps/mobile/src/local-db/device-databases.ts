import { openExpoSqlite } from './expo-connection';
import { createLocalDatabases, type LocalDatabases } from './local-databases';

/** Kontogetrennte Datenbanken des Geräts über expo-sqlite; nur für den Composition Root. */
export function createDeviceLocalDatabases(options: { onError: (error: unknown) => void }): LocalDatabases {
  return createLocalDatabases({ openSqlite: openExpoSqlite, onError: options.onError });
}
