/**
 * Sweep the passenger-escort lookahead's difficulty-aware RNG bias to find
 * a triple that makes each difficulty's posture measurably different on the
 * current engine + scoring tables.
 *
 * What it does: for every {easy, normal, hard} bias triple in the explicit
 * grid below, overrides the constants in `src/shared/ai/astrogation.ts`
 * (via `__setLookaheadBiasForSweep`) and runs each matchup on a
 * passenger-objective scenario (the only place the lookahead actually
 * fires). Duel is a pure combat scenario and is untouched by the bias —
 * sweeping there produces identical results for every triple.
 *
 * Matchups:
 *   - hard vs normal  (how confidently does hard beat normal?)
 *   - normal vs easy  (how confidently does normal beat easy?)
 *   - hard vs easy    (ceiling check — should be one-sided)
 *
 * Picks the triple that (a) keeps hard's win-rate vs normal >= 55%,
 * (b) keeps normal's win-rate vs easy >= 55%, (c) maximises the mean of
 * the two. The scoring is deliberately simple — the sweep exists to
 * confirm the prior values aren't obviously wrong, not to micro-optimise.
 *
 * Usage:
 *   npx tsx scripts/ai-bias-sweep.ts
 *   npx tsx scripts/ai-bias-sweep.ts --iterations 20 --seeds 0,1,2,3
 *   npx tsx scripts/ai-bias-sweep.ts --scenario convoy
 */
import { pathToFileURL } from 'node:url';

import {
  __setLookaheadBiasForSweep,
  LOOKAHEAD_BIAS_BY_DIFFICULTY,
} from '../src/shared/ai/astrogation';
import type { AIDifficulty } from '../src/shared/ai/types';
import type { ScenarioKey } from '../src/shared/map-data';
import { runSimulation } from './simulate-ai';

interface BiasTriple {
  easy: number;
  normal: number;
  hard: number;
}

// Explicit candidate grid. Keeps easy < normal < hard by construction so
// the ordering doesn't invert under the sweep.
const CANDIDATES: BiasTriple[] = [
  { easy: 0.5, normal: 0.5, hard: 0.5 }, // control: no spread
  { easy: 0.45, normal: 0.5, hard: 0.55 }, // narrow
  { easy: 0.4, normal: 0.5, hard: 0.6 }, // current
  { easy: 0.35, normal: 0.5, hard: 0.65 }, // wide
  { easy: 0.3, normal: 0.5, hard: 0.7 }, // very wide
  { easy: 0.4, normal: 0.55, hard: 0.65 }, // shifted up
  { easy: 0.35, normal: 0.45, hard: 0.6 }, // shifted down
];

const runMatchup = async (
  scenario: ScenarioKey,
  p0Diff: AIDifficulty,
  p1Diff: AIDifficulty,
  iterations: number,
  seeds: number[],
): Promise<{ p0Wins: number; decided: number; totalTurns: number }> => {
  let p0Wins = 0;
  let decided = 0;
  let totalTurns = 0;
  for (const baseSeed of seeds) {
    const metrics = await runSimulation(scenario, iterations, {
      p0Diff,
      p1Diff,
      randomizeStart: false,
      forcedStart: null,
      baseSeed,
      quiet: true,
      json: false,
    });
    p0Wins += metrics.player0Wins;
    decided += metrics.player0Wins + metrics.player1Wins;
    totalTurns += metrics.totalTurns;
  }
  return { p0Wins, decided, totalTurns };
};

const fmt = (n: number, digits = 1): string =>
  Number.isFinite(n) ? n.toFixed(digits) : '—';

const main = async () => {
  const args = process.argv.slice(2);
  let iterations = 15;
  let seeds = [0, 1, 2, 3];
  // escape is a passenger-objective scenario (the lookahead only fires
  // when the AI is running the passenger fleet). Override via --scenario.
  let scenario: ScenarioKey = 'escape';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--iterations' || a === '-n') {
      iterations = Number.parseInt(args[++i] ?? '', 10) || iterations;
    } else if (a === '--seeds') {
      seeds =
        (args[++i] ?? '')
          .split(',')
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n)) || seeds;
    } else if (a === '--scenario') {
      scenario = (args[++i] ?? 'escape') as ScenarioKey;
    }
  }

  const gamesPerTriple = iterations * seeds.length * 3; // hard×normal, normal×easy, hard×easy
  console.log(
    `Sweeping ${CANDIDATES.length} bias triples on ${scenario}; ${gamesPerTriple} games each.`,
  );
  console.log(
    `current in-source: easy=${LOOKAHEAD_BIAS_BY_DIFFICULTY.easy}, normal=${LOOKAHEAD_BIAS_BY_DIFFICULTY.normal}, hard=${LOOKAHEAD_BIAS_BY_DIFFICULTY.hard}`,
  );
  console.log('');

  const rows: Array<{
    triple: BiasTriple;
    hardVsNormal: number;
    normalVsEasy: number;
    hardVsEasy: number;
    avgTurns: number;
  }> = [];

  for (const triple of CANDIDATES) {
    __setLookaheadBiasForSweep(triple);

    const hn = await runMatchup(scenario, 'hard', 'normal', iterations, seeds);
    const ne = await runMatchup(scenario, 'normal', 'easy', iterations, seeds);
    const he = await runMatchup(scenario, 'hard', 'easy', iterations, seeds);

    const totalDecided = hn.decided + ne.decided + he.decided;
    const totalGames = iterations * seeds.length * 3;
    const avgTurns =
      totalGames > 0
        ? (hn.totalTurns + ne.totalTurns + he.totalTurns) / totalGames
        : 0;
    const row = {
      triple,
      hardVsNormal: hn.decided > 0 ? hn.p0Wins / hn.decided : 0,
      normalVsEasy: ne.decided > 0 ? ne.p0Wins / ne.decided : 0,
      hardVsEasy: he.decided > 0 ? he.p0Wins / he.decided : 0,
      avgTurns,
    };
    rows.push(row);
    console.log(
      `e=${triple.easy} n=${triple.normal} h=${triple.hard}  ` +
        `H>N=${fmt(row.hardVsNormal * 100)}%  ` +
        `N>E=${fmt(row.normalVsEasy * 100)}%  ` +
        `H>E=${fmt(row.hardVsEasy * 100)}%  ` +
        `avgTurns=${fmt(avgTurns)}  ` +
        `decided=${totalDecided}/${totalGames}`,
    );
  }

  console.log('');
  const meets = rows.filter(
    (r) => r.hardVsNormal >= 0.55 && r.normalVsEasy >= 0.55,
  );
  const best =
    meets.length > 0
      ? meets.reduce((a, b) =>
          (a.hardVsNormal + a.normalVsEasy) / 2 >
          (b.hardVsNormal + b.normalVsEasy) / 2
            ? a
            : b,
        )
      : rows.reduce((a, b) =>
          (a.hardVsNormal + a.normalVsEasy) / 2 >
          (b.hardVsNormal + b.normalVsEasy) / 2
            ? a
            : b,
        );

  console.log(
    `best triple: easy=${best.triple.easy} normal=${best.triple.normal} hard=${best.triple.hard}`,
  );
  console.log(
    `  H>N=${fmt(best.hardVsNormal * 100)}%  N>E=${fmt(best.normalVsEasy * 100)}%  H>E=${fmt(best.hardVsEasy * 100)}%  avgTurns=${fmt(best.avgTurns)}`,
  );
  if (meets.length === 0) {
    console.log(
      '\nNone of the tested triples met the 55% separation bar. Consider widening the grid or investigating scoring weights first.',
    );
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
