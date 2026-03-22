import { describe, expect, it } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { createInitialPlanningState } from './planning';
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
  hudSnapshots: Array<{
    selectedShipId: string | null;
    burnsSize: number;
    overloadsSize: number;
    weakGravityChoicesSize: number;
    combatTargetId: string | null;
    combatAttackerIds: string[];
    queuedAttacksSize: number;
    combatAttackStrength: number | null;
  }>;
} => {
  const calls: Record<string, unknown[][]> = {};
  let logisticsState: unknown;
  const hudSnapshots: Array<{
    selectedShipId: string | null;
    burnsSize: number;
    overloadsSize: number;
    weakGravityChoicesSize: number;
    combatTargetId: string | null;
    combatAttackerIds: string[];
    queuedAttacksSize: number;
    combatAttackStrength: number | null;
  }> = [];

  const track =
    (name: string) =>
    (...args: unknown[]) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

  const deps: StateTransitionDeps & {
    calls: Record<string, unknown[][]>;
    logisticsState: unknown;
    hudSnapshots: Array<{
      selectedShipId: string | null;
      burnsSize: number;
      overloadsSize: number;
      weakGravityChoicesSize: number;
      combatTargetId: string | null;
      combatAttackerIds: string[];
      queuedAttacksSize: number;
      combatAttackStrength: number | null;
    }>;
  } = {
    ctx: {
      state: 'menu',
      playerId: 0,
      gameCode: 'ABCDE',
      gameState,
      planningState: createInitialPlanningState(),
    },
    ui: {
      showMenu: track('ui.showMenu'),
      showConnecting: track('ui.showConnecting'),
      showWaiting: track('ui.showWaiting'),
      showFleetBuilding: track('ui.showFleetBuilding'),
      showHUD: track('ui.showHUD'),
      showAttackButton: track('ui.showAttackButton'),
      showMovementStatus: track('ui.showMovementStatus'),
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
    updateHUD: () => {
      hudSnapshots.push({
        selectedShipId: deps.ctx.planningState.selectedShipId,
        burnsSize: deps.ctx.planningState.burns.size,
        overloadsSize: deps.ctx.planningState.overloads.size,
        weakGravityChoicesSize: deps.ctx.planningState.weakGravityChoices.size,
        combatTargetId: deps.ctx.planningState.combatTargetId,
        combatAttackerIds: [...deps.ctx.planningState.combatAttackerIds],
        queuedAttacksSize: deps.ctx.planningState.queuedAttacks.length,
        combatAttackStrength: deps.ctx.planningState.combatAttackStrength,
      });
      track('updateHUD')();
    },
    resetCombatState: () => {
      deps.ctx.planningState.combatTargetId = null;
      deps.ctx.planningState.combatTargetType = null;
      deps.ctx.planningState.combatAttackerIds = [];
      deps.ctx.planningState.combatAttackStrength = null;
      deps.ctx.planningState.queuedAttacks = [];
      track('resetCombatState')();
    },
    startCombatTargetWatch: track('startCombatTargetWatch'),
    setLogisticsUIState: (state) => {
      logisticsState = state;
      deps.logisticsState = state;
      track('setLogisticsUIState')(state);
    },
    renderLogisticsPanel: track('renderLogisticsPanel'),
    calls,
    logisticsState,
    hudSnapshots,
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
    expect(deps.calls.updateHUD).toHaveLength(1);
    expect(deps.calls['renderer.frameOnShips']).toHaveLength(1);
    expect(deps.calls['tutorial.onPhaseChange']).toEqual([
      ['astrogation', state.turnNumber],
    ]);
    expect(deps.hudSnapshots).toEqual([
      {
        selectedShipId: state.ships[0].id,
        burnsSize: 0,
        overloadsSize: 0,
        weakGravityChoicesSize: 0,
        combatTargetId: null,
        combatAttackerIds: [],
        queuedAttacksSize: 0,
        combatAttackStrength: null,
      },
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

  it('refreshes HUD after applying default ordnance selection', () => {
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

    expect(deps.calls.updateHUD).toHaveLength(1);
    expect(deps.hudSnapshots[0]?.selectedShipId).toBe('launchable');
    expect(deps.ctx.planningState.selectedShipId).toBe('launchable');
  });

  it('refreshes HUD after combat planning state is reset', () => {
    const state = createState({
      phase: 'combat',
    });
    const deps = createDeps(state);

    deps.ctx.planningState.combatTargetId = 'enemy';
    deps.ctx.planningState.combatTargetType = 'ship';
    deps.ctx.planningState.combatAttackerIds = ['p0s0'];
    deps.ctx.planningState.combatAttackStrength = 3;
    deps.ctx.planningState.queuedAttacks = [
      { attackerIds: ['p0s0'], targetId: 'enemy' },
    ];

    applyClientStateTransition(deps, 'playing_combat');

    expect(deps.calls.resetCombatState).toHaveLength(1);
    expect(deps.calls.updateHUD).toHaveLength(1);
    expect(deps.hudSnapshots).toEqual([
      {
        selectedShipId: null,
        burnsSize: 0,
        overloadsSize: 0,
        weakGravityChoicesSize: 0,
        combatTargetId: null,
        combatAttackerIds: [],
        queuedAttacksSize: 0,
        combatAttackStrength: null,
      },
    ]);
    expect(deps.ctx.planningState.combatTargetId).toBeNull();
    expect(deps.ctx.planningState.combatAttackerIds).toEqual([]);
    expect(deps.ctx.planningState.queuedAttacks).toEqual([]);
  });
});
