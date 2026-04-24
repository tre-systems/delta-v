// Server-side ActionGuards validation. Runs before the engine so an agent
// that submits with expectedTurn=N after the game has advanced to N+1 gets a
// clear `actionRejected` with the current state, not a silent drop or a
// confusing phase error.

import { allowedActionTypesForPhase } from '../../shared/agent/candidates';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { ActionGuards, C2S, S2C } from '../../shared/types/protocol';

export type ActionAcceptedMessage = Extract<S2C, { type: 'actionAccepted' }>;
export type ActionRejectedMessage = Extract<S2C, { type: 'actionRejected' }>;

export type ActionGuardStatus = ActionAcceptedMessage['guardStatus'];
export type ActionRejectionReason = ActionRejectedMessage['reason'];

export interface ActionGuardRejection {
  reason: ActionRejectionReason;
  message: string;
}

export interface ActionGuardCheckResult {
  guardStatus: ActionGuardStatus;
  rejection: ActionGuardRejection | null;
}

// Check the caller-supplied guards against the current authoritative state.
// Returns null when the action is safe to dispatch. Idempotency is checked
// separately because it needs per-session state.
//
// The action `msg` is optional; when passed, an "expected phase" mismatch
// is FORGIVEN if the action type is already valid for the current phase.
// Rationale: `expectedPhase` is a stale-action replay guard, but the
// action-type → phase mapping already provides the same protection. On the
// turn-1 astrogation → ordnance transition, agents that race their next
// submission occasionally carry an expectedPhase that lags the server by
// one step; the engine would accept the action anyway, so there is no
// safety value in rejecting it. See
// `docs/AGENT_IMPROVEMENTS_LOG.md` for the observed behaviour.
export const checkActionGuards = (
  guards: ActionGuards | undefined,
  state: GameState,
  playerId: PlayerId,
  msg?: C2S,
): ActionGuardCheckResult => {
  if (!guards) {
    return {
      guardStatus: 'inSync',
      rejection: null,
    };
  }

  if (
    typeof guards.expectedTurn === 'number' &&
    guards.expectedTurn !== state.turnNumber
  ) {
    return {
      guardStatus: 'inSync',
      rejection: {
        reason: 'staleTurn',
        message: `expected turn ${guards.expectedTurn} but server is on turn ${state.turnNumber}`,
      },
    };
  }

  if (guards.expectedPhase && guards.expectedPhase !== state.phase) {
    const actionTypeOkForCurrentPhase =
      msg !== undefined &&
      allowedActionTypesForPhase(state.phase).has(msg.type as C2S['type']);
    if (!actionTypeOkForCurrentPhase) {
      return {
        guardStatus: 'inSync',
        rejection: {
          reason: 'stalePhase',
          message: `expected phase ${guards.expectedPhase} but server is in ${state.phase}`,
        },
      };
    }
    // Stale guard, but the action type is valid for the real phase — let
    // the engine handle it so agents that race their next submission stop
    // seeing spurious turn-1 rejections.
  }

  // wrongActivePlayer applies whenever the engine gates on activePlayer.
  // Only fleetBuilding is truly simultaneous (both submit before start);
  // astrogation is sequential in the engine even when the UI feels snappy.
  const isSequential =
    state.phase === 'astrogation' ||
    state.phase === 'ordnance' ||
    state.phase === 'combat' ||
    state.phase === 'logistics';
  if (isSequential && state.activePlayer !== playerId) {
    return {
      guardStatus: 'inSync',
      rejection: {
        reason: 'wrongActivePlayer',
        message: `not your turn in ${state.phase} (active player is ${state.activePlayer})`,
      },
    };
  }

  return {
    guardStatus:
      guards.expectedPhase && guards.expectedPhase !== state.phase
        ? 'stalePhaseForgiven'
        : 'inSync',
    rejection: null,
  };
};

// Per-match ring of recently-processed idempotency keys. Keeps the last N
// keys per seat; cleared on phase advance so agents can reuse keys between
// phases without collision. Ephemeral — lives in GameDO memory, lost on
// Durable Object re-activation (safe: the agent will just re-submit).
const MAX_KEYS_PER_PLAYER = 32;

export class IdempotencyKeyCache {
  private readonly byPlayer = new Map<PlayerId, Set<string>>();

  has(playerId: PlayerId, key: string): boolean {
    return this.byPlayer.get(playerId)?.has(key) ?? false;
  }

  remember(playerId: PlayerId, key: string): void {
    let set = this.byPlayer.get(playerId);
    if (!set) {
      set = new Set();
      this.byPlayer.set(playerId, set);
    }
    // Re-add to refresh insertion order so the ring behaves as LRU.
    if (set.has(key)) {
      set.delete(key);
    }
    set.add(key);
    // Trim to the most recent N keys. Set iteration is guaranteed
    // insertion-ordered, so shifting from the front drops the oldest entry
    // without allocating a new Set.
    while (set.size > MAX_KEYS_PER_PLAYER) {
      const oldest = set.values().next().value as string | undefined;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }

  // Call on phase advance so each phase has a fresh idempotency scope.
  clear(): void {
    this.byPlayer.clear();
  }

  // Keep keys alive for retries within the same authoritative scope. Clear
  // only when the game actually moves to a new turn/phase/match.
  clearIfScopeChanged(
    previous: Pick<GameState, 'gameId' | 'turnNumber' | 'phase'> | null,
    next: Pick<GameState, 'gameId' | 'turnNumber' | 'phase'>,
  ): void {
    if (
      previous === null ||
      previous.gameId !== next.gameId ||
      previous.turnNumber !== next.turnNumber ||
      previous.phase !== next.phase
    ) {
      this.clear();
    }
  }
}

// Build the S2C actionRejected payload for a guard or idempotency failure.
export const buildActionRejected = (
  rejection: ActionGuardRejection,
  state: GameState,
  guards: ActionGuards | undefined,
  submitterPlayerId?: PlayerId,
): ActionRejectedMessage => ({
  type: 'actionRejected',
  reason: rejection.reason,
  message: rejection.message,
  ...(submitterPlayerId !== undefined ? { submitterPlayerId } : {}),
  expected: {
    turn: guards?.expectedTurn,
    phase: guards?.expectedPhase,
  },
  actual: {
    turn: state.turnNumber,
    phase: state.phase,
    activePlayer: state.activePlayer,
  },
  state,
  idempotencyKey: guards?.idempotencyKey,
});

export const buildActionAccepted = (
  guardStatus: ActionGuardStatus,
  state: GameState,
  guards: ActionGuards | undefined,
  submitterPlayerId?: PlayerId,
): ActionAcceptedMessage => ({
  type: 'actionAccepted',
  guardStatus,
  ...(submitterPlayerId !== undefined ? { submitterPlayerId } : {}),
  expected: {
    turn: guards?.expectedTurn,
    phase: guards?.expectedPhase,
  },
  actual: {
    turn: state.turnNumber,
    phase: state.phase,
    activePlayer: state.activePlayer,
  },
  idempotencyKey: guards?.idempotencyKey,
});
