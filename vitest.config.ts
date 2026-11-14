import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 45000,
    hookTimeout: 30000,
    maxWorkers: 4,
  },
});
