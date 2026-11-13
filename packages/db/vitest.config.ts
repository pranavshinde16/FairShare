import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Migrates the template database once; each test file then clones its own copy.
    globalSetup: ['./src/testing/global-setup.ts'],
    // As in apps/api: turbo runs both packages' integration tests at once, and every test file
    // clones and later drops its own database. Postgres checkpoints for each DROP DATABASE, so
    // under that load creating or dropping one can take more than the default 10 seconds.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
