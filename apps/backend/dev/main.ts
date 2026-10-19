import { runBackend } from '../src/serve.ts';
import { createDevelopmentApp } from './app.ts';

// Backend-Prozess des Development-Images (Docker-Stage `development`, siehe apps/backend/Dockerfile):
// dieselbe App wie in Produktion, zusätzlich die Testfähigkeiten aus diesem Ordner.
await runBackend((backend, database) => createDevelopmentApp({ backend, database }));
