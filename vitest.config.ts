import { defineConfig } from 'vitest/config';

// Integration global setup (test database, migrations) is added in Task 1.18.
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
        },
      },
    ],
  },
});
