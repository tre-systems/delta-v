// Custom agent for Claude Code - picks recommended moves and generates tactical chat
interface AgentInput {
  version: number;
  gameCode: string;
  playerId: 0 | 1;
  state: {
    turnNumber: number;
    phase: string;
    activePlayer: 0 | 1;
    ships: Array<{
      id: string;
      type: string;
      owner: 0 | 1;
      lifecycle: string;
      fuel: number;
      damage: { disabledTurns: number };
    }>;
    outcome: { winner: 0 | 1 | null; reason: string } | null;
  };
  candidates: Array<{ type: string; [key: string]: unknown }>;
  recommendedIndex: number;
  summary?: string;
  legalActionInfo?: {
    phase: string;
    ownShips: Array<{ id: string; fuel: number; canAttack: boolean }>;
    enemies: Array<{ id: string; lifecycle: string }>;
  };
}

interface AgentOutput {
  candidateIndex: number;
  chat?: string;
}

const pickChat = (
  input: AgentInput,
  chosenAction: { type: string; [key: string]: unknown },
): string | undefined => {
  const { state, playerId } = input;
  const ownShips = state.ships.filter(
    (s) => s.owner === playerId && s.lifecycle !== 'destroyed',
  );
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );
  const turn = state.turnNumber;

  // Opening greeting
  if (turn <= 1 && state.phase === 'astrogation') {
    const greetings = [
      'Good luck, commander. May the best pilot win!',
      'o7 Ready to dance among the stars.',
      'All systems nominal. Engaging.',
      'Greetings! Prepare for some vector combat.',
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  // Fleet building
  if (chosenAction.type === 'fleetReady') {
    const lines = [
      'Fleet assembled. Time to see what you brought.',
      'Ships ready. This should be interesting.',
      'My fleet is prepped. Shall we begin?',
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Combat engagement
  if (chosenAction.type === 'combat') {
    if (Math.random() < 0.6) {
      const lines = [
        'Weapons hot! Engaging!',
        'Firing solution locked. Fox one!',
        'Target acquired, opening fire.',
        "You're in my crosshairs now.",
        'Guns free! Incoming!',
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    }
  }

  // Ordnance
  if (chosenAction.type === 'ordnance') {
    if (Math.random() < 0.5) {
      const lines = [
        'Ordnance away! Watch your six.',
        'Special delivery incoming.',
        'Torpedo in the void. Good luck dodging.',
        'Package deployed. Tick tock.',
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    }
  }

  // Astrogation - context-dependent
  if (chosenAction.type === 'astrogation') {
    if (Math.random() < 0.25) {
      if (ownShips.length > enemyShips.length) {
        return 'Pressing the advantage. Nowhere to run.';
      }
      if (ownShips.length < enemyShips.length) {
        return "I'm down but not out. Repositioning.";
      }
      const totalOwnFuel = ownShips.reduce((s, ship) => s + ship.fuel, 0);
      const totalEnemyFuel = enemyShips.reduce((s, ship) => s + ship.fuel, 0);
      if (totalOwnFuel > totalEnemyFuel + 3) {
        return 'I can keep this dance going longer than you.';
      }
      const lines = [
        'Adjusting trajectory. The geometry matters.',
        'Plotting intercept course.',
        'Burning to close the gap.',
        'Shaping the engagement envelope.',
        'Every hex counts in this game.',
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    }
  }

  // Skip phases
  if (
    chosenAction.type === 'skipCombat' ||
    chosenAction.type === 'skipOrdnance'
  ) {
    if (Math.random() < 0.2) {
      const lines = [
        'Holding fire. Patience wins battles.',
        'Not yet... waiting for the right moment.',
        'Standing by.',
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    }
  }

  // Late game commentary
  if (turn > 8 && Math.random() < 0.15) {
    if (ownShips.length > enemyShips.length) {
      return 'The tide is turning. GG soon?';
    }
    if (enemyShips.length > ownShips.length) {
      return 'Good flying. You have me on the ropes.';
    }
    return 'Close match! This could go either way.';
  }

  // Game over
  if (state.phase === 'gameOver' && state.outcome) {
    if (state.outcome.winner === playerId) {
      return 'GG! Well fought, commander.';
    }
    if (state.outcome.winner === null) {
      return 'GG! A draw - evenly matched.';
    }
    return 'GG! You outflew me. Well played.';
  }

  return undefined;
};

const main = async (): Promise<void> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }

  const raw = chunks.join('').trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  let input: AgentInput;
  try {
    input = JSON.parse(raw) as AgentInput;
  } catch {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  // Pick the recommended candidate (hard difficulty, best move)
  const candidateIndex =
    typeof input.recommendedIndex === 'number' &&
    Number.isInteger(input.recommendedIndex) &&
    input.recommendedIndex >= 0 &&
    input.recommendedIndex < input.candidates.length
      ? input.recommendedIndex
      : 0;

  const chosenAction = input.candidates[candidateIndex];
  const chat = pickChat(input, chosenAction);

  const output: AgentOutput = { candidateIndex };
  if (chat) output.chat = chat;

  process.stdout.write(JSON.stringify(output));
};

void main().catch(() => {
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});

export {};
