import { readConfig } from '../config.ts';
import { openDatabase } from '../database.ts';
import { errorCodeForLog } from '../log.ts';
import { migrateDatabase } from './migrate.ts';

// `npm run db:migrate --workspace @abnehm/backend`: führt ausstehende Migrationen aus und beendet sich.
// Dieselben Migrationen laufen auch beim Start des Backends (src/main.ts).
const database = openDatabase(readConfig(process.env).database);
try {
  await migrateDatabase(database);
  console.log('[migration] Datenbank ist auf dem aktuellen Stand');
} catch (error) {
  console.error('[migration] Fehlgeschlagen:', errorCodeForLog(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
