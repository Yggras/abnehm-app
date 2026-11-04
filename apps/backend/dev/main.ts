import { runBackend } from '../src/serve.ts';
import { createClaudeMealVisionAnalyzer } from '../src/nutrition/claude-meal-vision.ts';
import { createDevelopmentApp } from './app.ts';
import { createFakeMealVision } from './meal-vision/fake-analyzer.ts';

// Backend-Prozess des Development-Images (Docker-Stage `development`, siehe apps/backend/Dockerfile):
// dieselbe App wie in Produktion, zusätzlich die Testfähigkeiten aus diesem Ordner. Die Fotoanalyse
// läuft über den Fake (#161); mit `ANTHROPIC_API_KEY_FILE` analysiert auch hier Claude, etwa für den
// Eigen-Test (#170). Die Route `POST /dev/fotoanalyse` stellt den Fake um.
const fakeMealVision = createFakeMealVision();

await runBackend({
  mealVisionAnalyzer: (config) => (config.mealVision === null ? fakeMealVision.analyzer : createClaudeMealVisionAnalyzer(config.mealVision)),
  served: (backend, database) => createDevelopmentApp({ backend, database, fakeMealVision }),
});
