import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import {
  type ApplyClientGameStateDeps,
  applyClientGameState,
  clearClientGameState,
} from './game-state-store';

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createGame(SCENARIOS.duel, buildSolarSystemMap(), 'STORE1', findBaseHex),
  ...overrides,
});

const createDeps = (
  selectedShipId: string | null = null,
): ApplyClientGameStateDeps & {
  rendererCalls: (GameState | null)[];
} => {
  const rendererCalls: (GameState | null)[] = [];

  return {
    ctx: {
      gameState: null,
      planningState: {
        selectedShipId,
      },
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

  it('updates ctx when renderer is omitted (shell uses mirror effect)', () => {
    const state = createState();
    const deps: ApplyClientGameStateDeps = {
      ctx: {
        gameState: null,
        planningState: { selectedShipId: null },
      },
    };

    applyClientGameState(deps, state);

    expect(deps.ctx.gameState).toBe(state);
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

  it('invokes afterApply after storing state', () => {
    const state = createState();
    const deps = createDeps();
    const afterApply = vi.fn();

    applyClientGameState({ ...deps, afterApply }, state);

    expect(afterApply).toHaveBeenCalledTimes(1);
    expect(afterApply).toHaveBeenCalledWith(state);
  });

  it('invokes afterClear when clearing game state', () => {
    const state = createState();
    const deps = createDeps();
    const afterClear = vi.fn();

    applyClientGameState(deps, state);
    clearClientGameState(deps.ctx, afterClear);

    expect(afterClear).toHaveBeenCalledTimes(1);
  });
});
