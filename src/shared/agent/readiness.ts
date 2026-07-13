import type { GameState, PlayerId } from '../types/domain';
import type { AgentReadyInfo, AgentReadyReason } from './types';

/** Grace period before the server protects a stalled external-agent seat. */
export const AGENT_AUTOPLAY_TIMEOUT_MS = 60_000;

/** Keep local WebSocket estimates away from the server's deadline boundary. */
export const AGENT_DEADLINE_ESTIMATE_SAFETY_MS = 1_000;

const isActionable = (state: GameState, playerId: PlayerId): boolean => {
  switch (state.phase) {
    case 'waiting':
    case 'gameOver':
      return false;
    case 'fleetBuilding':
      return !state.players[playerId].ready;
    case 'astrogation':
    case 'ordnance':
    case 'combat':
    case 'logistics':
      return state.activePlayer === playerId;
    default: {
      const _exhaustive: never = state.phase;
      return _exhaustive;
    }
  }
};

const readyReason = (
  state: GameState,
  playerId: PlayerId,
): AgentReadyReason => {
  if (state.phase === 'gameOver') return 'game_over';
  if (state.phase === 'fleetBuilding') {
    return state.players[playerId].ready
      ? 'waiting_for_opponent'
      : 'fleet_building';
  }
  return state.activePlayer === playerId ? 'your_turn' : 'waiting_for_opponent';
};

/**
 * Build readiness metadata for the stdio/WebSocket MCP bridge.
 *
 * Hosted MCP reads the exact alarm timestamp from Durable Object storage.
 * The local bridge estimates it from the authoritative state receipt time and
 * subtracts a safety margin. A missing timestamp still reports that fallback
 * is pending rather than incorrectly promising an unlimited turn.
 */
export const buildEstimatedAgentReadyInfo = (options: {
  state: GameState;
  playerId: PlayerId;
  stateObservedAt: number | null;
  now?: number;
}): AgentReadyInfo => {
  const actionable = isActionable(options.state, options.playerId);
  if (!actionable) {
    return {
      actionable: false,
      reason: readyReason(options.state, options.playerId),
      actionDeadlineAt: null,
      msUntilAutoplay: null,
      fallbackAutoplayPending: false,
    };
  }

  const actionDeadlineAt =
    options.stateObservedAt === null
      ? null
      : options.stateObservedAt +
        AGENT_AUTOPLAY_TIMEOUT_MS -
        AGENT_DEADLINE_ESTIMATE_SAFETY_MS;
  const now = options.now ?? Date.now();

  return {
    actionable: true,
    reason: readyReason(options.state, options.playerId),
    actionDeadlineAt,
    msUntilAutoplay:
      actionDeadlineAt === null ? null : Math.max(0, actionDeadlineAt - now),
    fallbackAutoplayPending: true,
  };
};
