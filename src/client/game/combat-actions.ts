import {
  canAttack,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../../shared/combat';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { clamp } from '../../shared/util';
import {
  buildCurrentAttack,
  countRemainingCombatAttackers,
  getAttackStrengthForSelection,
  hasSplitFireOptions,
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
  showFireButton: (visible: boolean, count: number) => void;
}

const hasVisibleCombatTargets = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): boolean => {
  const attackers = state.ships.filter(
    (s) => s.owner === playerId && s.lifecycle !== 'destroyed' && canAttack(s),
  );
  if (attackers.length === 0) return false;

  const hasShipTarget = state.ships.some(
    (target) =>
      target.owner !== playerId &&
      target.lifecycle === 'active' &&
      target.detected &&
      attackers.some((attacker) => hasLineOfSight(attacker, target, map)),
  );
  if (hasShipTarget) return true;

  return state.ordnance.some(
    (ord) =>
      ord.type === 'nuke' &&
      ord.owner !== playerId &&
      ord.lifecycle !== 'destroyed' &&
      attackers.some((attacker) => hasLineOfSightToTarget(attacker, ord, map)),
  );
};

export const clearCombatSelection = (deps: CombatActionDeps) => {
  deps.planningState.clearCombatSelectionState();
};

export const resetCombatState = (deps: CombatActionDeps) => {
  deps.planningState.resetCombatPlanning();
  deps.showFireButton(false, 0);
};

export const fireAllAttacks = (deps: CombatActionDeps) => {
  const transport = deps.getTransport();

  if (!transport) return;
  const attacks = deps.planningState.takeQueuedAttacks();

  if (attacks.length === 0) {
    sendSkipCombat(deps);
    return;
  }
  deps.showFireButton(false, 0);
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

  const count = deps.planningState.queueCombatAttack(attack);
  clearCombatSelection(deps);

  const remainingAttackers = countRemainingCombatAttackers(
    gameState,
    deps.getPlayerId(),
    deps.planningState.queuedAttacks,
  );

  if (
    remainingAttackers === 0 &&
    !hasSplitFireOptions(
      gameState,
      deps.getPlayerId(),
      deps.planningState.queuedAttacks,
    )
  ) {
    // No more attackers available — auto-fire
    fireAllAttacks(deps);
  } else {
    // Auto-advance to the next attackable ship in rotation
    const committedIds = new Set(
      deps.planningState.queuedAttacks.flatMap((a) => a.attackerIds),
    );
    const myShips = gameState.ships.filter(
      (s) =>
        s.owner === deps.getPlayerId() &&
        s.lifecycle !== 'destroyed' &&
        canAttack(s) &&
        !committedIds.has(s.id),
    );
    const currentIdx = myShips.findIndex(
      (s) => s.id === deps.planningState.selectedShipId,
    );

    if (myShips.length > 0) {
      const next = myShips[(currentIdx + 1) % myShips.length];
      deps.planningState.selectShip(next.id);
    }

    deps.showToast(
      `Attack queued (${count}). Click next target or press Enter to fire.`,
      'info',
    );
    deps.showFireButton(true, count);
  }
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
    // Skip directly — sendSkipCombat checks getClientState() which
    // may not reflect 'playing_combat' yet during state transition
    transport.skipCombat();
  }
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
