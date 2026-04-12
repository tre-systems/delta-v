import { describe, expect, it } from 'vitest';

import { deriveKeyboardAction, type KeyboardShortcutContext } from './keyboard';
import type { ClientState } from './phase';

const createContext = (
  overrides: Partial<KeyboardShortcutContext> = {},
): KeyboardShortcutContext => {
  return {
    state: 'menu',
    hasGameState: false,
    typingInInput: false,
    combatTargetId: null,
    queuedAttackCount: 0,
    torpedoAccelActive: false,
    torpedoAimingActive: false,
    allShipsAcknowledged: false,
    allOrdnanceShipsAcknowledged: false,
    hasSelectedShip: false,
    ...overrides,
  };
};

const actionFor = (
  key: string,
  overrides: Partial<KeyboardShortcutContext> = {},
  shiftKey = false,
) => {
  return deriveKeyboardAction(createContext(overrides), { key, shiftKey });
};

describe('game-client-keyboard', () => {
  it('ignores shortcuts while typing in an input', () => {
    expect(
      actionFor('Enter', {
        typingInInput: true,
        state: 'playing_astrogation',
      }),
    ).toEqual({
      kind: 'none',
      preventDefault: false,
    });
  });

  it('cycles ships with tab in playable ship-selection states', () => {
    const states: ClientState[] = [
      'playing_astrogation',
      'playing_ordnance',
      'playing_combat',
    ];

    for (const state of states) {
      expect(actionFor('Tab', { state, hasGameState: true })).toEqual({
        kind: 'cycleShip',
        preventDefault: true,
        direction: 1,
      });

      expect(actionFor('Tab', { state, hasGameState: true }, true)).toEqual({
        kind: 'cycleShip',
        preventDefault: true,
        direction: -1,
      });
    }
  });

  it('prioritizes combat target, queued attacks, and torpedo cancel on escape', () => {
    expect(actionFor('Escape', { combatTargetId: 'enemy-1' })).toEqual({
      kind: 'clearCombatSelection',
      preventDefault: false,
    });

    expect(actionFor('Escape', { queuedAttackCount: 2 })).toEqual({
      kind: 'undoQueuedAttack',
      preventDefault: false,
    });

    expect(actionFor('Escape', { torpedoAccelActive: true })).toEqual({
      kind: 'clearTorpedoAcceleration',
      preventDefault: false,
    });

    expect(actionFor('Escape', { torpedoAimingActive: true })).toEqual({
      kind: 'clearTorpedoAcceleration',
      preventDefault: false,
    });

    expect(actionFor('Escape')).toEqual({
      kind: 'deselectShip',
      preventDefault: false,
    });
  });

  it('routes enter and space by phase', () => {
    expect(
      actionFor('Enter', {
        state: 'playing_astrogation',
        allShipsAcknowledged: true,
      }),
    ).toEqual({
      kind: 'confirmOrders',
      preventDefault: true,
    });

    expect(
      actionFor('Enter', {
        state: 'playing_astrogation',
        hasSelectedShip: true,
      }),
    ).toEqual({
      kind: 'skipShipBurn',
      preventDefault: true,
    });

    expect(
      actionFor(' ', {
        state: 'playing_ordnance',
        allOrdnanceShipsAcknowledged: true,
      }),
    ).toEqual({
      kind: 'confirmOrdnance',
      preventDefault: true,
    });

    expect(
      actionFor('Enter', {
        state: 'playing_combat',
        combatTargetId: 'enemy-1',
      }),
    ).toEqual({
      kind: 'confirmSingleAttack',
      preventDefault: true,
    });

    expect(actionFor('Enter', { state: 'playing_combat' })).toEqual({
      kind: 'endCombat',
      preventDefault: true,
    });
  });

  it('routes phase-specific hotkeys for ordnance, burn selection, and combat strength', () => {
    expect(actionFor('n', { state: 'playing_ordnance' })).toEqual({
      kind: 'launchOrdnance',
      preventDefault: false,
      ordnanceType: 'mine',
    });

    expect(actionFor('5', { state: 'playing_astrogation' })).toEqual({
      kind: 'setBurnDirection',
      preventDefault: false,
      direction: 4,
    });

    expect(actionFor('0', { state: 'playing_astrogation' })).toEqual({
      kind: 'clearSelectedBurn',
      preventDefault: false,
    });

    expect(actionFor('0', { state: 'playing_combat' })).toEqual({
      kind: 'resetCombatStrength',
      preventDefault: false,
    });

    expect(actionFor('+', { state: 'playing_combat' })).toEqual({
      kind: 'adjustCombatStrength',
      preventDefault: true,
      delta: 1,
    });

    expect(actionFor('-', { state: 'playing_combat' })).toEqual({
      kind: 'adjustCombatStrength',
      preventDefault: true,
      delta: -1,
    });
  });

  it('gates focus and log shortcuts on game state presence', () => {
    expect(
      actionFor('e', {
        state: 'playing_ordnance',
        hasGameState: true,
      }),
    ).toEqual({
      kind: 'focusNearestEnemy',
      preventDefault: false,
    });

    expect(
      actionFor('h', {
        state: 'playing_opponentTurn',
        hasGameState: true,
      }),
    ).toEqual({
      kind: 'focusOwnFleet',
      preventDefault: false,
    });

    expect(actionFor('l', { hasGameState: true })).toEqual({
      kind: 'toggleLog',
      preventDefault: false,
    });

    expect(actionFor('l')).toEqual({
      kind: 'none',
      preventDefault: false,
    });
  });

  it('keeps movement, zoom, help, and mute shortcuts available globally', () => {
    expect(actionFor('w')).toEqual({
      kind: 'panCamera',
      preventDefault: false,
      dx: 0,
      dy: 40,
    });

    expect(actionFor('ArrowLeft')).toEqual({
      kind: 'panCamera',
      preventDefault: false,
      dx: 40,
      dy: 0,
    });

    expect(actionFor('+')).toEqual({
      kind: 'zoomCamera',
      preventDefault: false,
      factor: 1.15,
    });

    expect(actionFor('/')).toEqual({
      kind: 'toggleHelp',
      preventDefault: false,
    });

    expect(actionFor('m')).toEqual({
      kind: 'toggleMute',
      preventDefault: false,
    });
  });
});
