import { createSystemClock } from '@abnehm/clock';

import { runBackend } from '../src/serve.ts';
import { createDevelopmentApp } from './app.ts';
import { createFakeMealVision } from './meal-vision/fake-analyzer.ts';
import { createServerClock } from './server-clock.ts';

// Backend-Prozess des Development-Images (Docker-Stage `development`, siehe apps/backend/Dockerfile):
// dieselbe App wie in Produktion, zusätzlich die Testfähigkeiten aus diesem Ordner. Die Fotoanalyse
// läuft immer über den Fake (#161); die Route `POST /dev/fotoanalyse` stellt ihn um. Das Backend liest
// die steuerbare Serveruhr (#271): bis zum ersten Stellen die Systemuhr, danach stellen Seed und
// `POST /dev/uhr` sie.
const fakeMealVision = createFakeMealVision();
const serverClock = createServerClock(createSystemClock({ timeZone: () => 'UTC' }));

await runBackend({
  clock: serverClock,
  mealVisionAnalyzer: () => fakeMealVision.analyzer,
  served: (backend, database) => createDevelopmentApp({ backend, database, fakeMealVision, serverClock }),
});
