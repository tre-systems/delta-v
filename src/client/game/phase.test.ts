import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { derivePhaseTransition } from './phase';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'transport',
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

const createPlayers = (): [PlayerState, PlayerState] => [
  {
    connected: true,
    ready: true,
    targetBody: '',
    homeBody: 'Terra',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: '',
    homeBody: 'Mars',
    bases: [],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'TEST',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 2,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: 'ship-1', owner: 1 })],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  outcome: null,
  ...overrides,
});

describe('derivePhaseTransition', () => {
  it('logs and transitions into the local player astrogation turn', () => {
    const state = createState({
      phase: 'astrogation',
      activePlayer: 0,
      turnNumber: 3,
    });

    expect(derivePhaseTransition(state, 0, 2, false)).toEqual({
      nextState: 'playing_astrogation',
      banner: 'YOUR TURN',
      playPhaseSound: true,
      beginCombatPhase: false,
      runLocalAI: false,
      turnLogNumber: 3,
      turnLogPlayerLabel: 'You',
    });
  });

  it('waits during simultaneous fleet building when the player is already ready', () => {
    const players = createPlayers();
    players[0].ready = true;

    const state = createState({
      phase: 'fleetBuilding',
      players,
    });

    expect(derivePhaseTransition(state, 0, 2, false).nextState).toBeNull();
  });

  it('begins combat resolution immediately when asteroid hazards are pending for the active player', () => {
    const state = createState({
      phase: 'combat',
      activePlayer: 0,
      pendingAsteroidHazards: [{ shipId: 'ship-0', hex: { q: 1, r: 1 } }],
    });

    expect(derivePhaseTransition(state, 0, 2, false)).toMatchObject({
      nextState: null,
      beginCombatPhase: true,
      playPhaseSound: false,
    });
  });

  it('schedules the AI when it becomes the opponent turn in a local game', () => {
    const state = createState({
      phase: 'ordnance',
      activePlayer: 1,
    });

    expect(derivePhaseTransition(state, 0, 2, true)).toMatchObject({
      nextState: 'playing_opponentTurn',
      runLocalAI: true,
    });
  });

  it('routes negative player ids through spectator-safe phase transitions', () => {
    const players = createPlayers();
    players[0].ready = true;
    const fleet = createState({
      phase: 'fleetBuilding',
      players,
    });

    expect(derivePhaseTransition(fleet, -1, 2, false).nextState).toBe(
      'playing_fleetBuilding',
    );

    const ordnance = createState({
      phase: 'ordnance',
      activePlayer: 0,
    });

    expect(derivePhaseTransition(ordnance, -1, 2, false)).toMatchObject({
      nextState: 'playing_opponentTurn',
      beginCombatPhase: false,
      runLocalAI: false,
    });
  });
});
