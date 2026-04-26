/**
 * Run headless duel simulations across many base seeds (same harness as CI).
 * Use this before changing duel geometry or rules so seat balance and pacing
 * are visible across seeds, not just one `--seed` run.
 *
 * Usage:
 *   npx tsx scripts/duel-seed-sweep.ts
 *   npx tsx scripts/duel-seed-sweep.ts --iterations 60 --from 0 --to 31
 *   npx tsx scripts/duel-seed-sweep.ts --seeds 0,1,42 --json
 *   npx tsx scripts/duel-seed-sweep.ts --scenario convoy --iterations 30
 *   npx tsx scripts/duel-seed-sweep.ts --scenario convoy --json --baseline-json before.json
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isValidScenario, type ScenarioKey } from '../src/shared/map-data';
import { runSimulation, type SimulationMetrics } from './simulate-ai';

const defaultIterations = 40;

export type SeedSweepRow = SimulationMetrics & {
  baseSeed: number;
  p0DecidedPct: number | null;
  avgTurns: number;
};

export type SeedSweepSummary = {
  seedCount: number;
  avgTurnsMean: number;
  avgTurnsMin: number;
  avgTurnsMax: number;
  meanP0DecidedPct: number | null;
  meanObjectiveShare: number;
  meanFleetEliminationShare: number;
  meanTimeoutShare: number;
  meanFuelStallsPerGame: number;
  meanPassengerDeliveryShare: number;
  meanGrandTourCompletionShare: number;
  meanInvalidActionShare: number;
  meanPassengerTransferMistakesPerGame: number;
  totalCrashes: number;
};

export type SeedSweepSummaryComparison = {
  avgTurnsMeanDelta: number;
  meanP0DecidedPctDelta: number | null;
  meanObjectiveShareDelta: number;
  meanFleetEliminationShareDelta: number;
  meanTimeoutShareDelta: number;
  meanFuelStallsPerGameDelta: number;
  meanPassengerDeliveryShareDelta: number;
  meanGrandTourCompletionShareDelta: number;
  meanInvalidActionShareDelta: number;
  meanPassengerTransferMistakesPerGameDelta: number;
  totalCrashesDelta: number;
};

export type SeedSweepJsonReport = {
  scenario: string;
  iterations: number;
  seeds: number[];
  summary: SeedSweepSummary;
  rows?: unknown[];
};

export type SeedSweepBaselineContext = {
  scenario: string;
  iterations: number;
  seeds: readonly number[];
};

export const summarizeSeedSweepRows = (
  rows: readonly SeedSweepRow[],
): SeedSweepSummary => {
  if (rows.length === 0) {
    throw new Error('Cannot summarize an empty seed sweep.');
  }

  const avgTurns = rows.map((r) => r.avgTurns);
  const decidedRates = rows
    .map((r) => r.p0DecidedPct)
    .filter((x): x is number => x !== null);
  const mean = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    seedCount: rows.length,
    avgTurnsMean: mean(avgTurns),
    avgTurnsMin: Math.min(...avgTurns),
    avgTurnsMax: Math.max(...avgTurns),
    meanP0DecidedPct: decidedRates.length > 0 ? mean(decidedRates) : null,
    meanObjectiveShare: mean(rows.map((r) => r.scorecard.objectiveShare)),
    meanFleetEliminationShare: mean(
      rows.map((r) => r.scorecard.fleetEliminationShare),
    ),
    meanTimeoutShare: mean(rows.map((r) => r.scorecard.timeoutShare)),
    meanFuelStallsPerGame: mean(rows.map((r) => r.scorecard.fuelStallsPerGame)),
    meanPassengerDeliveryShare: mean(
      rows.map((r) => r.scorecard.passengerDeliveryShare),
    ),
    meanGrandTourCompletionShare: mean(
      rows.map((r) => r.scorecard.grandTourCompletionShare),
    ),
    meanInvalidActionShare: mean(
      rows.map((r) => r.scorecard.invalidActionShare),
    ),
    meanPassengerTransferMistakesPerGame: mean(
      rows.map((r) => r.scorecard.passengerTransferMistakesPerGame),
    ),
    totalCrashes: rows.reduce((sum, r) => sum + r.crashes, 0),
  };
};

export const compareSeedSweepSummaries = (
  before: SeedSweepSummary,
  after: SeedSweepSummary,
): SeedSweepSummaryComparison => ({
  avgTurnsMeanDelta: after.avgTurnsMean - before.avgTurnsMean,
  meanP0DecidedPctDelta:
    before.meanP0DecidedPct === null || after.meanP0DecidedPct === null
      ? null
      : after.meanP0DecidedPct - before.meanP0DecidedPct,
  meanObjectiveShareDelta: after.meanObjectiveShare - before.meanObjectiveShare,
  meanFleetEliminationShareDelta:
    after.meanFleetEliminationShare - before.meanFleetEliminationShare,
  meanTimeoutShareDelta: after.meanTimeoutShare - before.meanTimeoutShare,
  meanFuelStallsPerGameDelta:
    after.meanFuelStallsPerGame - before.meanFuelStallsPerGame,
  meanPassengerDeliveryShareDelta:
    after.meanPassengerDeliveryShare - before.meanPassengerDeliveryShare,
  meanGrandTourCompletionShareDelta:
    after.meanGrandTourCompletionShare - before.meanGrandTourCompletionShare,
  meanInvalidActionShareDelta:
    after.meanInvalidActionShare - before.meanInvalidActionShare,
  meanPassengerTransferMistakesPerGameDelta:
    after.meanPassengerTransferMistakesPerGame -
    before.meanPassengerTransferMistakesPerGame,
  totalCrashesDelta: after.totalCrashes - before.totalCrashes,
});

export const validateSeedSweepBaseline = (
  baseline: SeedSweepJsonReport,
  current: SeedSweepBaselineContext,
): void => {
  if (baseline.scenario !== current.scenario) {
    throw new Error(
      `Baseline scenario mismatch: expected ${current.scenario}, got ${baseline.scenario}.`,
    );
  }

  if (baseline.iterations !== current.iterations) {
    throw new Error(
      `Baseline iteration mismatch: expected ${current.iterations}, got ${baseline.iterations}.`,
    );
  }

  const currentSeeds = current.seeds.join(',');
  const baselineSeeds = baseline.seeds.join(',');

  if (baselineSeeds !== currentSeeds) {
    throw new Error(
      `Baseline seed mismatch: expected [${currentSeeds}], got [${baselineSeeds}].`,
    );
  }
};

const parseSeedSweepJsonReport = (raw: string): SeedSweepJsonReport => {
  let parsed: Partial<SeedSweepJsonReport>;

  try {
    parsed = JSON.parse(raw) as Partial<SeedSweepJsonReport>;
  } catch {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error('Baseline JSON is not valid JSON.');
    }

    parsed = JSON.parse(
      raw.slice(jsonStart, jsonEnd + 1),
    ) as Partial<SeedSweepJsonReport>;
  }

  if (
    typeof parsed.scenario !== 'string' ||
    typeof parsed.iterations !== 'number' ||
    !Array.isArray(parsed.seeds) ||
    typeof parsed.summary !== 'object' ||
    parsed.summary === null
  ) {
    throw new Error('Baseline JSON is not a seed-sweep JSON report.');
  }

  return parsed as SeedSweepJsonReport;
};

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
  let baselineJsonPath: string | null = null;

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
      case '--baseline-json':
        baselineJsonPath = args[++i] ?? '';
        if (baselineJsonPath.length === 0) {
          throw new Error('--baseline-json requires a path');
        }
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

  const rows: SeedSweepRow[] = [];

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
    const summary = summarizeSeedSweepRows(rows);
    const baseline =
      baselineJsonPath === null
        ? null
        : parseSeedSweepJsonReport(await readFile(baselineJsonPath, 'utf8'));
    if (baseline !== null) {
      validateSeedSweepBaseline(baseline, { scenario, iterations, seeds });
    }
    const comparison =
      baseline === null
        ? null
        : compareSeedSweepSummaries(baseline.summary, summary);

    console.log(
      JSON.stringify(
        {
          scenario,
          iterations,
          seeds,
          summary,
          ...(baseline !== null
            ? {
                baseline: {
                  scenario: baseline.scenario,
                  iterations: baseline.iterations,
                  seeds: baseline.seeds,
                },
                comparison,
              }
            : {}),
          rows: rows.map((r) => ({
            baseSeed: r.baseSeed,
            totalGames: r.totalGames,
            player0Wins: r.player0Wins,
            player1Wins: r.player1Wins,
            draws: r.draws,
            crashes: r.crashes,
            p0DecidedPct: r.p0DecidedPct,
            avgTurns: r.avgTurns,
            scorecard: r.scorecard,
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
    'obj%'.padStart(8) +
    'elim%'.padStart(8) +
    'timeout%'.padStart(10) +
    'stall/g'.padStart(10) +
    'avgTurn'.padStart(10) +
    'crash'.padStart(8);
  console.log(`\n${scenario} × ${iterations} games per base seed\n${hdr}`);
  console.log('-'.repeat(hdr.length));

  for (const r of rows) {
    const p0DecidedCell =
      r.p0DecidedPct !== null ? r.p0DecidedPct.toFixed(1) : '—';
    console.log(
      String(r.baseSeed >>> 0).padEnd(12) +
        p0DecidedCell.padStart(10) +
        `${(r.scorecard.objectiveShare * 100).toFixed(1)}%`.padStart(8) +
        `${(r.scorecard.fleetEliminationShare * 100).toFixed(1)}%`.padStart(8) +
        `${(r.scorecard.timeoutShare * 100).toFixed(1)}%`.padStart(10) +
        r.scorecard.fuelStallsPerGame.toFixed(1).padStart(10) +
        r.avgTurns.toFixed(1).padStart(10) +
        String(r.crashes).padStart(8),
    );
  }

  console.log(
    '\n`p0/dec%` is Player 0 wins divided by decided games (wins only, no draws).',
  );
  console.log(
    '`obj%`, `elim%`, `timeout%`, and `stall/g` come from the scenario scorecard.',
  );

  const summary = summarizeSeedSweepRows(rows);
  const baseline =
    baselineJsonPath === null
      ? null
      : parseSeedSweepJsonReport(await readFile(baselineJsonPath, 'utf8'));
  if (baseline !== null) {
    validateSeedSweepBaseline(baseline, { scenario, iterations, seeds });
  }
  const comparison =
    baseline === null
      ? null
      : compareSeedSweepSummaries(baseline.summary, summary);

  console.log(
    `\nAcross ${summary.seedCount} base seeds: avg turns mean ${summary.avgTurnsMean.toFixed(1)} (min ${summary.avgTurnsMin.toFixed(1)}, max ${summary.avgTurnsMax.toFixed(1)})` +
      (summary.meanP0DecidedPct !== null
        ? `; mean P0/decided ${summary.meanP0DecidedPct.toFixed(1)}%`
        : '') +
      `; mean objective ${(summary.meanObjectiveShare * 100).toFixed(1)}%` +
      `; mean elimination ${(summary.meanFleetEliminationShare * 100).toFixed(1)}%` +
      `; mean stalls/game ${summary.meanFuelStallsPerGame.toFixed(1)}`,
  );

  if (comparison !== null) {
    console.log(
      `Delta vs baseline: objective ${formatPctPointDelta(comparison.meanObjectiveShareDelta)}` +
        `; elimination ${formatPctPointDelta(comparison.meanFleetEliminationShareDelta)}` +
        `; timeout ${formatPctPointDelta(comparison.meanTimeoutShareDelta)}` +
        `; stalls/game ${formatSignedFixed(comparison.meanFuelStallsPerGameDelta, 1)}` +
        `; avg turns ${formatSignedFixed(comparison.avgTurnsMeanDelta, 1)}`,
    );
  }

  if (summary.totalCrashes > 0) {
    console.error(`\nEngine crashes (non-zero): ${summary.totalCrashes}`);
    process.exitCode = 1;
  }
};

const formatSignedFixed = (value: number, fractionDigits: number): string => {
  const formatted = value.toFixed(fractionDigits);
  return value > 0 ? `+${formatted}` : formatted;
};

const formatPctPointDelta = (value: number): string =>
  `${formatSignedFixed(value * 100, 1)}pp`;

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
