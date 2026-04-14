// Server-side ActionGuards validation. Runs before the engine so an agent
// that submits with expectedTurn=N after the game has advanced to N+1 gets a
// clear `actionRejected` with the current state, not a silent drop or a
// confusing phase error.

import type { GameState, PlayerId } from '../../shared/types/domain';
import type { ActionGuards, S2C } from '../../shared/types/protocol';

export type ActionRejectedMessage = Extract<S2C, { type: 'actionRejected' }>;

export type ActionRejectionReason = ActionRejectedMessage['reason'];

export interface ActionGuardRejection {
  reason: ActionRejectionReason;
  message: string;
}

// Check the caller-supplied guards against the current authoritative state.
// Returns null when the action is safe to dispatch. Idempotency is checked
// separately because it needs per-session state.
export const checkActionGuards = (
  guards: ActionGuards | undefined,
  state: GameState,
  playerId: PlayerId,
): ActionGuardRejection | null => {
  if (!guards) return null;

  if (
    typeof guards.expectedTurn === 'number' &&
    guards.expectedTurn !== state.turnNumber
  ) {
    return {
      reason: 'staleTurn',
      message: `expected turn ${guards.expectedTurn} but server is on turn ${state.turnNumber}`,
    };
  }

  if (guards.expectedPhase && guards.expectedPhase !== state.phase) {
    return {
      reason: 'stalePhase',
      message: `expected phase ${guards.expectedPhase} but server is in ${state.phase}`,
    };
  }

  // wrongActivePlayer is only meaningful for sequential phases; simultaneous
  // phases (fleetBuilding, astrogation) allow either seat to act in parallel.
  const isSequential =
    state.phase === 'ordnance' ||
    state.phase === 'combat' ||
    state.phase === 'logistics';
  if (isSequential && state.activePlayer !== playerId) {
    return {
      reason: 'wrongActivePlayer',
      message: `not your turn in ${state.phase} (active player is ${state.activePlayer})`,
    };
  }

  return null;
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
    set.add(key);
    // Trim to the most recent N keys so the ring stays bounded.
    if (set.size > MAX_KEYS_PER_PLAYER) {
      const trimmed = Array.from(set).slice(-MAX_KEYS_PER_PLAYER);
      this.byPlayer.set(playerId, new Set(trimmed));
    }
  }

  // Call on phase advance so each phase has a fresh idempotency scope.
  clear(): void {
    this.byPlayer.clear();
  }
}

// Build the S2C actionRejected payload for a guard or idempotency failure.
export const buildActionRejected = (
  rejection: ActionGuardRejection,
  state: GameState,
  guards: ActionGuards | undefined,
): ActionRejectedMessage => ({
  type: 'actionRejected',
  reason: rejection.reason,
  message: rejection.message,
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
