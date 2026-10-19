import { Hono } from 'hono';

import { SeedRequest, seedManifests, seedRoutePath } from '@abnehm/contracts/seeds';

import type { Backend } from '../src/backend.ts';
import { jsonBody } from '../src/contract-validation.ts';
import type { Database } from '../src/database.ts';
import { seedServer } from './seed/server-seed.ts';

// Development-Backend (#112): die echte App des Backends, davor die Testfähigkeiten. Liegt außerhalb
// von `src/`; das Produktions-Image kopiert diesen Ordner nicht, und der Release-Test prüft das.
// Die Routen hier stehen vor der App und damit vor ihrer Autorisierung (`enforce`): Seeden braucht
// keine Sitzung, denn es legt die Konten erst an.

export function createDevelopmentApp({ backend, database }: { backend: Pick<Backend, 'app'>; database: Database }) {
  return new Hono()
    .post(seedRoutePath, jsonBody(SeedRequest), async (c) => {
      await seedServer(database, seedManifests[c.req.valid('json').scenario]);
      return c.body(null, 204);
    })
    .route('/', backend.app);
}
