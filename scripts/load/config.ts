import { SCENARIOS } from '../../src/shared/map-data';
import type { LoadTestConfig } from './types';

export const DEFAULT_SERVER_URL =
  process.env.SERVER_URL || 'http://127.0.0.1:8787';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const parseIntegerFlag = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseNumberFlag = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

export const printUsage = (): void => {
  console.log(`Delta-V websocket load / chaos tester

Usage:
  npm run load:test -- --games 20 --concurrency 5

Flags:
  --server-url         Worker base URL (default: ${DEFAULT_SERVER_URL})
  --scenario           Scenario key to create (default: biplanetary)
  --games              Total matches to run (default: 10)
  --concurrency        Concurrent matches in flight (default: 4)
  --spawn-delay-ms     Delay between launches (default: 250)
  --think-min-ms       Minimum per-action think delay (default: 150)
  --think-max-ms       Maximum per-action think delay (default: 600)
  --disconnect-rate    Fraction of bots that inject one reconnect (default: 0.1)
  --reconnect-delay-ms Delay before reconnect after chaos drop (default: 1500)
  --game-timeout-ms    Fail a match if it runs too long (default: 120000)
  --difficulty         AI difficulty: easy | normal | hard (default: normal)
  --help               Show this help
`);
};

export const parseArgs = (argv: string[]): LoadTestConfig => {
  const args = [...argv];
  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);

    if (index === -1) return undefined;

    return args[index + 1];
  };

  if (args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const scenario = getFlag('--scenario') ?? 'biplanetary';

  if (!(scenario in SCENARIOS)) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  const difficultyRaw = getFlag('--difficulty') ?? 'normal';

  if (
    difficultyRaw !== 'easy' &&
    difficultyRaw !== 'normal' &&
    difficultyRaw !== 'hard'
  ) {
    throw new Error(`Unknown difficulty: ${difficultyRaw}`);
  }

  const games = Math.max(1, parseIntegerFlag(getFlag('--games'), 10));
  const concurrency = clamp(
    parseIntegerFlag(getFlag('--concurrency'), 4),
    1,
    games,
  );

  return {
    serverUrl: getFlag('--server-url') ?? DEFAULT_SERVER_URL,
    scenario,
    games,
    concurrency,
    spawnDelayMs: Math.max(
      0,
      parseIntegerFlag(getFlag('--spawn-delay-ms'), 250),
    ),
    thinkMinMs: Math.max(0, parseIntegerFlag(getFlag('--think-min-ms'), 150)),
    thinkMaxMs: Math.max(0, parseIntegerFlag(getFlag('--think-max-ms'), 600)),
    disconnectRate: clamp(
      parseNumberFlag(getFlag('--disconnect-rate'), 0.1),
      0,
      1,
    ),
    reconnectDelayMs: Math.max(
      0,
      parseIntegerFlag(getFlag('--reconnect-delay-ms'), 1500),
    ),
    gameTimeoutMs: Math.max(
      1000,
      parseIntegerFlag(getFlag('--game-timeout-ms'), 120_000),
    ),
    difficulty: difficultyRaw,
  };
};
