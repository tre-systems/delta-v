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
        // Prevent coverage backsliding on server + Durable Object layer
        'src/server/**/*.ts': {
          statements: 83,
          branches: 78,
          functions: 78,
          lines: 83,
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
