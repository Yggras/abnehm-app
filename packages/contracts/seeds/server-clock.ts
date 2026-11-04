import { z } from 'zod';

import { Instant } from '../src/base.ts';

// Vertrag der steuerbaren Serveruhr des Development-Backends (#271). Er liegt bei den Seeds, weil es
// ihn wie die Seed-Route nur in Development- und Testartefakten gibt; Lint und Release-Test halten
// `@abnehm/contracts/seeds` aus dem Produktionscode heraus.

/** Pfad der Route, die die Serveruhr stellt; nur im Development-Backend. */
export const serverClockRoutePath = '/dev/uhr';

/** Body von `POST /dev/uhr`: Die Serveruhr steht danach auf diesem Zeitpunkt und läuft weiter. */
export const ServerClockRequest = z.strictObject({ instant: Instant });
export type ServerClockRequest = z.infer<typeof ServerClockRequest>;
