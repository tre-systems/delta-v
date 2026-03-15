import { getSolarSystemMap, SCENARIOS, findBaseHex } from '../src/shared/map-data';
import { 
  createGame, 
  processAstrogation, 
  processOrdnance, 
  skipOrdnance, 
  beginCombatPhase, 
  processCombat, 
  skipCombat 
} from '../src/shared/game-engine';
import { aiAstrogation, aiOrdnance, aiCombat, AIDifficulty } from '../src/shared/ai';
import { GameState } from '../src/shared/types';

interface SimulationMetrics {
  totalGames: number;
  player0Wins: number;
  player1Wins: number;
  draws: number;
  totalTurns: number;
  crashes: number; // Internal engine errors during simulation
  reasons: Record<string, number>;
}

async function runSingleGame(scenarioName: string, p0Diff: AIDifficulty, p1Diff: AIDifficulty): Promise<{ winner: number | null, turns: number, reason: string | null }> {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);
  
  const map = getSolarSystemMap();
  
  // Create an RNG local to the game for reproducible behavior later if needed
  const rng = Math.random; 
  
  let state: GameState;
  try {
    state = createGame(scenario, map, `sim-${Date.now()}`, findBaseHex);
  } catch (err: any) {
    throw new Error(`Failed to create game: ${err.message}`);
  }

  let turnLimit = 200; // prevent absolute infinite loops

  while (state.phase !== 'gameOver' && turnLimit > 0) {
    const activePlayer = state.activePlayer;
    const difficulty = activePlayer === 0 ? p0Diff : p1Diff;

    try {
      if (state.phase === 'astrogation') {
        const orders = aiAstrogation(state, activePlayer, map, difficulty);
        const result = processAstrogation(state, activePlayer, orders, map, rng);
        if ('error' in result) throw new Error(`Astrogation Error: ${result.error}`);
        state = result.state;
      } 
      else if (state.phase === 'ordnance') {
        const launches = aiOrdnance(state, activePlayer, map, difficulty);
        let result;
        if (launches.length > 0) {
          result = processOrdnance(state, activePlayer, launches, map, rng);
        } else {
          result = skipOrdnance(state, activePlayer, map, rng);
        }
        if ('error' in result) throw new Error(`Ordnance Error: ${result.error}`);
        state = result.state;
      } 
      else if (state.phase === 'combat') {
        // Evaluate pre-combat (asteroid hazards)
        const preResult = beginCombatPhase(state, activePlayer, map, rng);
        if ('error' in preResult) throw new Error(`Begin Combat Error: ${preResult.error}`);
        state = preResult.state;

        if (state.phase === 'combat') {
          const attacks = aiCombat(state, activePlayer, map, difficulty);
          let result;
          if (attacks.length > 0) {
            result = processCombat(state, activePlayer, attacks, map, rng);
          } else {
            result = skipCombat(state, activePlayer, map, rng);
          }
          if ('error' in result) throw new Error(`Combat Error: ${result.error}`);
          state = result.state;
        }
      }
    } catch (err: any) {
      console.error(`Simulation crashed on turn ${state.turnNumber}, phase ${state.phase}. Error:`, err);
      throw err;
    }

    turnLimit--;
  }

  if (turnLimit <= 0) {
    return { winner: null, turns: state.turnNumber, reason: 'timeout' };
  }

  return { winner: state.winner, turns: state.turnNumber, reason: state.winReason };
}

async function runSimulation(scenarioName: string, iterations: number) {
  console.log(`\n=== Starting Simulation: ${scenarioName} (${iterations} iterations) ===\n`);
  
  const metrics: SimulationMetrics = {
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
      const result = await runSingleGame(scenarioName, 'hard', 'hard');
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
    } catch (err) {
      metrics.crashes++;
    }
  }

  const duration = Date.now() - startTime;
  console.log(`\n\n=== Simulation Complete in ${duration}ms ===`);
  console.log(`Total Games: ${metrics.totalGames}`);
  console.log(`Player 0 Wins: ${metrics.player0Wins} (${((metrics.player0Wins / metrics.totalGames) * 100).toFixed(1)}%)`);
  console.log(`Player 1 Wins: ${metrics.player1Wins} (${((metrics.player1Wins / metrics.totalGames) * 100).toFixed(1)}%)`);
  console.log(`Draws/Timeouts: ${metrics.draws} (${((metrics.draws / metrics.totalGames) * 100).toFixed(1)}%)`);
  console.log(`Average Turns: ${(metrics.totalTurns / metrics.totalGames).toFixed(1)}`);
  console.log(`Engine Crashes: ${metrics.crashes}`);
  
  console.log(`\nWin Reasons:`);
  for (const [reason, count] of Object.entries(metrics.reasons)) {
    console.log(`  - ${reason}: ${count}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scenario = args[0] || 'biplanetary';
  const iterations = parseInt(args[1] || '100', 10);
  
  if (scenario === 'all') {
    for (const key of Object.keys(SCENARIOS)) {
      await runSimulation(key, iterations);
    }
  } else {
    await runSimulation(scenario, iterations);
  }
}

main().catch(console.error);
