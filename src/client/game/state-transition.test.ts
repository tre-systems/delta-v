import { describe, expect, it } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { effect } from '../reactive';
import { createPlanningStore } from './planning';
import { createInitialClientSession } from './session-model';
import {
  applyClientStateTransition,
  type StateTransitionDeps,
} from './state-transition';

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createGame(SCENARIOS.duel, buildSolarSystemMap(), 'STATE1', findBaseHex),
  phase: 'astrogation',
  activePlayer: 0,
  ...overrides,
});

const createDeps = (
  gameState: GameState,
): StateTransitionDeps & {
  calls: Record<string, unknown[][]>;
  logisticsState: unknown;
} => {
  const calls: Record<string, unknown[][]> = {};
  let logisticsState: unknown;

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  const deps: StateTransitionDeps & {
    calls: Record<string, unknown[][]>;
    logisticsState: unknown;
  } = {
    ctx: {
      state: 'menu',
      playerId: 0,
      gameCode: 'ABCDE',
      gameState,
      planningState: createPlanningStore(),
      isLocalGame: false,
    },
    ui: {
      showMenu: track('ui.showMenu'),
      showConnecting: track('ui.showConnecting'),
      showWaiting: track('ui.showWaiting'),
      showFleetBuilding: track('ui.showFleetBuilding'),
      showHUD: track('ui.showHUD'),
    },
    tutorial: {
      hideTip: track('tutorial.hideTip'),
      onPhaseChange: track('tutorial.onPhaseChange'),
    },
    renderer: {
      resetCamera: track('renderer.resetCamera'),
      frameOnShips: track('renderer.frameOnShips'),
    },
    turnTimer: {
      start: track('turnTimer.start'),
      stop: track('turnTimer.stop'),
    },
    onStateChanged: track('onStateChanged'),
    hideTooltip: track('hideTooltip'),
    resetCombatState: () => {
      deps.ctx.planningState.combatTargetId = null;
      deps.ctx.planningState.combatTargetType = null;
      deps.ctx.planningState.combatAttackerIds = [];
      deps.ctx.planningState.combatAttackStrength = null;
      deps.ctx.planningState.queuedAttacks = [];
      track('resetCombatState')();
    },
    autoSkipCombatIfNoTargets: track('autoSkipCombatIfNoTargets'),
    setLogisticsUIState: (state) => {
      logisticsState = state;
      deps.logisticsState = state;
      track('setLogisticsUIState')(state);
    },
    renderLogisticsPanel: track('renderLogisticsPanel'),
    calls,
    logisticsState,
  };

  return deps;
};

describe('applyClientStateTransition', () => {
  it('applies astrogation entry effects and clears planning state', () => {
    const state = createState();
    const deps = createDeps(state);

    deps.ctx.planningState.selectedShipId = 'old';
    deps.ctx.planningState.lastSelectedHex = '0,0';
    deps.ctx.planningState.burns.set('old', 1);
    deps.ctx.planningState.overloads.set('old', 2);
    deps.ctx.planningState.weakGravityChoices.set('old', { '0,1': true });

    applyClientStateTransition(deps, 'playing_astrogation');

    expect(deps.ctx.state).toBe('playing_astrogation');
    expect(deps.calls.onStateChanged).toEqual([
      ['menu', 'playing_astrogation'],
    ]);
    expect(deps.calls.hideTooltip).toHaveLength(1);
    expect(deps.calls['ui.showHUD']).toHaveLength(1);
    expect(deps.calls['turnTimer.start']).toHaveLength(1);
    expect(deps.calls['renderer.frameOnShips']).toHaveLength(1);
    expect(deps.calls['tutorial.onPhaseChange']).toEqual([
      ['astrogation', state.turnNumber],
    ]);

    expect(deps.ctx.planningState.selectedShipId).toBe(state.ships[0].id);
    expect(deps.ctx.planningState.lastSelectedHex).toBeNull();
    expect(deps.ctx.planningState.burns.size).toBe(0);
    expect(deps.ctx.planningState.overloads.size).toBe(0);
    expect(deps.ctx.planningState.weakGravityChoices.size).toBe(0);
    expect(deps.logisticsState).toBeNull();
  });

  it('initializes logistics UI state when entering logistics', () => {
    const state = createState({
      phase: 'logistics',
    });
    const deps = createDeps(state);

    applyClientStateTransition(deps, 'playing_logistics');

    expect(deps.ctx.state).toBe('playing_logistics');
    expect(deps.calls['ui.showHUD']).toHaveLength(1);
    expect(deps.calls['turnTimer.start']).toHaveLength(1);
    expect(deps.calls.renderLogisticsPanel).toHaveLength(1);
    expect(deps.logisticsState).not.toBeNull();
    expect(deps.calls['tutorial.onPhaseChange']).toBeUndefined();
  });

  it('applies default ordnance selection on entry', () => {
    const baseState = createState();
    const state = createState({
      phase: 'ordnance',
      scenarioRules: { allowedOrdnanceTypes: ['nuke'] },
      ships: [
        {
          ...baseState.ships[0],
          id: 'restricted',
          type: 'packet',
          owner: 0,
          nukesLaunchedSinceResupply: 1,
        },
        {
          ...baseState.ships[0],
          id: 'launchable',
          type: 'packet',
          owner: 0,
        },
        {
          ...baseState.ships[1],
          id: 'enemy',
          owner: 1,
        },
      ],
    });
    const deps = createDeps(state);
    deps.ctx.planningState.selectedShipId = 'stale';

    applyClientStateTransition(deps, 'playing_ordnance');

    expect(deps.ctx.planningState.selectedShipId).toBe('launchable');
  });

  it('resets combat planning state on combat entry', () => {
    const state = createState({
      phase: 'combat',
    });
    const deps = createDeps(state);

    deps.ctx.planningState.combatTargetId = 'enemy';
    deps.ctx.planningState.combatTargetType = 'ship';
    deps.ctx.planningState.combatAttackerIds = ['p0s0'];
    deps.ctx.planningState.combatAttackStrength = 3;
    deps.ctx.planningState.queuedAttacks = [
      {
        attackerIds: ['p0s0'],
        targetId: 'enemy',
        targetType: 'ship',
        attackStrength: null,
      },
    ];

    applyClientStateTransition(deps, 'playing_combat');

    expect(deps.calls.resetCombatState).toHaveLength(1);
    expect(deps.ctx.planningState.combatTargetId).toBeNull();
    expect(deps.ctx.planningState.combatAttackerIds).toEqual([]);
    expect(deps.ctx.planningState.queuedAttacks).toEqual([]);
  });

  it('flushes state subscribers after entry side effects complete', () => {
    const state = createState();
    const deps = createDeps(state);
    const session = createInitialClientSession();
    session.playerId = 0;
    session.gameCode = 'ABCDE';
    session.gameState = state;
    session.isLocalGame = false;
    session.planningState.selectedShipId = 'stale';
    deps.ctx = session;

    const seenSelections: (string | null)[] = [];
    const dispose = effect(() => {
      session.stateSignal.value;
      seenSelections.push(session.planningState.selectedShipId);
    });

    applyClientStateTransition(deps, 'playing_astrogation');

    expect(seenSelections).toEqual(['stale', state.ships[0].id]);

    dispose();
  });
});
