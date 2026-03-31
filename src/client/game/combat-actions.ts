import { canAttack } from '../../shared/combat';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { clamp } from '../../shared/util';
import { batch } from '../reactive';
import {
  buildCurrentAttack,
  createCombatTargetPlan,
  findNearestTarget,
  getAttackStrengthForSelection,
  hasVisibleCombatTargets,
} from './combat';
import type { PlanningStore } from './planning';
import type { GameTransport } from './transport';

export interface CombatActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => PlayerId;
  getTransport: () => GameTransport | null;
  getMap: () => SolarSystemMap;
  planningState: PlanningStore;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
}

export const clearCombatSelection = (deps: CombatActionDeps) => {
  deps.planningState.clearCombatSelectionState();
};

export const resetCombatState = (deps: CombatActionDeps) => {
  deps.planningState.resetCombatPlanning();
};

// Auto-select the nearest visible enemy for the currently selected
// ship, so the player only needs to confirm (or change target).
const autoTargetNearest = (deps: CombatActionDeps): void => {
  const gameState = deps.getGameState();
  const selectedId = deps.planningState.selectedShipId;
  if (!gameState || !selectedId) return;

  const target = findNearestTarget(
    gameState,
    deps.getPlayerId(),
    selectedId,
    deps.planningState.queuedAttacks,
    deps.getMap(),
  );

  if (target) {
    const plan = createCombatTargetPlan(
      gameState,
      deps.getPlayerId(),
      deps.planningState,
      target.targetId,
      target.targetType,
      deps.getMap(),
    );
    deps.planningState.applyCombatPlanUpdate(plan);
  }
};

// Duration to wait for the dice roll animation before advancing.
const DICE_ROLL_DELAY = 750;

// Select the first un-fired attacker and auto-target nearest enemy.
// Called on combat entry and after each single attack resolves.
export const advanceToNextAttacker = (deps: CombatActionDeps): void => {
  // Delay so the dice roll animation finishes before moving on
  setTimeout(() => advanceToNextAttackerImmediate(deps), DICE_ROLL_DELAY);
};

const advanceToNextAttackerImmediate = (deps: CombatActionDeps): void => {
  const gameState = deps.getGameState();
  if (!gameState || gameState.phase === 'gameOver') return;

  const playerId = deps.getPlayerId();
  const nextAttacker = gameState.ships.find(
    (s) =>
      s.owner === playerId &&
      s.lifecycle !== 'destroyed' &&
      canAttack(s) &&
      !s.firedThisPhase,
  );

  if (nextAttacker) {
    batch(() => {
      deps.planningState.selectShip(nextAttacker.id);
      autoTargetNearest(deps);
    });
  } else {
    // No more attackers — auto-end combat
    clearCombatSelection(deps);
    endCombatPhase(deps);
  }
};

// Submit the current single-ship attack. The server resolves it
// and sends back the result; the client then calls
// advanceToNextAttacker to continue.
export const confirmSingleAttack = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (!gameState || deps.getClientState() !== 'playing_combat' || !transport)
    return;

  const attack = buildCurrentAttack(
    gameState,
    deps.getPlayerId(),
    deps.planningState,
    deps.getMap(),
    deps.planningState.selectedShipId,
  );

  if (!attack) {
    // No target selected — end combat (the button shows
    // "END COMBAT" in this state, so honour that label).
    endCombatPhase(deps);
    return;
  }

  clearCombatSelection(deps);
  transport.submitSingleCombat(attack);
};

// End the combat phase. Resolves base defense and advances the turn.
export const endCombatPhase = (deps: CombatActionDeps) => {
  const transport = deps.getTransport();
  if (!transport) return;
  transport.endCombat();
};

// Batch fire for AI — sends all queued attacks at once.
export const fireAllAttacks = (deps: CombatActionDeps) => {
  const transport = deps.getTransport();

  if (!transport) return;
  const attacks = deps.planningState.takeQueuedAttacks();

  if (attacks.length === 0) {
    sendSkipCombat(deps);
    return;
  }
  transport.submitCombat(attacks);
};

const sendSkipCombat = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (!gameState || deps.getClientState() !== 'playing_combat' || !transport)
    return;
  transport.skipCombat();
};

export { sendSkipCombat };

export const queueAttack = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();

  if (!gameState || deps.getClientState() !== 'playing_combat') return;
  const attack = buildCurrentAttack(
    gameState,
    deps.getPlayerId(),
    deps.planningState,
    deps.getMap(),
    deps.planningState.selectedShipId,
  );

  if (!attack) {
    deps.showToast('Select an enemy ship or nuke to target', 'info');
    return;
  }

  batch(() => {
    const count = deps.planningState.queueCombatAttack(attack);
    clearCombatSelection(deps);

    deps.showToast(`Attack queued (${count}). Press Enter to fire.`, 'info');
  });
};

export const beginCombatPhase = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (!gameState || gameState.phase !== 'combat' || !transport) return;
  transport.beginCombat();
};

export const autoSkipCombatIfNoTargets = (deps: CombatActionDeps): void => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();
  if (
    gameState &&
    transport &&
    !hasVisibleCombatTargets(gameState, deps.getPlayerId(), deps.getMap())
  ) {
    transport.skipCombat();
    return;
  }

  // Targets exist — select first attacker and auto-target
  advanceToNextAttacker(deps);
};

export const adjustCombatStrength = (deps: CombatActionDeps, delta: number) => {
  const gameState = deps.getGameState();

  if (!gameState || deps.getClientState() !== 'playing_combat') return;

  if (deps.planningState.combatTargetType !== 'ship') return;
  const maxStrength = getAttackStrengthForSelection(
    gameState,
    deps.planningState.combatAttackerIds,
  );

  if (maxStrength <= 0) return;

  const current = deps.planningState.combatAttackStrength ?? maxStrength;
  deps.planningState.setCombatAttackStrength(
    clamp(current + delta, 1, maxStrength),
  );
};

export const resetCombatStrengthToMax = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();

  if (!gameState || deps.getClientState() !== 'playing_combat') return;

  if (deps.planningState.combatTargetType !== 'ship') return;
  const maxStrength = getAttackStrengthForSelection(
    gameState,
    deps.planningState.combatAttackerIds,
  );

  if (maxStrength > 0) {
    deps.planningState.setCombatAttackStrength(maxStrength);
  }
};
