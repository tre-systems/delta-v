import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        // Prevent coverage backsliding on game logic (shared engine)
        'src/shared/**/*.ts': {
          statements: 84,
          branches: 75,
          functions: 88,
          lines: 85,
        },
        // Prevent coverage backsliding on server + Durable Object layer.
        // Branches held at 76 after adding structured-lifecycle-log paths
        // that exercise optional bindings (D1 absent / present); raise
        // when those paths get dedicated tests.
        'src/server/**/*.ts': {
          statements: 83,
          branches: 76,
          functions: 78,
          lines: 83,
        },
        // Modest baseline for the client so future regressions in the
        // reactive/UI layer surface; chosen to sit just below the current
        // measured coverage so the floor rises gradually with new tests.
        'src/client/**/*.ts': {
          statements: 60,
          branches: 55,
          functions: 65,
          lines: 60,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          include: ['src/client/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
      {
        extends: true,
        test: {
          name: 'server-shared',
          include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
