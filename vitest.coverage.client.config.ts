import { defineConfig } from 'vitest/config';
import {
  clientCoverageThresholds,
  coverageExclude,
  coverageReporter,
} from './vitest.coverage.shared';

export default defineConfig({
  test: {
    include: ['src/client/**/*.test.ts'],
    exclude: ['e2e/**'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/client/**/*.ts'],
      exclude: coverageExclude,
      reporter: coverageReporter,
      reportsDirectory: './coverage/client',
      thresholds: clientCoverageThresholds,
    },
  },
});
