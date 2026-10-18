import { defineProject } from 'vitest/config';

export default defineProject({
  // Tests, die App-Code importieren (etwa test/sync-app.test.ts), laden die gebündelten SQLite-Migrationen
  // der App. Dort bettet babel-plugin-inline-import die `.sql`-Dateien als Text ein, hier dieses Plugin.
  plugins: [
    {
      name: 'sql-als-text',
      transform(code, id) {
        return id.endsWith('.sql') ? { code: `export default ${JSON.stringify(code)};`, map: null } : null;
      },
    },
  ],
  test: {
    name: '@abnehm/backend',
    globalSetup: ['./test/support/postgres-server.ts'],
  },
});
