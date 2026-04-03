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
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../src/shared/map-data';
import type { GameState, PlayerId } from '../src/shared/types';

interface SimulationMetrics {
  scenario: string;
  totalGames: number;
  player0Wins: number;
  player1Wins: number;
  draws: number;
  totalTurns: number;
  crashes: number; // Internal engine errors during simulation
  reasons: Record<string, number>;
}

// Per-scenario P0 decided-game rate thresholds (min, max).
// Decided games = total minus draws/timeouts.
// null = skip balance check (cooperative/race scenarios).
const BALANCE_THRESHOLDS: Record<string, [number, number] | null> = {
  biplanetary: [0.45, 0.85], // Mars→Venus has nav advantage
  escape: [0.55, 0.9], // Asymmetric — fugitives favored
  convoy: [0.3, 0.7], // Asymmetric escort
  evacuation: null, // Asymmetric sprint — AI balance not representative of human play
  duel: [0.3, 0.7], // Symmetric combat
  blockade: [0.25, 0.65], // Asymmetric speed vs combat
  interplanetaryWar: [0.3, 0.7], // Equal credits, different bases
  fleetAction: [0.45, 0.8], // Mars has nav advantage
  grandTour: null, // Cooperative race
};

const runSingleGame = async (
  scenarioName: string,
  p0Diff: AIDifficulty,
  p1Diff: AIDifficulty,
  randomizeStart = false,
) => {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);

  const map = buildSolarSystemMap();

  // Create an RNG local to the game for reproducible behavior later if needed
  const rng = Math.random;

  const createResult = createGame(scenario, map, `sim-${Date.now()}`, findBaseHex);

  if (!createResult.ok) {
    throw new Error(`Failed to create game: ${createResult.error.message}`);
  }

  let state: GameState = createResult.value;

  // Randomize starting player to cancel out first-mover bias
  // across many games. Reveals true faction/position balance.
  if (randomizeStart) {
    state.activePlayer = rng() < 0.5 ? 0 : 1;
  }

  // Handle fleet building phase (both players submit simultaneously)
  if (state.phase === 'fleetBuilding') {
    const scenario = SCENARIOS[scenarioName];
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
        const orders = aiAstrogation(state, activePlayer, map, difficulty);
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
        const launches = aiOrdnance(state, activePlayer, map, difficulty);

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
  scenarioName: string,
  iterations: number,
  randomizeStart = false,
) => {
  console.log(
    `\n=== Starting Simulation: ${scenarioName} (${iterations} iterations) ===\n`,
  );

  const metrics: SimulationMetrics = {
    scenario: scenarioName,
    totalGames: 0,
    player0Wins: 0,
    player1Wins: 0,
    draws: 0,
    totalTurns: 0,
    crashes: 0,
    reasons: {},
  };

  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    try {
      const result = await runSingleGame(
        scenarioName,
        'hard',
        'hard',
        randomizeStart,
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

  console.log(`\nWin Reasons:`);
  for (const [reason, count] of Object.entries(metrics.reasons)) {
    console.log(`  - ${reason}: ${count}`);
  }

  return metrics;
};

const main = async () => {
  const args = process.argv.slice(2);
  const isCiMode = args.includes('--ci');
  const randomizeStart = args.includes('--randomize-start');
  const filteredArgs = args.filter(
    (a) => a !== '--ci' && a !== '--randomize-start',
  );

  const scenario = filteredArgs[0] || 'biplanetary';
  const iterations = parseInt(filteredArgs[1] || '100', 10);

  const allMetrics: SimulationMetrics[] = [];

  if (scenario === 'all') {
    for (const key of Object.keys(SCENARIOS)) {
      allMetrics.push(await runSimulation(key, iterations, randomizeStart));
    }
  } else {
    allMetrics.push(await runSimulation(scenario, iterations, randomizeStart));
  }

  // Evaluate strict constraints if running in CI format
  if (isCiMode) {
    let failed = false;
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
    } else {
      console.log('\n✅ CI Constraints Passed. Engine is stable and balanced.');
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
