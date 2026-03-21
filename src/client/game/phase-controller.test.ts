import { describe, expect, it, vi } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import type { ClientState } from './phase';
import {
  type PhaseControllerDeps,
  transitionClientPhase,
} from './phase-controller';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  landed: false,
  destroyed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createPlayers = (): [PlayerState, PlayerState] => [
  {
    connected: true,
    ready: true,
    targetBody: 'Mars',
    homeBody: 'Terra',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: 'Terra',
    homeBody: 'Mars',
    bases: [],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'PHASE',
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 2,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: 'enemy', owner: 1 })],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  winner: null,
  winReason: null,
  ...overrides,
});

const createDeps = (
  overrides: Partial<PhaseControllerDeps> = {},
): {
  deps: PhaseControllerDeps;
  setState: ReturnType<typeof vi.fn<(state: ClientState) => void>>;
  beginCombat: ReturnType<typeof vi.fn<() => void>>;
  runLocalAI: ReturnType<typeof vi.fn<() => void>>;
  onTurnLogged: ReturnType<
    typeof vi.fn<
      (
        turnNumber: number,
        context: { scenario: string; isLocalGame: boolean },
      ) => void
    >
  >;
  logTurn: ReturnType<
    typeof vi.fn<(turnNumber: number, playerLabel: string) => void>
  >;
  playPhaseSound: ReturnType<typeof vi.fn<() => void>>;
} => {
  const setState = vi.fn<(state: ClientState) => void>();
  const beginCombat = vi.fn<() => void>();
  const runLocalAI = vi.fn<() => void>();
  const onTurnLogged =
    vi.fn<
      (
        turnNumber: number,
        context: { scenario: string; isLocalGame: boolean },
      ) => void
    >();
  const logTurn = vi.fn<(turnNumber: number, playerLabel: string) => void>();
  const playPhaseSound = vi.fn<() => void>();

  const deps: PhaseControllerDeps = {
    gameState: createState(),
    playerId: 0,
    lastLoggedTurn: -1,
    isLocalGame: false,
    scenario: 'biplanetary',
    onTurnLogged,
    logTurn,
    beginCombat,
    setState,
    runLocalAI,
    playPhaseSound,
    ...overrides,
  };

  return {
    deps,
    setState,
    beginCombat,
    runLocalAI,
    onTurnLogged,
    logTurn,
    playPhaseSound,
  };
};

describe('transitionClientPhase', () => {
  it('logs a new turn, sets the next state, and plays the phase sound', () => {
    const controller = createDeps({
      gameState: createState({ phase: 'astrogation', activePlayer: 0 }),
    });

    transitionClientPhase(controller.deps);

    expect(controller.onTurnLogged).toHaveBeenCalledWith(2, {
      scenario: 'biplanetary',
      isLocalGame: false,
    });
    expect(controller.logTurn).toHaveBeenCalledWith(2, 'You');
    expect(controller.setState).toHaveBeenCalledWith('playing_astrogation');
    expect(controller.playPhaseSound).toHaveBeenCalledTimes(1);
    expect(controller.runLocalAI).not.toHaveBeenCalled();
  });

  it('begins combat immediately when asteroid hazards are pending', () => {
    const controller = createDeps({
      gameState: createState({
        phase: 'combat',
        activePlayer: 0,
        pendingAsteroidHazards: [{ shipId: 'ship-0', hex: { q: 1, r: 1 } }],
      }),
      lastLoggedTurn: 2,
    });

    transitionClientPhase(controller.deps);

    expect(controller.beginCombat).toHaveBeenCalledTimes(1);
    expect(controller.setState).not.toHaveBeenCalled();
    expect(controller.playPhaseSound).not.toHaveBeenCalled();
  });

  it('runs the AI when local play transitions to the opponent turn', () => {
    const controller = createDeps({
      gameState: createState({ phase: 'ordnance', activePlayer: 1 }),
      isLocalGame: true,
      lastLoggedTurn: 2,
    });

    transitionClientPhase(controller.deps);

    expect(controller.setState).toHaveBeenCalledWith('playing_opponentTurn');
    expect(controller.runLocalAI).toHaveBeenCalledTimes(1);
    expect(controller.playPhaseSound).not.toHaveBeenCalled();
  });

  it('does nothing when no playable game state is available', () => {
    const controller = createDeps({ gameState: null });

    transitionClientPhase(controller.deps);

    expect(controller.onTurnLogged).not.toHaveBeenCalled();
    expect(controller.setState).not.toHaveBeenCalled();
    expect(controller.beginCombat).not.toHaveBeenCalled();
  });

  it('does nothing once the game is over', () => {
    const controller = createDeps({
      gameState: createState({ phase: 'gameOver', winner: 0 }),
    });

    transitionClientPhase(controller.deps);

    expect(controller.onTurnLogged).not.toHaveBeenCalled();
    expect(controller.setState).not.toHaveBeenCalled();
    expect(controller.beginCombat).not.toHaveBeenCalled();
  });
});
