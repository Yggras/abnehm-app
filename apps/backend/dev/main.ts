import { runBackend } from '../src/serve.ts';
import { createDevelopmentApp } from './app.ts';
import { createFakeMealVision } from './meal-vision/fake-analyzer.ts';

// Backend-Prozess des Development-Images (Docker-Stage `development`, siehe apps/backend/Dockerfile):
// dieselbe App wie in Produktion, zusätzlich die Testfähigkeiten aus diesem Ordner. Die Fotoanalyse
// läuft immer über den Fake (#161); die Route `POST /dev/fotoanalyse` stellt ihn um.
const fakeMealVision = createFakeMealVision();

await runBackend({
  mealVisionAnalyzer: () => fakeMealVision.analyzer,
  served: (backend, database) => createDevelopmentApp({ backend, database, fakeMealVision }),
});
