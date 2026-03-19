import type { GameState, SolarSystemMap } from '../../shared/types';
import { clamp } from '../../shared/util';
import {
  buildCurrentAttack,
  countRemainingCombatAttackers,
  getAttackStrengthForSelection,
  hasSplitFireOptions,
} from './combat';
import type { PlanningState } from './planning';
import type { GameTransport } from './transport';

export interface CombatActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => number;
  getTransport: () => GameTransport | null;
  getMap: () => SolarSystemMap;
  planningState: PlanningState;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  showAttackButton: (visible: boolean) => void;
  showFireButton: (visible: boolean, count: number) => void;
}

export const clearCombatSelection = (deps: CombatActionDeps) => {
  deps.planningState.combatTargetId = null;
  deps.planningState.combatTargetType = null;
  deps.planningState.combatAttackerIds = [];
  deps.planningState.combatAttackStrength = null;
};

export const resetCombatState = (deps: CombatActionDeps) => {
  clearCombatSelection(deps);
  deps.planningState.queuedAttacks = [];
  deps.showFireButton(false, 0);
};

export const fireAllAttacks = (deps: CombatActionDeps) => {
  const transport = deps.getTransport();
  if (!transport) return;
  const attacks = [...deps.planningState.queuedAttacks];
  if (attacks.length === 0) {
    sendSkipCombat(deps);
    return;
  }
  deps.planningState.queuedAttacks = [];
  deps.showFireButton(false, 0);
  transport.submitCombat(attacks);
};

const sendSkipCombat = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();
  if (!gameState || deps.getClientState() !== 'playing_combat' || !transport) return;
  transport.skipCombat();
};

export { sendSkipCombat };

export const queueAttack = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  if (!gameState || deps.getClientState() !== 'playing_combat') return;
  const attack = buildCurrentAttack(gameState, deps.getPlayerId(), deps.planningState, deps.getMap());
  if (!attack) {
    deps.showToast('Select an enemy ship or nuke to target', 'info');
    return;
  }

  deps.planningState.queuedAttacks.push(attack);
  clearCombatSelection(deps);
  deps.showAttackButton(false);

  const remainingAttackers = countRemainingCombatAttackers(
    gameState,
    deps.getPlayerId(),
    deps.planningState.queuedAttacks,
  );
  if (
    remainingAttackers === 0 &&
    !hasSplitFireOptions(gameState, deps.getPlayerId(), deps.planningState.queuedAttacks)
  ) {
    // No more attackers available — auto-fire
    fireAllAttacks(deps);
  } else {
    const count = deps.planningState.queuedAttacks.length;
    deps.showToast(`Attack queued (${count}). Select next target or press Enter to fire.`, 'info');
    deps.showFireButton(true, count);
  }
};

export const beginCombatPhase = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();
  if (!gameState || gameState.phase !== 'combat' || !transport) return;
  transport.beginCombat();
};

export const startCombatTargetWatch = (deps: CombatActionDeps): (() => void) => {
  let combatWatchInterval: number | null = null;
  if (combatWatchInterval) clearInterval(combatWatchInterval);
  combatWatchInterval = window.setInterval(() => {
    if (deps.getClientState() !== 'playing_combat') {
      if (combatWatchInterval) clearInterval(combatWatchInterval);
      combatWatchInterval = null;
      return;
    }
    const hasTarget = deps.planningState.combatTargetId !== null;
    deps.showAttackButton(hasTarget);
  }, 100);
  return () => {
    if (combatWatchInterval) {
      clearInterval(combatWatchInterval);
      combatWatchInterval = null;
    }
  };
};

export const adjustCombatStrength = (deps: CombatActionDeps, delta: number) => {
  const gameState = deps.getGameState();
  if (!gameState || deps.getClientState() !== 'playing_combat') return;
  if (deps.planningState.combatTargetType !== 'ship') return;
  const maxStrength = getAttackStrengthForSelection(gameState, deps.planningState.combatAttackerIds);
  if (maxStrength <= 0) return;

  const current = deps.planningState.combatAttackStrength ?? maxStrength;
  deps.planningState.combatAttackStrength = clamp(current + delta, 1, maxStrength);
};

export const resetCombatStrengthToMax = (deps: CombatActionDeps) => {
  const gameState = deps.getGameState();
  if (!gameState || deps.getClientState() !== 'playing_combat') return;
  if (deps.planningState.combatTargetType !== 'ship') return;
  const maxStrength = getAttackStrengthForSelection(gameState, deps.planningState.combatAttackerIds);
  if (maxStrength > 0) {
    deps.planningState.combatAttackStrength = maxStrength;
  }
};
