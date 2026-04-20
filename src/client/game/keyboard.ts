import type { OrdnanceType } from '../../shared/types/domain';
import type { ClientState } from './phase';

const SHIP_SELECTION_STATES = new Set<ClientState>([
  'playing_astrogation',
  'playing_ordnance',
  'playing_combat',
]);

const FOCUS_STATES = new Set<ClientState>([
  'playing_astrogation',
  'playing_ordnance',
  'playing_combat',
  'playing_opponentTurn',
]);

export interface KeyboardShortcutContext {
  state: ClientState;
  hasGameState: boolean;
  typingInInput: boolean;
  selectedShipId: string | null;
  selectedShipCanOverload: boolean;
  selectedShipBurnDirection: number | null;
  selectedShipOverloadDirection: number | null;
  selectedShipWeakGravityChoices: Record<string, boolean> | null;
  combatTargetId: string | null;
  queuedAttackCount: number;
  torpedoAccelActive: boolean;
  torpedoAimingActive: boolean;
  torpedoAccelDirection: number | null;
  torpedoAccelSteps: 1 | 2 | null;
  allShipsAcknowledged: boolean;
  allOrdnanceShipsAcknowledged: boolean;
  hasSelectedShip: boolean;
}

export interface KeyboardShortcutInput {
  key: string;
  shiftKey: boolean;
}

export type KeyboardAction =
  | { kind: 'none'; preventDefault: false }
  | { kind: 'cycleShip'; preventDefault: true; direction: -1 | 1 }
  | { kind: 'clearCombatSelection'; preventDefault: false }
  | { kind: 'undoQueuedAttack'; preventDefault: false }
  | { kind: 'clearTorpedoAcceleration'; preventDefault: false }
  | { kind: 'deselectShip'; preventDefault: false }
  | { kind: 'confirmOrders'; preventDefault: true }
  | { kind: 'skipOrdnance'; preventDefault: true }
  | { kind: 'queueAttack'; preventDefault: true }
  | { kind: 'fireAllAttacks'; preventDefault: true }
  | { kind: 'confirmSingleAttack'; preventDefault: true }
  | { kind: 'endCombat'; preventDefault: true }
  | { kind: 'skipCombat'; preventDefault: true }
  | { kind: 'confirmTransfers'; preventDefault: true }
  | { kind: 'adjustCombatStrength'; preventDefault: true; delta: -1 | 1 }
  | {
      kind: 'launchOrdnance';
      preventDefault: false;
      ordnanceType: OrdnanceType;
    }
  | {
      kind: 'setTorpedoAccel';
      preventDefault: false;
      direction: number | null;
      steps: 1 | 2 | null;
    }
  | {
      kind: 'setOverloadDirection';
      preventDefault: false;
      shipId: string;
      direction: number | null;
    }
  | {
      kind: 'setWeakGravityChoices';
      preventDefault: false;
      shipId: string;
      choices: Record<string, boolean>;
    }
  | { kind: 'setBurnDirection'; preventDefault: false; direction: number }
  | { kind: 'clearSelectedBurn'; preventDefault: false }
  | { kind: 'skipShipBurn'; preventDefault: true }
  | { kind: 'confirmOrdnance'; preventDefault: true }
  | { kind: 'skipOrdnanceShip'; preventDefault: true }
  | { kind: 'resetCombatStrength'; preventDefault: false }
  | { kind: 'focusNearestEnemy'; preventDefault: false }
  | { kind: 'focusOwnFleet'; preventDefault: false }
  | { kind: 'toggleLog'; preventDefault: false }
  | { kind: 'panCamera'; preventDefault: false; dx: number; dy: number }
  | { kind: 'zoomCamera'; preventDefault: false; factor: number }
  | { kind: 'toggleHelp'; preventDefault: false }
  | { kind: 'toggleMute'; preventDefault: false }
  | { kind: 'cycleCombatAttacker'; preventDefault: true; direction: -1 | 1 }
  | { kind: 'cycleCombatTarget'; preventDefault: true; direction: -1 | 1 };

const createNoopAction = (): KeyboardAction => {
  return { kind: 'none', preventDefault: false };
};

const cycleTorpedoAcceleration = (
  currentDirection: number | null,
  currentSteps: 1 | 2 | null,
  clickedDirection: number,
): { direction: number | null; steps: 1 | 2 | null } => {
  if (currentDirection !== clickedDirection) {
    return { direction: clickedDirection, steps: 1 };
  }

  if (currentSteps === 1) {
    return { direction: clickedDirection, steps: 2 };
  }

  return { direction: null, steps: null };
};

const OVERLOAD_DIRECTION_KEYS = ['!', '@', '#', '$', '%', '^'] as const;

export const deriveKeyboardAction = (
  context: KeyboardShortcutContext,
  input: KeyboardShortcutInput,
): KeyboardAction => {
  if (context.typingInInput) {
    return createNoopAction();
  }

  if (
    input.key === 'Tab' &&
    context.hasGameState &&
    SHIP_SELECTION_STATES.has(context.state)
  ) {
    return {
      kind: 'cycleShip',
      preventDefault: true,
      direction: input.shiftKey ? -1 : 1,
    };
  }

  if (
    (input.key === '[' || input.key === ']') &&
    context.state === 'playing_combat'
  ) {
    return {
      kind: 'cycleCombatTarget',
      preventDefault: true,
      direction: input.key === '[' ? -1 : 1,
    };
  }

  if (
    (input.key === '{' || input.key === '}') &&
    context.state === 'playing_combat'
  ) {
    return {
      kind: 'cycleCombatAttacker',
      preventDefault: true,
      direction: input.key === '{' ? -1 : 1,
    };
  }

  if (input.key === 'Escape') {
    if (context.combatTargetId) {
      return { kind: 'clearCombatSelection', preventDefault: false };
    }

    if (context.queuedAttackCount > 0) {
      return { kind: 'undoQueuedAttack', preventDefault: false };
    }

    if (context.torpedoAccelActive || context.torpedoAimingActive) {
      return { kind: 'clearTorpedoAcceleration', preventDefault: false };
    }
    return { kind: 'deselectShip', preventDefault: false };
  }

  if (input.key === 'Enter' || input.key === ' ') {
    if (context.state === 'playing_astrogation') {
      if (context.allShipsAcknowledged) {
        return { kind: 'confirmOrders', preventDefault: true };
      }
      if (context.hasSelectedShip) {
        return { kind: 'skipShipBurn', preventDefault: true };
      }
    }

    if (context.state === 'playing_ordnance') {
      if (context.torpedoAimingActive) {
        return {
          kind: 'launchOrdnance',
          preventDefault: false,
          ordnanceType: 'torpedo' as const,
        };
      }
      return { kind: 'confirmOrdnance', preventDefault: true };
    }

    if (context.state === 'playing_logistics') {
      return { kind: 'confirmTransfers', preventDefault: true };
    }

    if (context.state === 'playing_combat') {
      if (context.combatTargetId) {
        return { kind: 'confirmSingleAttack', preventDefault: true };
      }
      return { kind: 'endCombat', preventDefault: true };
    }
  }

  if (
    (input.key === '-' || input.key === '_') &&
    context.state === 'playing_combat'
  ) {
    return { kind: 'adjustCombatStrength', preventDefault: true, delta: -1 };
  }

  if (
    (input.key === '=' || input.key === '+') &&
    context.state === 'playing_combat'
  ) {
    return { kind: 'adjustCombatStrength', preventDefault: true, delta: 1 };
  }

  const lowerKey = input.key.toLowerCase();

  if (lowerKey === 'n' && context.state === 'playing_ordnance') {
    return {
      kind: 'launchOrdnance',
      preventDefault: false,
      ordnanceType: 'mine',
    };
  }

  if (lowerKey === 't' && context.state === 'playing_ordnance') {
    return {
      kind: 'launchOrdnance',
      preventDefault: false,
      ordnanceType: 'torpedo',
    };
  }

  if (lowerKey === 'k' && context.state === 'playing_ordnance') {
    return {
      kind: 'launchOrdnance',
      preventDefault: false,
      ordnanceType: 'nuke',
    };
  }

  if (
    OVERLOAD_DIRECTION_KEYS.includes(
      input.key as (typeof OVERLOAD_DIRECTION_KEYS)[number],
    ) &&
    context.state === 'playing_astrogation' &&
    context.selectedShipId &&
    context.selectedShipCanOverload &&
    context.selectedShipBurnDirection !== null
  ) {
    const direction = OVERLOAD_DIRECTION_KEYS.indexOf(
      input.key as (typeof OVERLOAD_DIRECTION_KEYS)[number],
    );

    return {
      kind: 'setOverloadDirection',
      preventDefault: false,
      shipId: context.selectedShipId,
      direction:
        context.selectedShipOverloadDirection === direction ? null : direction,
    };
  }

  if (
    lowerKey === 'g' &&
    context.state === 'playing_astrogation' &&
    context.selectedShipId &&
    context.selectedShipWeakGravityChoices
  ) {
    return {
      kind: 'setWeakGravityChoices',
      preventDefault: false,
      shipId: context.selectedShipId,
      choices: context.selectedShipWeakGravityChoices,
    };
  }

  if (
    input.key >= '1' &&
    input.key <= '6' &&
    context.state === 'playing_ordnance' &&
    context.torpedoAimingActive
  ) {
    const next = cycleTorpedoAcceleration(
      context.torpedoAccelDirection,
      context.torpedoAccelSteps,
      Number.parseInt(input.key, 10) - 1,
    );
    return {
      kind: 'setTorpedoAccel',
      preventDefault: false,
      direction: next.direction,
      steps: next.steps,
    };
  }

  if (
    input.key >= '1' &&
    input.key <= '6' &&
    context.state === 'playing_astrogation'
  ) {
    return {
      kind: 'setBurnDirection',
      preventDefault: false,
      direction: Number.parseInt(input.key, 10) - 1,
    };
  }

  if (input.key === '0' && context.state === 'playing_astrogation') {
    return { kind: 'clearSelectedBurn', preventDefault: false };
  }

  if (
    input.key === '0' &&
    context.state === 'playing_ordnance' &&
    context.torpedoAimingActive
  ) {
    return { kind: 'clearTorpedoAcceleration', preventDefault: false };
  }

  if (lowerKey === 's' && context.state === 'playing_astrogation') {
    return { kind: 'skipShipBurn', preventDefault: true };
  }

  if (lowerKey === 's' && context.state === 'playing_ordnance') {
    return { kind: 'skipOrdnanceShip', preventDefault: true };
  }

  if (input.key === '0' && context.state === 'playing_combat') {
    return { kind: 'resetCombatStrength', preventDefault: false };
  }

  if (
    lowerKey === 'e' &&
    context.hasGameState &&
    FOCUS_STATES.has(context.state)
  ) {
    return { kind: 'focusNearestEnemy', preventDefault: false };
  }

  if (
    lowerKey === 'h' &&
    context.hasGameState &&
    FOCUS_STATES.has(context.state)
  ) {
    return { kind: 'focusOwnFleet', preventDefault: false };
  }

  if (lowerKey === 'l' && context.hasGameState) {
    return { kind: 'toggleLog', preventDefault: false };
  }

  if (lowerKey === 'w' || input.key === 'ArrowUp') {
    return { kind: 'panCamera', preventDefault: false, dx: 0, dy: 40 };
  }

  if (lowerKey === 's' || input.key === 'ArrowDown') {
    return { kind: 'panCamera', preventDefault: false, dx: 0, dy: -40 };
  }

  if (lowerKey === 'a' || input.key === 'ArrowLeft') {
    return { kind: 'panCamera', preventDefault: false, dx: 40, dy: 0 };
  }

  if (lowerKey === 'd' || input.key === 'ArrowRight') {
    return { kind: 'panCamera', preventDefault: false, dx: -40, dy: 0 };
  }

  if (input.key === '=' || input.key === '+') {
    return { kind: 'zoomCamera', preventDefault: false, factor: 1.15 };
  }

  if (input.key === '-' || input.key === '_') {
    return { kind: 'zoomCamera', preventDefault: false, factor: 0.87 };
  }

  if (input.key === '?' || input.key === '/') {
    return { kind: 'toggleHelp', preventDefault: false };
  }

  if (lowerKey === 'm') {
    return { kind: 'toggleMute', preventDefault: false };
  }

  return createNoopAction();
};
