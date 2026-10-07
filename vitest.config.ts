import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup/reflect-metadata.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // Creates and migrates the test database once (needs `docker compose up -d --wait`).
          globalSetup: ['tests/integration/global-setup.ts'],
          // Files share one test database (and broker), so they run one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
