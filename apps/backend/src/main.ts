import { serve } from '@hono/node-server';

import { createBackend } from './backend.ts';
import { readConfig } from './config.ts';
import { openDatabase } from './database.ts';
import { migrateDatabase } from './db/migrate.ts';
import { errorCodeForLog } from './log.ts';

const config = readConfig(process.env);
const database = openDatabase(config.database);
// Erst migrieren, dann Anfragen annehmen; ohne aktuelles Schema startet das Backend nicht.
try {
  await migrateDatabase(database);
} catch (error) {
  console.error('[backend] Migration fehlgeschlagen:', errorCodeForLog(error));
  await database.close();
  process.exit(1);
}
const { app, jobs } = createBackend({ database, authSettings: config.auth });
// Zeitgesteuerte Serverjobs laufen im Backend-Prozess (src/jobs/job-registry.ts).
const stopJobs = jobs.start();

// Im Container auf allen Interfaces; welche Adresse nach außen sichtbar ist, legt compose.yaml fest.
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[backend] Bereit auf Port ${info.port}`);
});

let stopping = false;
function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[backend] ${signal} empfangen, fahre herunter`);
  server.close(() => {
    void stopJobs()
      .then(() => database.close())
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
