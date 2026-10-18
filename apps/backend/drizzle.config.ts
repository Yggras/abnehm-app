import { defineConfig } from 'drizzle-kit';

// Erzeugt die Postgres-Migrationen aus dem Schema: `npm run db:generate --workspace @abnehm/backend`.
// Ausgeführt werden sie per `npm run db:migrate` und beim Start des Backends (src/db/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
});
