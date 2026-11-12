import { defineConfig } from 'vitest/config';

// Its own template database, apart from packages/db's: both packages' tests run at the same time
// under turbo (see @fairshare/db/testing). Set here, so the global setup and the workers inherit it.
process.env.TEST_TEMPLATE_DATABASE = 'fairshare_test_template_api';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests need Postgres: `pnpm db:up` locally, a service container in CI.
    globalSetup: ['./src/testing/global-setup.ts'],
    // Integration tests run against real Postgres, and some create an extra database. With every
    // package's tests running at once (turbo), creating one can take several seconds.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
