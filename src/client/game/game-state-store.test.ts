import { describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { effect } from '../reactive';
import {
  type ApplyClientGameStateDeps,
  applyClientGameState,
  clearClientGameState,
} from './game-state-store';
import { createPlanningStore } from './planning';
import { stubClientSession } from './session-model';

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    'STORE1',
    findBaseHex,
  ),
  ...overrides,
});

const createDeps = (
  selectedShipId: string | null = null,
): ApplyClientGameStateDeps & {
  rendererCalls: (GameState | null)[];
} => {
  const rendererCalls: (GameState | null)[] = [];
  const planningState = createPlanningStore();
  planningState.selectedShipId = selectedShipId;

  return {
    ctx: {
      gameState: null,
      planningState,
    },
    renderer: {
      setGameState: (state) => {
        rendererCalls.push(state);
      },
    },
    rendererCalls,
  };
};

describe('applyClientGameState', () => {
  it('stores the game state and updates the renderer', () => {
    const state = createState();
    const deps = createDeps();

    applyClientGameState(deps, state);

    expect(deps.ctx.gameState).toBe(state);
    expect(deps.rendererCalls).toEqual([state]);
  });

  it('updates ctx when renderer is omitted (shell uses session effects)', () => {
    const state = createState();
    const planningState = createPlanningStore();
    const deps: ApplyClientGameStateDeps = {
      ctx: {
        gameState: null,
        planningState,
      },
    };

    applyClientGameState(deps, state);

    expect(deps.ctx.gameState).toBe(state);
  });

  it('projects spectator-visible state without mutating the source object', () => {
    const state = createState({
      ships: createState().ships.map((ship, index) =>
        index === 0 ? { ...ship, detected: false } : ship,
      ),
    });
    const deps = createDeps();

    applyClientGameState({ ...deps, isSpectator: true }, state);

    expect(state.ships[0]?.detected).toBe(false);
    expect(deps.ctx.gameState).not.toBe(state);
    expect(deps.ctx.gameState?.ships.every((ship) => ship.detected)).toBe(true);
  });

  it('keeps the selected ship when it still exists and is alive', () => {
    const state = createState();
    const selectedShipId = state.ships[0]?.id ?? null;
    const deps = createDeps(selectedShipId);

    applyClientGameState(deps, state);

    expect(deps.ctx.planningState.selectedShipId).toBe(selectedShipId);
  });

  it('clears the selected ship when it no longer exists', () => {
    const state = createState();
    const deps = createDeps('missing-ship');

    applyClientGameState(deps, state);

    expect(deps.ctx.planningState.selectedShipId).toBeNull();
  });

  it('clears the selected ship when it was destroyed', () => {
    const state = createState({
      ships: createState().ships.map((ship, index) =>
        index === 0 ? { ...ship, lifecycle: 'destroyed' as const } : ship,
      ),
    });
    const destroyedShipId = state.ships[0]?.id ?? null;
    const deps = createDeps(destroyedShipId);

    applyClientGameState(deps, state);

    expect(deps.ctx.planningState.selectedShipId).toBeNull();
  });

  it('clears the stored game state', () => {
    const state = createState();
    const deps = createDeps();

    applyClientGameState(deps, state);
    clearClientGameState(deps.ctx);

    expect(deps.ctx.gameState).toBeNull();
  });

  it('flushes game state subscribers after planning cleanup', () => {
    const state = createState();
    const session = stubClientSession({ gameState: null });
    session.planningState.selectedShipId = 'missing-ship';
    const seenSelections: (string | null)[] = [];
    const dispose = effect(() => {
      session.gameStateSignal.value;
      seenSelections.push(session.planningState.selectedShipId);
    });

    applyClientGameState({ ctx: session }, state);

    expect(seenSelections).toEqual(['missing-ship', null]);

    dispose();
  });
});
