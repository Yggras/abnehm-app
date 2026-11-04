import { SeedRequest, SeedScenarioKey, seedManifests, seedRoutePath } from '@abnehm/contracts/seeds';

import { readConfig } from '../src/config.ts';
import { errorCodeForLog } from '../src/log.ts';

// Seed-Kommando des Development-Backends (#112): setzt Postgres auf den Ausgangszustand eines
// Szenarios, führt dessen Serverschritte aus (#117) und nennt die Testkonten. Aufruf über
// `scripts/dev-seed <szenario>`. Es gibt das Kommando nur im Development-Image, nicht im Produktions-Image.
//
// Das Kommando läuft als eigener Prozess im Container des Backends und seedet über dessen Seed-Route.
// Nur so stellt es auch die Serveruhr des laufenden Backend-Prozesses auf die Uhr des Manifests (#271);
// Seed-Route und Kommando teilen damit genau einen Ablauf.
const scenario = SeedScenarioKey.safeParse(process.argv[2]);
if (!scenario.success) {
  console.error(`[seed] Szenario angeben: ${SeedScenarioKey.options.join(', ')}`);
  process.exit(2);
}

const manifest = seedManifests[scenario.data];
const { port } = readConfig(process.env);
try {
  const response = await fetch(`http://127.0.0.1:${port}${seedRoutePath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SeedRequest.parse({ scenario: scenario.data })),
  });
  if (response.status === 204) {
    console.log(`[seed] Szenario ${manifest.scenario} (Revision ${manifest.revision}) geseedet. Testkonten:`);
    for (const account of manifest.accounts) console.log(`[seed]   ${account.email} / ${account.password}`);
  } else {
    console.error(`[seed] Fehlgeschlagen: Die Seed-Route antwortete mit ${response.status}.`);
    process.exitCode = 1;
  }
} catch (error) {
  // Meist läuft der Backend-Prozess nicht (mehr); `npm run backend` startet ihn.
  console.error('[seed] Backend nicht erreichbar:', errorCodeForLog(error));
  process.exitCode = 1;
}
