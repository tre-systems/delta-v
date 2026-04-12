import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameState, Ship } from '../../shared/types/domain';
import { deriveClientStateEntryPlan } from './phase-entry';

const map = buildSolarSystemMap();

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-1'),
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createState = (
  ships: Ship[],
  overrides: Partial<GameState> = {},
): GameState => ({
  gameId: asGameId('LOCAL'),
  scenario: 'biplanetary',
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
  outcome: null,
  ...overrides,
});

describe('game-client-phase-entry', () => {
  it('derives astrogation entry behavior', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_astrogation',
      createState([
        createShip(),
        createShip({ id: asShipId('enemy'), owner: 1 }),
      ]),
      0,
    );

    expect(plan).toMatchObject({
      startTurnTimer: true,
      frameOnShips: true,
      tutorialPhase: 'astrogation',
    });
    expect(plan.planningPhaseEntry).toEqual({
      phase: 'astrogation',
      selectedShipId: 'ship-1',
    });
  });

  it('derives ordnance selection from the first launchable ship', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState(
        [
          createShip({
            id: asShipId('restricted'),
            type: 'corsair',
          }),
          createShip({ id: asShipId('launchable'), type: 'packet' }),
        ],
        { scenarioRules: { allowedOrdnanceTypes: ['nuke'] } },
      ),
      0,
    );

    expect(plan.planningPhaseEntry?.selectedShipId).toBe('launchable');
    expect(plan.tutorialPhase).toBe('ordnance');
  });

  it('returns null ordnance selection when no ship can launch the allowed types', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState(
        [
          createShip({
            id: asShipId('restricted'),
            type: 'corsair',
          }),
        ],
        { scenarioRules: { allowedOrdnanceTypes: ['nuke'] } },
      ),
      0,
    );

    expect(plan.planningPhaseEntry?.selectedShipId).toBeNull();
  });

  it('selects a carrying-base ship when ordnance phase is for emplacement only', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState([
        createShip({
          id: asShipId('base-carrier'),
          type: 'transport',
          position: { q: -9, r: -6 },
          velocity: { dq: 1, dr: 0 },
          cargoUsed: 50,
          baseStatus: 'carryingBase',
        }),
      ]),
      0,
      false,
      map,
    );

    expect(plan.planningPhaseEntry?.selectedShipId).toBe('base-carrier');
  });

  it('skips invalid base carriers when choosing ordnance entry selection', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState([
        createShip({
          id: asShipId('invalid-base-carrier'),
          type: 'transport',
          cargoUsed: 50,
          baseStatus: 'carryingBase',
        }),
        createShip({
          id: asShipId('valid-base-carrier'),
          type: 'transport',
          position: { q: -9, r: -6 },
          velocity: { dq: 1, dr: 0 },
          cargoUsed: 50,
          baseStatus: 'carryingBase',
        }),
      ]),
      0,
      false,
      map,
    );

    expect(plan.planningPhaseEntry?.selectedShipId).toBe('valid-base-carrier');
  });

  it('auto-selects the first actionable ship when multiple alive ships exist', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_astrogation',
      createState([
        createShip({ id: asShipId('ship-a'), owner: 0 }),
        createShip({ id: asShipId('ship-b'), owner: 0 }),
        createShip({ id: asShipId('enemy'), owner: 1 }),
      ]),
      0,
    );

    expect(plan.planningPhaseEntry?.selectedShipId).toBe('ship-a');
  });

  it('does not start the turn timer for local astrogation games', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_astrogation',
      createState([createShip()]),
      0,
      true,
    );

    expect(plan.startTurnTimer).toBe(false);
  });

  it('returns first launchable ordnance selectedShipId when multiple ships exist', () => {
    const plan = deriveClientStateEntryPlan(
      'playing_ordnance',
      createState([
        createShip({ id: asShipId('ship-a'), owner: 0 }),
        createShip({ id: asShipId('ship-b'), owner: 0 }),
      ]),
      0,
    );

    expect(plan.planningPhaseEntry?.selectedShipId).toBe('ship-a');
  });

  it('derives combat and movement animation behaviors', () => {
    const state = createState([createShip()]);

    expect(
      deriveClientStateEntryPlan('playing_combat', state, 0),
    ).toMatchObject({
      startTurnTimer: true,
      autoSkipCombatIfNoTargets: true,
      tutorialPhase: 'combat',
    });
    expect(
      deriveClientStateEntryPlan('playing_combat', state, 0),
    ).toMatchObject({
      planningPhaseEntry: {
        phase: 'combat',
        selectedShipId: 'ship-1',
      },
    });

    expect(
      deriveClientStateEntryPlan('playing_movementAnim', state, 0),
    ).toMatchObject({
      stopTurnTimer: true,

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

      frameOnShips: true,
    });

    expect(deriveClientStateEntryPlan('gameOver', state, 0)).toMatchObject({
      stopTurnTimer: true,
      hideTutorial: true,
    });
  });
});
