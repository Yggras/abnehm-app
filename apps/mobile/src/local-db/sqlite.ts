// Zugang für fachliche Repositories: Sie bauen ihre Abfragen mit Drizzle über dem Schema
// (`./schema`). Bildschirme und Befehle sehen nur die opaken Kontexte aus `./index`.
export type { SqliteDatabase } from './connection';
export { sqliteOf } from './context';
