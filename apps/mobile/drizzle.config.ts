import { defineConfig } from 'drizzle-kit';

// Erzeugt die SQLite-Migrationen der lokalen Kontodatenbank aus dem Schema:
// `npx drizzle-kit generate` in apps/mobile. `driver: 'expo'` legt zusätzlich `migrations.js` an,
// das die SQL-Dateien über babel-plugin-inline-import in das App-Bundle holt
// (https://orm.drizzle.team/docs/connect-expo-sqlite).
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/local-db/schema/index.ts',
  out: './src/local-db/migrations',
  strict: true,
});
