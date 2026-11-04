import { Hono } from 'hono';

import { SeedRequest, seedManifests, seedRoutePath } from '@abnehm/contracts/seeds';

import type { Backend } from '../src/backend.ts';
import { jsonBody } from '../src/contract-validation.ts';
import type { Database } from '../src/database.ts';
import { FakeMealVisionRequest, type FakeMealVision } from './meal-vision/fake-analyzer.ts';
import { seedScenario } from './seed/server-seed.ts';

// Development-Backend (#112): die echte App des Backends, davor die Testfähigkeiten. Liegt außerhalb
// von `src/`; das Produktions-Image kopiert diesen Ordner nicht, und der Release-Test prüft das.
// Die Routen hier stehen vor der App und damit vor ihrer Autorisierung (`enforce`): Seeden braucht
// keine Sitzung, denn es legt die Konten erst an.

export function createDevelopmentApp({
  backend,
  database,
  fakeMealVision,
}: {
  backend: Pick<Backend, 'app' | 'uncoupling' | 'photoStorage'>;
  database: Database;
  /** Fake der Fotoanalyse (#161); `POST /dev/fotoanalyse` stellt seine Antwort um, etwa für E2E-Abläufe. */
  fakeMealVision: FakeMealVision;
}) {
  return new Hono()
    .post(seedRoutePath, jsonBody(SeedRequest), async (c) => {
      await seedScenario(database, backend, seedManifests[c.req.valid('json').scenario]);
      return c.body(null, 204);
    })
    .post('/dev/fotoanalyse', jsonBody(FakeMealVisionRequest), (c) => {
      fakeMealVision.behave(c.req.valid('json').verhalten);
      return c.body(null, 204);
    })
    .route('/', backend.app);
}
