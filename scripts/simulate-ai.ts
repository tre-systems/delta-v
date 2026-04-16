import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIFleetPurchases,
} from '../src/shared/ai';
import {
  beginCombatPhase,
  createGame,
  processAstrogation,
  processCombat,
  processFleetReady,
  processLogistics,
  processOrdnance,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../src/shared/engine/game-engine';
import { asGameId } from '../src/shared/ids';
import type { ScenarioKey } from '../src/shared/map-data';
import {
  buildSolarSystemMap,
  findBaseHex,
  isValidScenario,
  SCENARIOS,
} from '../src/shared/map-data';
import { mulberry32 } from '../src/shared/prng';
import type { GameState, PlayerId } from '../src/shared/types';

interface SimulationMetrics {
  scenario: string;
  totalGames: number;
  player0Wins: number;
  player1Wins: number;
  draws: number;
  totalTurns: number;
  crashes: number; // Internal engine errors during simulation
  crashSeeds: number[];
  reasons: Record<string, number>;
}

interface SimulationOptions {
  p0Diff: AIDifficulty;
  p1Diff: AIDifficulty;
  randomizeStart: boolean;
  forcedStart: PlayerId | null;
  baseSeed: number;
  json: boolean;
}

// Per-scenario P0 decided-game rate thresholds (min, max).
// Decided games = total minus draws/timeouts.
// null = skip balance check (cooperative/race scenarios).
const BALANCE_THRESHOLDS: Record<string, [number, number] | null> = {
  biplanetary: [0.45, 0.85], // Mars→Venus has nav advantage
  escape: [0.0, 0.7], // Asymmetric — enforcers favored after moral victory tightening
  convoy: [0.3, 0.7], // Asymmetric escort
  evacuation: [0.0, 0.5], // Asymmetric sprint — corsair heavily favored in AI vs AI
  duel: [0.3, 0.7], // Symmetric combat (harness randomizes starting seat)
  blockade: [0.25, 0.65], // Asymmetric speed vs combat
  interplanetaryWar: [0.3, 0.7], // Equal credits, different bases
  fleetAction: [0.45, 0.8], // Mars has nav advantage
  grandTour: null, // Cooperative race
};

// Symmetric fleet-building scenarios where the starting player
// should be randomized to cancel first-mover advantage.
const RANDOMIZE_START_SCENARIOS: ReadonlySet<string> = new Set([
  // Symmetric starts: cancel fixed scenario.startingPlayer so P0/P1 balance
  // checks are not dominated by first-mover effects at low iteration counts.
  'duel',
  'interplanetaryWar',
  'fleetAction',
]);

const parseDifficulty = (value: string): AIDifficulty => {
  if (value === 'easy' || value === 'normal' || value === 'hard') {
    return value;
  }

  throw new Error(
    `Invalid difficulty "${value}" (expected easy, normal, or hard)`,
  );
};

const deriveGameSeed = (baseSeed: number, gameIndex: number): number =>
  (baseSeed + Math.imul(gameIndex + 1, 0x9e3779b9)) | 0;

const runSingleGame = async (
  scenarioName: ScenarioKey,
  p0Diff: AIDifficulty,
  p1Diff: AIDifficulty,
  {
    randomizeStart,
    forcedStart,
    gameSeed,
  }: {
    randomizeStart: boolean;
    forcedStart: PlayerId | null;
    gameSeed: number;
  },
) => {
  const scenario = SCENARIOS[scenarioName];

  const map = buildSolarSystemMap();
  const rng = mulberry32(gameSeed);

  const createResult = createGame(
    scenario,
    map,
    asGameId(`sim-${scenarioName}-${gameSeed >>> 0}`),
    findBaseHex,
    rng,
    scenarioName,
  );

  if (!createResult.ok) {
    throw new Error(`Failed to create game: ${createResult.error.message}`);
  }

  let state: GameState = createResult.value;

  // Randomize starting player to cancel out first-mover bias
  // across many games. Reveals true faction/position balance.
  if (forcedStart !== null) {
    state.activePlayer = forcedStart;
  } else if (randomizeStart || RANDOMIZE_START_SCENARIOS.has(scenarioName)) {
    state.activePlayer = rng() < 0.5 ? 0 : 1;
  }

  // Handle fleet building phase (both players submit simultaneously)
  if (state.phase === 'fleetBuilding') {
    for (const p of [0, 1] as PlayerId[]) {
      const diff = p === 0 ? p0Diff : p1Diff;
      const purchases = buildAIFleetPurchases(
        state,
        p,
        diff,
        scenario.availableFleetPurchases,
      );
      const result = processFleetReady(state, p, purchases, map);
      if ('error' in result)
        throw new Error(`Fleet build error P${p}: ${result.error}`);
      state = result.state;
    }
  }

  let phaseLimit = 1000; // allow for long games traversing the system

  while (state.phase !== 'gameOver' && phaseLimit > 0) {
    const activePlayer = state.activePlayer;
    const difficulty = activePlayer === 0 ? p0Diff : p1Diff;

    try {
      if (state.phase === 'astrogation') {
        const orders = aiAstrogation(state, activePlayer, map, difficulty, rng);
        const result = processAstrogation(
          state,
          activePlayer,
          orders,
          map,
          rng,
        );
        if ('error' in result)
          throw new Error(`Astrogation Error: ${result.error}`);
        state = result.state;
      } else if (state.phase === 'ordnance') {
        const launches = aiOrdnance(state, activePlayer, map, difficulty, rng);

        if (launches.length > 0) {
          const result = processOrdnance(
            state,
            activePlayer,
            launches,
            map,
            rng,
          );
          if ('error' in result) {
            throw new Error(`Ordnance Error: ${result.error}`);
          }
          state = result.state;
        } else {
          const result = skipOrdnance(state, activePlayer, map, rng);
          if ('error' in result) {
            throw new Error(`Ordnance Error: ${result.error}`);
          }
          state = result.state;
        }
      } else if (state.phase === 'logistics') {
        const transfers = aiLogistics(state, activePlayer, map, difficulty);
        const result =
          transfers.length > 0
            ? processLogistics(state, activePlayer, transfers, map)
            : skipLogistics(state, activePlayer, map);
        if ('error' in result)
          throw new Error(`Logistics Error: ${result.error}`);
        state = result.state;
      } else if (state.phase === 'combat') {
        // Evaluate pre-combat (asteroid hazards)
        const preResult = beginCombatPhase(state, activePlayer, map, rng);
        if ('error' in preResult)
          throw new Error(`Begin Combat Error: ${preResult.error}`);
        state = preResult.state;

        if (state.phase === 'combat') {
          const attacks = aiCombat(state, activePlayer, map, difficulty);

          if (attacks.length > 0) {
            const result = processCombat(
              state,
              activePlayer,
              attacks,
              map,
              rng,
            );
            if ('error' in result)
              throw new Error(`Combat Error: ${result.error}`);
            state = result.state;
          } else {
            const result = skipCombat(state, activePlayer, map, rng);
            if ('error' in result)
              throw new Error(`Combat Error: ${result.error}`);
            state = result.state;
          }
        }
      }
    } catch (err: unknown) {
      console.error(
        `Simulation crashed on turn ${state.turnNumber}, phase ${state.phase}. Error:`,
        err,
      );
      throw err;
    }

    phaseLimit--;
  }

  if (phaseLimit <= 0) {
    return { winner: null, turns: state.turnNumber, reason: 'timeout' };
  }

  return {
    winner: state.outcome?.winner ?? null,
    turns: state.turnNumber,
    reason: state.outcome?.reason ?? null,
  };
};

const runSimulation = async (
  scenarioName: ScenarioKey,
  iterations: number,
  options: SimulationOptions,
) => {
  console.log(
    `\n=== Starting Simulation: ${scenarioName} (${iterations} iterations, ` +
      `P0=${options.p0Diff}, P1=${options.p1Diff}, seed=${options.baseSeed}` +
      `${options.forcedStart !== null ? `, forcedStart=${options.forcedStart}` : ''}` +
      `${options.randomizeStart ? ', randomizeStart=true' : ''}) ===\n`,
  );

  const metrics: SimulationMetrics = {
    scenario: scenarioName,
    totalGames: 0,
    player0Wins: 0,
    player1Wins: 0,
    draws: 0,
    totalTurns: 0,
    crashes: 0,
    crashSeeds: [],
    reasons: {},
  };

  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    const gameSeed = deriveGameSeed(options.baseSeed, i);

    try {
      const result = await runSingleGame(
        scenarioName,
        options.p0Diff,
        options.p1Diff,
        {
          randomizeStart: options.randomizeStart,
          forcedStart: options.forcedStart,
          gameSeed,
        },
      );
      metrics.totalGames++;
      metrics.totalTurns += result.turns;

      if (result.winner === 0) metrics.player0Wins++;
      else if (result.winner === 1) metrics.player1Wins++;
      else metrics.draws++;

      const reason = result.reason || 'unknown';
      metrics.reasons[reason] = (metrics.reasons[reason] || 0) + 1;

      // Print progress
      if ((i + 1) % Math.max(1, Math.floor(iterations / 10)) === 0) {
        process.stdout.write('.');
      }
    } catch (_err) {
      metrics.crashes++;
      if (metrics.crashSeeds.length < 5) {
        metrics.crashSeeds.push(gameSeed >>> 0);
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`\n\n=== Simulation Complete in ${duration}ms ===`);
  console.log(`Total Games: ${metrics.totalGames}`);
  console.log(
    `Player 0 Wins: ${metrics.player0Wins} (${((metrics.player0Wins / metrics.totalGames) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Player 1 Wins: ${metrics.player1Wins} (${((metrics.player1Wins / metrics.totalGames) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Draws/Timeouts: ${metrics.draws} (${((metrics.draws / metrics.totalGames) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Average Turns: ${(metrics.totalTurns / metrics.totalGames).toFixed(1)}`,
  );
  console.log(`Engine Crashes: ${metrics.crashes}`);
  if (metrics.crashSeeds.length > 0) {
    console.log(`Crash Seeds: ${metrics.crashSeeds.join(', ')}`);
  }

  console.log(`\nWin Reasons:`);
  for (const [reason, count] of Object.entries(metrics.reasons)) {
    console.log(`  - ${reason}: ${count}`);
  }

  return metrics;
};

const main = async () => {
  const args = process.argv.slice(2);
  let isCiMode = false;
  const options: SimulationOptions = {
    p0Diff: 'hard',
    p1Diff: 'hard',
    randomizeStart: false,
    forcedStart: null,
    baseSeed: Date.now() | 0,
    json: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--ci':
        isCiMode = true;
        break;
      case '--randomize-start':
        options.randomizeStart = true;
        break;
      case '--p0':
        options.p0Diff = parseDifficulty(args[++i] ?? '');
        break;
      case '--p1':
        options.p1Diff = parseDifficulty(args[++i] ?? '');
        break;
      case '--seed':
        options.baseSeed = Number.parseInt(args[++i] ?? '', 10) | 0;
        break;
      case '--forced-start': {
        const value = args[++i];

        if (value !== '0' && value !== '1') {
          throw new Error(`Invalid forced start "${value}" (expected 0 or 1)`);
        }
        options.forcedStart = Number.parseInt(value, 10) as PlayerId;
        break;
      }
      case '--json':
        options.json = true;
        break;
      default:
        positionals.push(arg);
        break;
    }
  }

  const scenarioArg = positionals[0] || 'biplanetary';
  const iterations = parseInt(positionals[1] || '100', 10);

  const allMetrics: SimulationMetrics[] = [];

  if (scenarioArg === 'all') {
    for (const key of Object.keys(SCENARIOS)) {
      if (!isValidScenario(key)) continue;
      allMetrics.push(await runSimulation(key, iterations, options));
    }
  } else if (isValidScenario(scenarioArg)) {
    allMetrics.push(await runSimulation(scenarioArg, iterations, options));
  } else {
    console.error(`Unknown scenario: ${scenarioArg}`);
    process.exit(1);
  }

  // Evaluate strict constraints if running in CI format
  if (isCiMode) {
    let failed = false;
    let balanceWarnings = 0;
    for (const metrics of allMetrics) {
      if (metrics.crashes > 0) {
        console.error(
          `❌ CI FAILURE: ${metrics.scenario} — Engine crashed ${metrics.crashes} times.`,
        );
        failed = true;
      }

      const threshold = BALANCE_THRESHOLDS[metrics.scenario];
      if (!threshold) continue;

      const decidedGames = metrics.player0Wins + metrics.player1Wins;
      if (decidedGames < 5) continue;

      const p0Rate = metrics.player0Wins / decidedGames;
      const [lo, hi] = threshold;
      if (p0Rate < lo || p0Rate > hi) {
        balanceWarnings++;
        console.warn(
          `⚠️  ${metrics.scenario}: P0 decided rate ` +
            `${(p0Rate * 100).toFixed(1)}% outside ` +
            `[${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%]`,
        );
      }
    }

    if (failed) {
      console.error('\n🚨 CI Constraints Failed. Exiting with code 1.');
      process.exit(1);
    } else if (balanceWarnings > 0) {
      console.log(
        '\n✅ CI stability checks passed. Balance warnings above are non-fatal.',
      );
    } else {
      console.log('\n✅ CI Constraints Passed. Engine is stable and balanced.');
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          scenario: scenarioArg,
          iterations,
          options,
          metrics: allMetrics,
        },
        null,
        2,
      ),
    );
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
