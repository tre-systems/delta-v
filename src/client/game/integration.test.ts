import { describe, expect, it } from 'vitest';

import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  Ship,
  ShipMovement,
} from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from './message-handler';
import type { ClientState } from './phase';

// --- Helpers ---

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
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'INT',
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: 'enemy', owner: 1 })],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
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
  ],
  outcome: null,
  ...overrides,
});

const createDeps = (
  stateOverride: ClientState = 'connecting',
  gameState: GameState | null = null,
): MessageHandlerDeps & { calls: Record<string, unknown[][]> } => {
  const calls: Record<string, unknown[][]> = {};

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  return {
    ctx: {
      state: stateOverride,
      playerId: 0,
      gameCode: null,
      reconnectAttempts: 0,
      reconnectOverlayState: null,
      opponentDisconnectDeadlineMs: null,
      latencyMs: 0,
      gameState,
    },
    setState: track('setState'),
    applyGameState: track('applyGameState'),
    transitionToPhase: track('transitionToPhase'),
    presentMovementResult: track('presentMovementResult'),
    presentCombatResults: track('presentCombatResults'),
    showGameOverOutcome: track('showGameOverOutcome'),
    storePlayerToken: track('storePlayerToken'),
    resetTurnTelemetry: track('resetTurnTelemetry'),
    onAnimationComplete: track('onAnimationComplete'),
    logScenarioBriefing: track('logScenarioBriefing'),
    trackEvent: track('trackEvent'),
    deserializeState: (raw: GameState) => raw,
    renderer: {
      clearTrails: track('renderer.clearTrails'),
    },
    ui: {
      log: {
        logText: track('ui.log.logText'),
        setChatEnabled: track('ui.log.setChatEnabled'),
        clear: track('ui.log.clear'),
      },
      overlay: {
        showToast: track('ui.overlay.showToast'),
        showRematchPending: track('ui.overlay.showRematchPending'),
      },
    },
    calls,
  };
};

// --- Integration flows ---

describe('client integration: connection flow', () => {
  it('welcome sets player ID, stores token, and transitions to waiting', () => {
    const deps = createDeps('connecting');

    handleServerMessage(deps, {
      type: 'welcome',
      playerId: 0,
      code: 'ABCDE',
      playerToken: 'tok-123',
    });

    expect(deps.ctx.playerId).toBe(0);
    expect(deps.ctx.gameCode).toBe('ABCDE');
    expect(deps.calls.storePlayerToken).toEqual([['ABCDE', 'tok-123']]);
    expect(deps.calls.setState).toEqual([['waitingForOpponent']]);
    expect(deps.calls.trackEvent).toEqual([['join_game_succeeded', {}]]);
  });

  it('welcome during reconnect shows toast and clears reconnect count', () => {
    const deps = createDeps('playing_astrogation');
    deps.ctx.reconnectAttempts = 3;

    handleServerMessage(deps, {
      type: 'welcome',
      playerId: 0,
      code: 'ABCDE',
      playerToken: 'tok-456',
    });

    expect(deps.ctx.reconnectAttempts).toBe(0);
    expect(deps.ctx.reconnectOverlayState).toBeNull();
    expect(deps.calls['ui.overlay.showToast']).toEqual([
      ['Reconnected!', 'success'],
    ]);
    expect(deps.calls.trackEvent).toEqual([
      ['reconnect_succeeded', { attempts: 3 }],
    ]);
    // No state transition when already playing
    expect(deps.calls.setState).toBeUndefined();
  });

  it('gameStart applies state, clears UI, and transitions to playing', () => {
    const state = createState();
    const deps = createDeps('waitingForOpponent');

    handleServerMessage(deps, {
      type: 'gameStart',
      state,
    } as S2C);

    expect(deps.calls.resetTurnTelemetry).toHaveLength(1);
    expect(deps.calls.applyGameState).toEqual([[state]]);
    expect(deps.calls['renderer.clearTrails']).toHaveLength(1);
    expect(deps.calls['ui.log.clear']).toHaveLength(1);
    expect(deps.calls['ui.log.setChatEnabled']).toEqual([[true]]);
    expect(deps.calls.logScenarioBriefing).toHaveLength(1);
    expect(deps.calls.setState).toEqual([['playing_astrogation']]);
  });

  it('gameStart with fleet building transitions to fleet phase', () => {
    const state = createState({ phase: 'fleetBuilding' });
    const deps = createDeps('waitingForOpponent');

    handleServerMessage(deps, {
      type: 'gameStart',
      state,
    } as S2C);

    expect(deps.calls.setState).toEqual([['playing_fleetBuilding']]);
  });

  it('gameStart as non-active player transitions to opponent turn', () => {
    const state = createState({ activePlayer: 1 });
    const deps = createDeps('waitingForOpponent');

    handleServerMessage(deps, {
      type: 'gameStart',
      state,
    } as S2C);

    expect(deps.calls.setState).toEqual([['playing_opponentTurn']]);
  });

  it('tracks opponent disconnect state on the reactive session', () => {
    const deps = createDeps('playing_astrogation');

    handleServerMessage(deps, {
      type: 'opponentStatus',
      status: 'disconnected',
      graceDeadlineMs: 12345,
    });

    expect(deps.ctx.opponentDisconnectDeadlineMs).toBe(12345);

    handleServerMessage(deps, {
      type: 'opponentStatus',
      status: 'reconnected',
    });

    expect(deps.ctx.opponentDisconnectDeadlineMs).toBeNull();
    expect(deps.calls['ui.overlay.showToast']).toEqual([
      ['Opponent reconnected', 'info'],
    ]);
  });
});

describe('client integration: movement flow', () => {
  it('movement result triggers presentation with state and animation callback', () => {
    const state = createState({ phase: 'ordnance' });
    const movements: ShipMovement[] = [
      {
        shipId: 'ship-0',
        path: [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        newVelocity: { dq: 1, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'normal',
      },
    ];
    const ordnanceMovements: OrdnanceMovement[] = [];
    const events: MovementEvent[] = [];

    const deps = createDeps('playing_astrogation', createState());

    handleServerMessage(deps, {
      type: 'movementResult',
      state,
      movements,
      ordnanceMovements,
      events,
    });

    expect(deps.calls.presentMovementResult).toHaveLength(1);

    const args = deps.calls.presentMovementResult[0];
    expect(args[0]).toEqual(state);
    expect(args[1]).toEqual(movements);
    expect(args[2]).toEqual(ordnanceMovements);
    expect(args[3]).toEqual(events);
    // 5th arg is the callback
    expect(typeof args[4]).toBe('function');
  });

  it('movement animation callback triggers onAnimationComplete', () => {
    const deps = createDeps('playing_movementAnim', createState());

    handleServerMessage(deps, {
      type: 'movementResult',
      state: createState(),
      movements: [],
      ordnanceMovements: [],
      events: [],
    });

    // Invoke the animation complete callback
    const onComplete = deps.calls.presentMovementResult[0][4];
    (onComplete as () => void)();

    expect(deps.calls.onAnimationComplete).toHaveLength(1);
  });
});

describe('client integration: state update flow', () => {
  it('state update applies state and transitions to next phase', () => {
    const nextState = createState({
      phase: 'ordnance',
      activePlayer: 0,
    });
    const deps = createDeps('playing_astrogation', createState());

    handleServerMessage(deps, {
      type: 'stateUpdate',
      state: nextState,
    });

    expect(deps.calls.applyGameState).toEqual([[nextState]]);
    expect(deps.calls.transitionToPhase).toHaveLength(1);
  });

  it('state update during movement animation does not transition', () => {
    const nextState = createState({ phase: 'combat' });
    const deps = createDeps('playing_movementAnim', createState());

    handleServerMessage(deps, {
      type: 'stateUpdate',
      state: nextState,
    });

    expect(deps.calls.applyGameState).toEqual([[nextState]]);
    expect(deps.calls.transitionToPhase).toBeUndefined();
  });
});

describe('client integration: combat flow', () => {
  it('combat result presents results and transitions', () => {
    const prevState = createState({ phase: 'combat' });
    const nextState = createState({
      phase: 'astrogation',
      turnNumber: 2,
    });
    const results: CombatResult[] = [
      {
        attackerIds: ['ship-0'],
        targetId: 'enemy',
        targetType: 'ship',
        attackType: 'gun',
        odds: '3:1',
        attackStrength: 3,
        defendStrength: 1,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll: 5,
        modifiedRoll: 5,
        damageType: 'eliminated',
        disabledTurns: 0,
        counterattack: null,
      },
    ];

    const deps = createDeps('playing_combat', prevState);

    handleServerMessage(deps, {
      type: 'combatResult',
      state: nextState,
      results,
    });

    expect(deps.calls.presentCombatResults).toHaveLength(1);
    const args = deps.calls.presentCombatResults[0];
    expect(args[0]).toEqual(prevState);
    expect(args[1]).toEqual(nextState);
    expect(args[2]).toEqual(results);
    expect(deps.calls.transitionToPhase).toHaveLength(1);
  });
});

describe('client integration: game over flow', () => {
  it('gameOver shows outcome with win/loss', () => {
    const deps = createDeps('playing_combat', createState());

    handleServerMessage(deps, {
      type: 'gameOver',
      winner: 0,
      reason: 'Fleet eliminated!',
    });

    expect(deps.calls.showGameOverOutcome).toEqual([
      [true, 'Fleet eliminated!'],
    ]);
  });

  it('gameOver shows loss when opponent wins', () => {
    const deps = createDeps('playing_combat', createState());

    handleServerMessage(deps, {
      type: 'gameOver',
      winner: 1,
      reason: 'Fleet eliminated!',
    });

    expect(deps.calls.showGameOverOutcome).toEqual([
      [false, 'Fleet eliminated!'],
    ]);
  });

  it('disconnect forfeit arrives as normal game-over flow', () => {
    const state = createState();
    state.phase = 'gameOver';
    state.outcome = { winner: 0, reason: 'Opponent disconnected' };
    const deps = createDeps('playing_astrogation', createState());

    handleServerMessage(deps, {
      type: 'stateUpdate',
      state,
    } as S2C);

    handleServerMessage(deps, {
      type: 'gameOver',
      winner: 0,
      reason: 'Opponent disconnected',
    } as S2C);

    expect(deps.calls.showGameOverOutcome).toEqual([
      [true, 'Opponent disconnected'],
    ]);
  });
});

describe('client integration: chat and errors', () => {
  it('own chat message logs with "You" label', () => {
    const deps = createDeps('playing_astrogation', createState());
    deps.ctx.playerId = 0;

    handleServerMessage(deps, {
      type: 'chat',
      playerId: 0,
      text: 'hello',
    });

    expect(deps.calls['ui.log.logText']).toEqual([['You: hello', 'log-chat']]);
  });

  it('opponent chat message logs with "Opponent" label', () => {
    const deps = createDeps('playing_astrogation', createState());
    deps.ctx.playerId = 0;

    handleServerMessage(deps, {
      type: 'chat',
      playerId: 1,
      text: 'gg',
    });

    expect(deps.calls['ui.log.logText']).toEqual([
      ['Opponent: gg', 'log-chat-opponent'],
    ]);
  });

  it('server error shows toast', () => {
    const deps = createDeps('playing_astrogation', createState());

    handleServerMessage(deps, {
      type: 'error',
      message: 'Invalid action',
    });

    expect(deps.calls['ui.overlay.showToast']).toEqual([
      ['Invalid action', 'error'],
    ]);
  });

  it('rematch pending shows UI', () => {
    const deps = createDeps('gameOver', createState());

    handleServerMessage(deps, {
      type: 'rematchPending',
    } as S2C);

    expect(deps.calls['ui.overlay.showRematchPending']).toHaveLength(1);
  });
});

describe('client integration: latency tracking', () => {
  it('pong updates latency when timestamp is positive', () => {
    const deps = createDeps('playing_astrogation', createState());

    // Simulate: client sent ping at t=4900, server echoes back
    handleServerMessage(deps, { type: 'pong', t: 4900 });

    // Latency is computed as Date.now() - msg.t
    // We can't control Date.now() here but can verify
    expect(deps.ctx.latencyMs).toBeGreaterThan(0);
  });

  it('pong with zero timestamp does not update latency', () => {
    const deps = createDeps('playing_astrogation', createState());

    handleServerMessage(deps, { type: 'pong', t: 0 });

    expect(deps.ctx.latencyMs).toBe(0);
  });
});

describe('client integration: full connection-to-game sequence', () => {
  it('welcome → gameStart → stateUpdate flows through correctly', () => {
    const deps = createDeps('connecting');

    // Step 1: Welcome
    handleServerMessage(deps, {
      type: 'welcome',
      playerId: 0,
      code: 'GAME1',
      playerToken: 'tok-abc',
    });

    expect(deps.ctx.playerId).toBe(0);
    expect(deps.ctx.gameCode).toBe('GAME1');
    expect(deps.calls.setState).toEqual([['waitingForOpponent']]);

    // Update client state to reflect transition
    deps.ctx.state = 'waitingForOpponent';

    // Step 2: Game starts
    const gameState = createState();
    handleServerMessage(deps, {
      type: 'gameStart',
      state: gameState,
    } as S2C);

    expect(deps.calls.applyGameState).toEqual([[gameState]]);
    expect(deps.calls.setState).toEqual([
      ['waitingForOpponent'],
      ['playing_astrogation'],
    ]);

    // Update client state
    deps.ctx.state = 'playing_astrogation';
    deps.ctx.gameState = gameState;

    // Step 3: Opponent submits, we get state update
    const updatedState = createState({
      phase: 'ordnance',
      activePlayer: 0,
    });
    handleServerMessage(deps, {
      type: 'stateUpdate',
      state: updatedState,
    });

    expect(deps.calls.applyGameState).toEqual([[gameState], [updatedState]]);
    expect(deps.calls.transitionToPhase).toHaveLength(1);
  });
});

describe('local vs networked parity: movement resolution', () => {
  it('movement result triggers identical presentMovementResult args from both paths', () => {
    const state = createState({ phase: 'astrogation' });
    const movements: ShipMovement[] = [
      {
        shipId: 'ship-0',
        from: { q: 0, r: 0 },
        to: { q: 1, r: 0 },
        path: [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
        newVelocity: { dq: 1, dr: 0 },
        fuelSpent: 1,
        gravityEffects: [],
        outcome: 'normal',
      },
    ];
    const ordnanceMovements: OrdnanceMovement[] = [];
    const events: MovementEvent[] = [];

    // Networked path: capture presentMovementResult args
    const networkDeps = createDeps('playing_astrogation', state);
    handleServerMessage(networkDeps, {
      type: 'movementResult',
      state,
      movements,
      ordnanceMovements,
      events,
    });

    const networkCall = networkDeps.calls.presentMovementResult;
    expect(networkCall).toHaveLength(1);

    // Args should be: [state, movements, ordnanceMovements, events, onComplete]
    const [nState, nMov, nOrd, nEvt] = networkCall[0];
    expect(nState).toBe(state);
    expect(nMov).toBe(movements);
    expect(nOrd).toBe(ordnanceMovements);
    expect(nEvt).toBe(events);

    // The local path calls deps.presentMovementResult with the
    // same 5-arg signature via playLocalMovementResult in
    // local-game-flow.ts. Both converge on presentation.ts
    // presentMovementResult which is fully source-agnostic.
    // This test verifies the networked half; the local half
    // is verified by local.test.ts + local-game-flow.test.ts.
  });
});
