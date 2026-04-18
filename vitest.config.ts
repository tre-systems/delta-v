import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packages/mcp-adapter/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'packages/mcp-adapter/**/*.test.ts',
        // Pure re-exports — no executable lines to cover meaningfully.
        'packages/mcp-adapter/src/index.ts',
        'packages/mcp-adapter/src/runtime.ts',
        // Test-only utilities (shared mocks, fixtures helpers) — no
        // production code imports these, so they'd otherwise drag
        // coverage down without reflecting real regressions.
        'src/**/test-support.ts',
      ],
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
        // Hosted MCP adapter: branch-heavy auth + tool paths; floors match
        // post-move v8 numbers so CI stays green without counting barrel files.
        'packages/mcp-adapter/**/*.ts': {
          statements: 67,
          branches: 52,
          functions: 75,
          lines: 70,
        },
        // Tighter floor on the Durable Object layer specifically — the
        // game-do/ subtree is where state, archiving, and MCP plumbing
        // live, and silent regressions there cost production time to
        // diagnose. Thresholds sit a hair below the current measured
        // coverage so new code either stays above the floor or ships
        // dedicated tests.
        'src/server/game-do/**/*.ts': {
          statements: 82,
          branches: 76,
          functions: 76,
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
          include: [
            'src/server/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'packages/mcp-adapter/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
    ],
  },
});
