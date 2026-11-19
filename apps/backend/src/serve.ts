import { serve } from '@hono/node-server';

import type { Clock } from '@abnehm/clock';

import { createBackend, type Backend } from './backend.ts';
import { readConfig, type BackendConfig } from './config.ts';
import { openDatabase, type Database } from './database.ts';
import { migrateDatabase } from './db/migrate.ts';
import { errorCodeForLog } from './log.ts';
import { createExpoPushClient } from './notifications/expo-push.ts';
import { productionMealVisionAnalyzer } from './nutrition/claude-meal-vision.ts';
import type { MealVisionAnalyzer } from './nutrition/meal-vision.ts';

/** Was der Server beantwortet: die Hono-App des Backends oder eine App, die sie einbettet. */
export type ServedApp = { fetch: (request: Request) => Response | Promise<Response> };

export type BackendProcess = {
  /** Was der Server beantwortet; ohne Angabe nur die App des Backends. */
  served?: (backend: Backend, database: Database) => ServedApp;
  /** KI-Bildanalyse; ohne Angabe der Claude-Adapter, der einen Schlüssel verlangt. */
  mealVisionAnalyzer?: (config: BackendConfig) => MealVisionAnalyzer;
  /** Uhr des Backends; ohne Angabe die Systemuhr in UTC (`createBackend`). */
  clock?: Clock;
};

/**
 * Startet den Backend-Prozess: Konfiguration lesen, migrieren, Module zusammensetzen, Jobs und HTTP
 * starten, bei SIGTERM/SIGINT geordnet herunterfahren. `src/main.ts` startet ohne Angaben: nur die App
 * des Backends, Analyse über Claude, Systemuhr. Das Development-Backend (`apps/backend/dev/main.ts`)
 * bettet die App in seine Testfähigkeiten ein und bringt Analyzer und steuerbare Serveruhr mit.
 */
export async function runBackend({
  served = (backend) => backend.app,
  mealVisionAnalyzer = (config) => productionMealVisionAnalyzer(config.mealVision),
  clock,
}: BackendProcess = {}) {
  const config = readConfig(process.env);
  const analyzer = mealVisionAnalyzer(config);
  const database = openDatabase(config.database);
  // Erst migrieren, dann Anfragen annehmen; ohne aktuelles Schema startet das Backend nicht.
  try {
    await migrateDatabase(database);
  } catch (error) {
    console.error('[backend] Migration fehlgeschlagen:', errorCodeForLog(error));
    await database.close();
    process.exit(1);
  }
  const backend = createBackend({
    database,
    authSettings: config.auth,
    invitationSettings: config.invitations,
    photoStorageDirectory: config.photoStorageDirectory,
    mealVisionAnalyzer: analyzer,
    expoPush: createExpoPushClient({ accessToken: config.expoPush.accessToken }),
    clock,
  });
  // Zeitgesteuerte Serverjobs laufen im Backend-Prozess (src/jobs/job-registry.ts), darunter die
  // Arbeitsschleife des Push-Zustellers; der Commit eines neuen Intents stößt sie zusätzlich sofort an.
  const stopJobs = backend.jobs.start();
  const stopListening = await backend.pushDelivery.listen();

  // Im Container auf allen Interfaces; welche Adresse nach außen sichtbar ist, legt compose.yaml fest.
  const server = serve({ fetch: served(backend, database).fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`[backend] Bereit auf Port ${info.port}`);
  });

  let stopping = false;
  function stop(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`[backend] ${signal} empfangen, fahre herunter`);
    server.close(() => {
      void stopListening()
        .then(() => stopJobs())
        .then(() => database.close())
        .finally(() => process.exit(0));
    });
  }

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
