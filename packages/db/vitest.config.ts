import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Migrates the template database once; each test file then clones its own copy.
    globalSetup: ['./src/testing/global-setup.ts'],
  },
});
