import { defineConfig } from 'tsup';

export default defineConfig({
  // main: the server. migrate: the pre-deploy step that applies database migrations.
  entry: ['src/main.ts', 'src/migrate.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them into the server build.
  // Third-party dependencies stay external and are installed in the Docker image.
  noExternal: [/^@fairshare\//],
});
