import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../ids';
import type { GameState, Ship, SolarSystemMap } from '../types';
import { resolveMovementPhase } from './resolve-movement';

const openMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -50, maxQ: 50, minR: -50, maxR: 50 },
};

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  nukesLaunchedSinceResupply: 0,
  detected: true,
  damage: { disabledTurns: 0 },
  pendingGravityEffects: [],
  ...overrides,
});

const makeState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('TEST'),
  scenario: 'grandTour',
  // combatDisabled forces the engine to resolve movement immediately
  // rather than queue up an ordnance phase, so the test can assert
  // post-movement state in one call.
  scenarioRules: { combatDisabled: true },
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [makeShip()],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Venus',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
  ...overrides,
});

describe('resolveMovementPhase: disabled-ship burn suppression', () => {
  it('flags burnCancelledByDisable on the movement when a disabled ship queued a burn', () => {
    const state = makeState({
      ships: [makeShip({ damage: { disabledTurns: 2 } })],
    });
    state.pendingAstrogationOrders = [
      { shipId: asShipId('ship0'), burn: 0, overload: null },
    ];
    const result = resolveMovementPhase(state, 0, openMap, Math.random);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].burnCancelledByDisable).toBe(true);
    // The burn must have been silently nulled: ship drifts with 0 fuel
    // spent rather than accelerating in the queued direction.
    expect(result.movements[0].fuelSpent).toBe(0);
  });

  it('does not set burnCancelledByDisable when a disabled ship queued a null burn', () => {
    const state = makeState({
      ships: [makeShip({ damage: { disabledTurns: 1 } })],
    });
    state.pendingAstrogationOrders = [
      { shipId: asShipId('ship0'), burn: null, overload: null },
    ];
    const result = resolveMovementPhase(state, 0, openMap, Math.random);
    expect(result.movements[0].burnCancelledByDisable).toBeUndefined();
  });

  it('does not set burnCancelledByDisable for a healthy ship whose burn lands', () => {
    const state = makeState();
    state.pendingAstrogationOrders = [
      { shipId: asShipId('ship0'), burn: 0, overload: null },
    ];
    const result = resolveMovementPhase(state, 0, openMap, Math.random);
    expect(result.movements[0].burnCancelledByDisable).toBeUndefined();
    expect(result.movements[0].fuelSpent).toBe(1);
  });
});
