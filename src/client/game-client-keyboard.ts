import type { ClientState } from './game-client-phase';

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
  combatTargetId: string | null;
  queuedAttackCount: number;
  torpedoAccelActive: boolean;
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
  | { kind: 'skipCombat'; preventDefault: true }
  | { kind: 'adjustCombatStrength'; preventDefault: true; delta: -1 | 1 }
  | { kind: 'launchOrdnance'; preventDefault: false; ordnanceType: 'mine' | 'torpedo' | 'nuke' }
  | { kind: 'setBurnDirection'; preventDefault: false; direction: number }
  | { kind: 'clearSelectedBurn'; preventDefault: false }
  | { kind: 'resetCombatStrength'; preventDefault: false }
  | { kind: 'focusNearestEnemy'; preventDefault: false }
  | { kind: 'focusOwnFleet'; preventDefault: false }
  | { kind: 'toggleLog'; preventDefault: false }
  | { kind: 'panCamera'; preventDefault: false; dx: number; dy: number }
  | { kind: 'zoomCamera'; preventDefault: false; factor: number }
  | { kind: 'toggleHelp'; preventDefault: false }
  | { kind: 'toggleMute'; preventDefault: false };

function createNoopAction(): KeyboardAction {
  return { kind: 'none', preventDefault: false };
}

export function deriveKeyboardAction(
  context: KeyboardShortcutContext,
  input: KeyboardShortcutInput,
): KeyboardAction {
  if (context.typingInInput) {
    return createNoopAction();
  }

  if (input.key === 'Tab' && context.hasGameState && SHIP_SELECTION_STATES.has(context.state)) {
    return {
      kind: 'cycleShip',
      preventDefault: true,
      direction: input.shiftKey ? -1 : 1,
    };
  }

  if (input.key === 'Escape') {
    if (context.combatTargetId) {
      return { kind: 'clearCombatSelection', preventDefault: false };
    }
    if (context.queuedAttackCount > 0) {
      return { kind: 'undoQueuedAttack', preventDefault: false };
    }
    if (context.torpedoAccelActive) {
      return { kind: 'clearTorpedoAcceleration', preventDefault: false };
    }
    return { kind: 'deselectShip', preventDefault: false };
  }

  if (input.key === 'Enter' || input.key === ' ') {
    if (context.state === 'playing_astrogation') {
      return { kind: 'confirmOrders', preventDefault: true };
    }
    if (context.state === 'playing_ordnance') {
      return { kind: 'skipOrdnance', preventDefault: true };
    }
    if (context.state === 'playing_combat') {
      if (context.combatTargetId) {
        return { kind: 'queueAttack', preventDefault: true };
      }
      if (context.queuedAttackCount > 0) {
        return { kind: 'fireAllAttacks', preventDefault: true };
      }
      return { kind: 'skipCombat', preventDefault: true };
    }
  }

  if ((input.key === '-' || input.key === '_') && context.state === 'playing_combat') {
    return { kind: 'adjustCombatStrength', preventDefault: true, delta: -1 };
  }

  if ((input.key === '=' || input.key === '+') && context.state === 'playing_combat') {
    return { kind: 'adjustCombatStrength', preventDefault: true, delta: 1 };
  }

  const lowerKey = input.key.toLowerCase();
  if (lowerKey === 'n' && context.state === 'playing_ordnance') {
    return { kind: 'launchOrdnance', preventDefault: false, ordnanceType: 'mine' };
  }
  if (lowerKey === 't' && context.state === 'playing_ordnance') {
    return { kind: 'launchOrdnance', preventDefault: false, ordnanceType: 'torpedo' };
  }
  if (lowerKey === 'k' && context.state === 'playing_ordnance') {
    return { kind: 'launchOrdnance', preventDefault: false, ordnanceType: 'nuke' };
  }

  if (input.key >= '1' && input.key <= '6' && context.state === 'playing_astrogation') {
    return {
      kind: 'setBurnDirection',
      preventDefault: false,
      direction: Number.parseInt(input.key, 10) - 1,
    };
  }

  if (input.key === '0' && context.state === 'playing_astrogation') {
    return { kind: 'clearSelectedBurn', preventDefault: false };
  }

  if (input.key === '0' && context.state === 'playing_combat') {
    return { kind: 'resetCombatStrength', preventDefault: false };
  }

  if (lowerKey === 'e' && context.hasGameState && FOCUS_STATES.has(context.state)) {
    return { kind: 'focusNearestEnemy', preventDefault: false };
  }

  if (lowerKey === 'h' && context.hasGameState && FOCUS_STATES.has(context.state)) {
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
}
