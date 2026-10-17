import { defineConfig } from 'vitest/config';

// Node-Testsuite: Backend und gemeinsame Pakete. Die App testet mit Jest (apps/mobile).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/backend'],
  },
});
