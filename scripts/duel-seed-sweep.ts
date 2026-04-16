/**
 * Run headless duel simulations across many base seeds (same harness as CI).
 * Use this before changing duel geometry or rules so seat balance and pacing
 * are visible across seeds, not just one `--seed` run.
 *
 * Usage:
 *   npx tsx scripts/duel-seed-sweep.ts
 *   npx tsx scripts/duel-seed-sweep.ts --iterations 60 --from 0 --to 31
 *   npx tsx scripts/duel-seed-sweep.ts --seeds 0,1,42 --json
 */
import { pathToFileURL } from 'node:url';
import { isValidScenario, type ScenarioKey } from '../src/shared/map-data';
import { runSimulation, type SimulationMetrics } from './simulate-ai';

const defaultIterations = 40;

const parseSeeds = (raw: string | undefined): number[] => {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
};

const main = async () => {
  const args = process.argv.slice(2);
  let iterations = defaultIterations;
  let from = 0;
  let to = 15;
  let seedsArg: string | undefined;
  let jsonOut = false;
  let scenario: ScenarioKey = 'duel';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--iterations':
      case '-n':
        iterations = Number.parseInt(args[++i] ?? '', 10);
        break;
      case '--from':
        from = Number.parseInt(args[++i] ?? '', 10);
        break;
      case '--to':
        to = Number.parseInt(args[++i] ?? '', 10);
        break;
      case '--seeds':
        seedsArg = args[++i];
        break;
      case '--json':
        jsonOut = true;
        break;
      case '--scenario':
        scenario = (args[++i] ?? 'duel') as ScenarioKey;
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(iterations) || iterations < 1) {
    console.error('Invalid --iterations');
    process.exit(1);
  }

  if (!isValidScenario(scenario)) {
    console.error(`Invalid scenario: ${scenario}`);
    process.exit(1);
  }

  const explicit = parseSeeds(seedsArg);
  const seeds =
    explicit.length > 0
      ? explicit
      : Array.from({ length: Math.max(0, to - from + 1) }, (_, j) => from + j);

  if (seeds.length === 0) {
    console.error('No seeds (use --from/--to or --seeds)');
    process.exit(1);
  }

  const rows: Array<
    SimulationMetrics & {
      baseSeed: number;
      p0DecidedPct: number | null;
      avgTurns: number;
    }
  > = [];

  for (const baseSeed of seeds) {
    const metrics = await runSimulation(scenario, iterations, {
      p0Diff: 'hard',
      p1Diff: 'hard',
      randomizeStart: false,
      forcedStart: null,
      baseSeed,
      json: false,
      quiet: true,
    });

    const decided = metrics.player0Wins + metrics.player1Wins;
    const p0DecidedPct =
      decided > 0 ? (metrics.player0Wins / decided) * 100 : null;
    const avgTurns = metrics.totalTurns / metrics.totalGames;

    rows.push({
      ...metrics,
      baseSeed,
      p0DecidedPct,
      avgTurns,
    });
  }

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          scenario,
          iterations,
          seeds,
          rows: rows.map((r) => ({
            baseSeed: r.baseSeed,
            totalGames: r.totalGames,
            player0Wins: r.player0Wins,
            player1Wins: r.player1Wins,
            draws: r.draws,
            crashes: r.crashes,
            p0DecidedPct: r.p0DecidedPct,
            avgTurns: r.avgTurns,
            reasons: r.reasons,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const hdr =
    'seed'.padEnd(12) +
    'p0/dec%'.padStart(10) +
    'draw%'.padStart(8) +
    'avgTurn'.padStart(10) +
    'crash'.padStart(8);
  console.log(`\n${scenario} × ${iterations} games per base seed\n${hdr}`);
  console.log('-'.repeat(hdr.length));

  for (const r of rows) {
    const drawPct = (r.draws / r.totalGames) * 100;
    const p0DecidedCell =
      r.p0DecidedPct !== null ? r.p0DecidedPct.toFixed(1) : '—';
    console.log(
      String(r.baseSeed >>> 0).padEnd(12) +
        p0DecidedCell.padStart(10) +
        `${drawPct.toFixed(1)}%`.padStart(8) +
        r.avgTurns.toFixed(1).padStart(10) +
        String(r.crashes).padStart(8),
    );
  }

  console.log(
    '\n`p0/dec%` is Player 0 wins divided by decided games (wins only, no draws).',
  );

  const avgs = rows.map((r) => r.avgTurns);
  const minTurn = Math.min(...avgs);
  const maxTurn = Math.max(...avgs);
  const meanTurn = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  const decidedRates = rows
    .map((r) => r.p0DecidedPct)
    .filter((x): x is number => x !== null);
  const meanP0Decided =
    decidedRates.length > 0
      ? decidedRates.reduce((a, b) => a + b, 0) / decidedRates.length
      : null;

  console.log(
    `\nAcross ${rows.length} base seeds: avg turns mean ${meanTurn.toFixed(1)} (min ${minTurn.toFixed(1)}, max ${maxTurn.toFixed(1)})` +
      (meanP0Decided !== null
        ? `; mean P0/decided ${meanP0Decided.toFixed(1)}%`
        : ''),
  );

  const totalCrashes = rows.reduce((s, r) => s + r.crashes, 0);
  if (totalCrashes > 0) {
    console.error(`\nEngine crashes (non-zero): ${totalCrashes}`);
    process.exitCode = 1;
  }
};

const shouldRunCli = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
};

if (shouldRunCli()) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
