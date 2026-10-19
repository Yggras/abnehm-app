import { runBackend } from './serve.ts';

// Produktiver Backend-Prozess. Er enthält keine Testfähigkeiten; die bettet nur das
// Development-Backend ein (apps/backend/dev/main.ts, nicht im Produktions-Image).
await runBackend();
