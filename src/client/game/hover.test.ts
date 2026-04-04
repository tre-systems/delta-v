import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { getTooltipShip } from './hover';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 5,
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
    targetBody: 'Mars',
    homeBody: 'Terra',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: 'Terra',
    homeBody: 'Mars',
    bases: [],
    escapeWins: false,
  },
];

const createState = (ships: Ship[]): GameState => ({
  gameId: asGameId('HOVER'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships,
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  outcome: null,
});

describe('game-client-hover', () => {
  it('hides tooltips when no state is available or the client state suppresses hover', () => {
    expect(
      getTooltipShip(null, 'playing_astrogation', 0, { q: 0, r: 0 }),
    ).toBeNull();

    expect(
      getTooltipShip(createState([createShip()]), 'menu', 0, { q: 0, r: 0 }),
    ).toBeNull();

    expect(
      getTooltipShip(createState([createShip()]), 'playing_movementAnim', 0, {
        q: 0,
        r: 0,
      }),
    ).toBeNull();
  });

  it('returns visible friendly and detected enemy ships at the hover hex', () => {
    const friendly = createShip();
    const enemy = createShip({
      id: asShipId('enemy'),
      owner: 1,
      originalOwner: 0,
      position: { q: 1, r: 0 },
    });
    const state = createState([friendly, enemy]);

    expect(
      getTooltipShip(state, 'playing_astrogation', 0, { q: 0, r: 0 })?.id,
    ).toBe('ship-0');

    expect(getTooltipShip(state, 'playing_combat', 0, { q: 1, r: 0 })?.id).toBe(
      'enemy',
    );
  });

  it('ignores destroyed and undetected enemy ships', () => {
    const destroyed = createShip({ lifecycle: 'destroyed' });
    const hiddenEnemy = createShip({
      id: asShipId('enemy'),
      owner: 1,
      originalOwner: 0,
      detected: false,
      position: { q: 1, r: 0 },
    });
    const state = createState([destroyed, hiddenEnemy]);

    expect(
      getTooltipShip(state, 'playing_astrogation', 0, { q: 0, r: 0 }),
    ).toBeNull();

    expect(
      getTooltipShip(state, 'playing_astrogation', 0, { q: 1, r: 0 }),
    ).toBeNull();
  });
});
