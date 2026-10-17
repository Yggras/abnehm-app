import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@abnehm/backend',
    globalSetup: ['./test/support/postgres-server.ts'],
  },
});
