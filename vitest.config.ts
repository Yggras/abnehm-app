import { configDefaults, defineConfig } from 'vitest/config';

// Node-Testsuite: Backend, gemeinsame Pakete und repoweite Prüfungen (test/).
// Die App testet mit Jest (apps/mobile).
// Die Release-Sperren exportieren die App per `expo export` und dauern Minuten. Als eigenes Projekt
// laufen sie in der CI in einem eigenen Job (`--project release`), alles andere daneben (`--project '!release'`).
const releaseLocks = 'test/release-sperren.test.ts';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/backend',
      { test: { name: 'repo', include: ['test/**/*.test.ts'], exclude: [...configDefaults.exclude, releaseLocks] } },
      { test: { name: 'release', include: [releaseLocks] } },
    ],
  },
});
