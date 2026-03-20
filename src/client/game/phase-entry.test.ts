import { describe, expect, it } from 'vitest';

import type { GameState, Ship } from '../../shared/types';
import { deriveClientStateEntryPlan } from './phase-entry';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-1',
    type: 'packet',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 10,
    cargoUsed: 0,
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

function createState(ships: Ship[]): GameState {
  return {
    gameId: 'LOCAL',
    scenario: 'Bi-Planetary',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 3,
    phase: 'astrogation',
    activePlayer: 0,
    ships,
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: [
      {
        connected: true,
        ready: true,
        targetBody: 'Venus',
        homeBody: 'Mars',
        bases: [],
        escapeWins: false,
      },
      {
        connected: true,
        ready: true,
        targetBody: 'Mars',
        homeBody: 'Venus',
        bases: [],
        escapeWins: false,
      },
    ],
    winner: null,
    winReason: null,
  };
}

describe('game-client-phase-entry', () => {
  it('derives astrogation entry behavior', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_astrogation',
      createState([createShip(), createShip({ id: 'enemy', owner: 1 })]),
      0,
    );

    expect(plan).toMatchObject({
      startTurnTimer: true,
      showHUD: true,
      updateHUD: true,
      clearAstrogationPlanning: true,
      selectedShipId: 'ship-1',
      frameOnShips: true,
      tutorialPhase: 'astrogation',
    });
  });

  it('derives ordnance selection from the first launchable ship', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState([
        createShip({ id: 'empty', cargoUsed: 50 }),
        createShip({ id: 'launchable' }),
      ]),
      0,
    );

    expect(plan.selectedShipId).toBe('launchable');
    expect(plan.tutorialPhase).toBe('ordnance');
  });

  it('returns null selectedShipId when multiple alive ships exist', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_astrogation',
      createState([
        createShip({ id: 'ship-a', owner: 0 }),
        createShip({ id: 'ship-b', owner: 0 }),
        createShip({ id: 'enemy', owner: 1 }),
      ]),
      0,
    );
    expect(plan.selectedShipId).toBeNull();
  });

  it('returns null ordnance selectedShipId when multiple launchable ships exist', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState([
        createShip({ id: 'ship-a', owner: 0 }),
        createShip({ id: 'ship-b', owner: 0 }),
      ]),
      0,
    );
    expect(plan.selectedShipId).toBeNull();
  });

  it('derives combat and movement animation behaviors', () => {
    const state = createState([createShip()]);

    expect(
      deriveClientStateEntryPlan('playing_combat', state, 0),
    ).toMatchObject({
      startTurnTimer: true,
      showHUD: true,
      resetCombatState: true,
      clearAttackButton: true,
      startCombatTargetWatch: true,
      tutorialPhase: 'combat',
    });

    expect(
      deriveClientStateEntryPlan('playing_movementAnim', state, 0),
    ).toMatchObject({
      stopTurnTimer: true,
      showHUD: true,
      showMovementStatus: true,
      hideTutorial: true,
    });
  });

  it('derives menu, opponent-turn, and game-over behaviors', () => {
    const state = createState([createShip()]);

    expect(deriveClientStateEntryPlan('menu', state, 0)).toMatchObject({
      hideTutorial: true,
      resetCamera: true,
    });
    expect(
      deriveClientStateEntryPlan('playing_opponentTurn', state, 0),
    ).toMatchObject({
      stopTurnTimer: true,
      showHUD: true,
      updateHUD: true,
      frameOnShips: true,
    });
    expect(deriveClientStateEntryPlan('gameOver', state, 0)).toMatchObject({
      stopTurnTimer: true,
      hideTutorial: true,
    });
  });
});
