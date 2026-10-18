import type { SqliteDatabase } from './connection';
import { requireOpen, type ReadContext } from './context';

// Zugang für fachliche Repositories: Sie bauen ihre Abfragen mit Drizzle über dem Schema
// (`./schema`). Bildschirme und Befehle sehen nur die opaken Kontexte aus `./index`.

export type { SqliteDatabase };

/** Drizzle-Datenbank der laufenden Transaktion; schlägt fehl, sobald die Transaktion beendet ist. */
export function sqliteOf(context: ReadContext): SqliteDatabase {
  return requireOpen(context);
}
