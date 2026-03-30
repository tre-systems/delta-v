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
import { batch } from '../reactive';
import {
  buildCurrentAttack,
  createCombatTargetPlan,
  findNearestTarget,
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
};

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
      autoTargetNearest(deps);
    }

    const hasMore =
      myShips.length > 0 ||
      hasSplitFireOptions(
        gameState,
        deps.getPlayerId(),
        deps.planningState.queuedAttacks,
      );

    deps.showToast(
      hasMore
        ? `Attack queued (${count}). Select next target or press Enter to fire.`
        : `Attack queued (${count}). Press Enter to fire.`,
      'info',
    );
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
    // Skip directly — sendSkipCombat checks getClientState() which
    // may not reflect 'playing_combat' yet during state transition
    transport.skipCombat();
    return;
  }

  // Targets exist — pre-select the nearest one for the selected ship
  autoTargetNearest(deps);
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
