import { Hono } from 'hono';

import { SeedRequest, ServerClockRequest, seedManifests, seedRoutePath, serverClockRoutePath } from '@abnehm/contracts/seeds';

import type { Backend } from '../src/backend.ts';
import { jsonBody } from '../src/contract-validation.ts';
import type { Database } from '../src/database.ts';
import { FakeMealVisionRequest, type FakeMealVision } from './meal-vision/fake-analyzer.ts';
import { seedScenario } from './seed/server-seed.ts';
import type { ServerClock } from './server-clock.ts';

// Development-Backend (#112): die echte App des Backends, davor die Testfähigkeiten. Liegt außerhalb
// von `src/`; das Produktions-Image kopiert diesen Ordner nicht, und der Release-Test prüft das.
// Die Routen hier stehen vor der App und damit vor ihrer Autorisierung (`enforce`): Seeden braucht
// keine Sitzung, denn es legt die Konten erst an.

export function createDevelopmentApp({
  backend,
  database,
  fakeMealVision,
  serverClock,
}: {
  backend: Pick<Backend, 'app' | 'uncoupling' | 'photoStorage'>;
  database: Database;
  /** Fake der Fotoanalyse (#161); `POST /dev/fotoanalyse` stellt seine Antwort um, etwa für E2E-Abläufe. */
  fakeMealVision: FakeMealVision;
  /** Die Uhr, die `backend` liest (#271); Seed-Route und `POST /dev/uhr` stellen sie. */
  serverClock: ServerClock;
}) {
  return new Hono()
    .post(seedRoutePath, jsonBody(SeedRequest), async (c) => {
      const manifest = seedManifests[c.req.valid('json').scenario];
      // Vor dem Seeden: Die Serverschritte des Manifests (`entkoppeln`) rechnen schon mit seiner Uhr.
      serverClock.set(manifest.clock.instant);
      await seedScenario(database, backend, manifest);
      return c.body(null, 204);
    })
    .post(serverClockRoutePath, jsonBody(ServerClockRequest), (c) => {
      serverClock.set(c.req.valid('json').instant);
      return c.body(null, 204);
    })
    .post('/dev/fotoanalyse', jsonBody(FakeMealVisionRequest), (c) => {
      fakeMealVision.behave(c.req.valid('json').verhalten);
      return c.body(null, 204);
    })
    .route('/', backend.app);
}
