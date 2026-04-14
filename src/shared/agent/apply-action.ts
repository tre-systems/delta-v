// In-process dispatcher that routes a C2S action to the right engine call.
// Used by agent benchmark / scrimmage harnesses to run an external agent
// against the engine without booting a WebSocket server or Durable Object.
// The authoritative server (src/server/game-do) uses its own richer
// dispatcher because it also emits engine events for the replay timeline;
// this helper cares only about the next-state transition.

import {
  beginCombatPhase,
  endCombat,
  processAstrogation,
  processCombat,
  processFleetReady,
  processLogistics,
  processOrdnance,
  processSingleCombat,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../engine/game-engine';
import { processSurrender } from '../engine/logistics';
import { processEmplacement } from '../engine/ordnance';
import type {
  EngineError,
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../types/domain';
import type { C2S } from '../types/protocol';

export interface ApplyActionSuccess {
  ok: true;
  state: GameState;
}

export interface ApplyActionFailure {
  ok: false;
  error: EngineError | { message: string };
}

export type ApplyActionResult = ApplyActionSuccess | ApplyActionFailure;

const fail = (message: string): ApplyActionFailure => ({
  ok: false,
  error: { message },
});

// Route a validated C2S action to the matching engine entry point and
// return the next state. Ambient message types (chat, ping, rematch) are
// no-ops here — the benchmark loop has no chat channel.
export const applyAgentAction = (
  state: GameState,
  playerId: PlayerId,
  action: C2S,
  map: SolarSystemMap,
  rng: () => number,
): ApplyActionResult => {
  switch (action.type) {
    case 'fleetReady': {
      const result = processFleetReady(state, playerId, action.purchases, map);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'astrogation': {
      const result = processAstrogation(
        state,
        playerId,
        action.orders,
        map,
        rng,
      );
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'surrender': {
      const result = processSurrender(state, playerId, action.shipIds);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'ordnance': {
      const result = processOrdnance(
        state,
        playerId,
        action.launches,
        map,
        rng,
      );
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'skipOrdnance': {
      const result = skipOrdnance(state, playerId, map, rng);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'emplaceBase': {
      const result = processEmplacement(
        state,
        playerId,
        action.emplacements,
        map,
      );
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'beginCombat': {
      const result = beginCombatPhase(state, playerId, map, rng);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'combat': {
      const result = processCombat(state, playerId, action.attacks, map, rng);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'combatSingle': {
      const result = processSingleCombat(
        state,
        playerId,
        action.attack,
        map,
        rng,
      );
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'endCombat': {
      const result = endCombat(state, playerId, map, rng);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'skipCombat': {
      const result = skipCombat(state, playerId, map, rng);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'logistics': {
      const result = processLogistics(state, playerId, action.transfers, map);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    case 'skipLogistics': {
      const result = skipLogistics(state, playerId, map);
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, state: result.state };
    }
    // Ambient / session-only — not applicable in the in-process benchmark.
    case 'chat':
    case 'ping':
    case 'rematch':
      return fail(
        `Action type "${action.type}" is not dispatchable in-process`,
      );
    default: {
      const _exhaustive: never = action;
      return fail(`Unknown action type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
