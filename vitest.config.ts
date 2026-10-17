import { defineConfig } from 'vitest/config';

// Node-Testsuite: Backend, gemeinsame Pakete und repoweite Prüfungen (test/).
// Die App testet mit Jest (apps/mobile).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/backend', { test: { name: 'repo', include: ['test/**/*.test.ts'] } }],
  },
});
