import { SeedScenarioKey, seedManifests } from '@abnehm/contracts/seeds';

import { createBackend } from '../src/backend.ts';
import { readConfig } from '../src/config.ts';
import { openDatabase } from '../src/database.ts';
import { migrateDatabase } from '../src/db/migrate.ts';
import { errorCodeForLog } from '../src/log.ts';
import { createFakeMealVision } from './meal-vision/fake-analyzer.ts';
import { seedScenario } from './seed/server-seed.ts';

// Seed-Kommando des Development-Backends (#112): setzt Postgres auf den Ausgangszustand eines
// Szenarios, führt dessen Serverschritte aus (#117) und nennt die Testkonten. Aufruf über
// `scripts/dev-seed <szenario>`. Es gibt das Kommando nur im Development-Image, nicht im Produktions-Image.
const scenario = SeedScenarioKey.safeParse(process.argv[2]);
if (!scenario.success) {
  console.error(`[seed] Szenario angeben: ${SeedScenarioKey.options.join(', ')}`);
  process.exit(2);
}

const manifest = seedManifests[scenario.data];
const config = readConfig(process.env);
const database = openDatabase(config.database);
try {
  await migrateDatabase(database);
  // Dieselben Module wie im Backend-Prozess, damit angemeldete Entkopplungs-Beobachter mitlaufen.
  const backend = createBackend({
    database,
    authSettings: config.auth,
    invitationSettings: config.invitations,
    photoStorageDirectory: config.photoStorageDirectory,
    mealVisionAnalyzer: createFakeMealVision().analyzer,
  });
  await seedScenario(database, backend.uncoupling, manifest);
  console.log(`[seed] Szenario ${manifest.scenario} (Revision ${manifest.revision}) geseedet. Testkonten:`);
  for (const account of manifest.accounts) console.log(`[seed]   ${account.email} / ${account.password}`);
} catch (error) {
  console.error('[seed] Fehlgeschlagen:', errorCodeForLog(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
