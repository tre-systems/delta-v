import { defineConfig } from 'vitest/config';
import {
  coverageExclude,
  coverageReporter,
  sharedCoverageThresholds,
} from './vitest.coverage.shared';

export default defineConfig({
  test: {
    include: [
      'src/server/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'packages/mcp-adapter/**/*.test.ts',
    ],
    exclude: ['e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'packages/mcp-adapter/**/*.ts'],
      exclude: coverageExclude,
      reporter: coverageReporter,
      reportsDirectory: './coverage/server-shared',
      thresholds: sharedCoverageThresholds,
    },
  },
});
