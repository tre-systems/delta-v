import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type { GameState, Ship } from '../../shared/types/domain';
import {
  buildShipLabelView,
  getDetonatedOrdnanceOverlay,
  getDisabledShipLabel,
  getOrdnanceLifetimeView,
  getShipHeading,
  getShipIdentityMarker,
  getShipStackOffsets,
  getVisibleShips,
  shouldShowOrbitIndicator,
} from './entities';

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

const createState = (ships: Ship[]): GameState => ({
  gameId: asGameId('LOCAL'),
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
  players: [
    {
      connected: true,
      ready: true,
      targetBody: 'Mars',
      homeBody: 'Venus',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Venus',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
});

describe('renderer entity helpers', () => {
  it('filters visible ships by ownership, detection, and animation state', () => {
    const state = createState([
      createShip({ id: asShipId('mine'), owner: 0, detected: false }),
      createShip({ id: asShipId('enemy-visible'), owner: 1, detected: true }),
      createShip({ id: asShipId('enemy-hidden'), owner: 1, detected: false }),
      createShip({
        id: asShipId('destroyed'),
        owner: 0,
        lifecycle: 'destroyed',
      }),
    ]);

    expect(getVisibleShips(state, 0, false).map((ship) => ship.id)).toEqual([
      'mine',
      'enemy-visible',
    ]);

    expect(getVisibleShips(state, 0, true).map((ship) => ship.id)).toEqual([
      'mine',
      'enemy-visible',
      'destroyed',
    ]);
  });

  it('builds stack offsets for ships sharing a hex', () => {
    const offsets = getShipStackOffsets([
      createShip({ id: asShipId('a') }),
      createShip({ id: asShipId('b') }),
      createShip({ id: asShipId('c') }),
    ]);

    expect(offsets.get('a')).toEqual({ xOffset: -16, labelYOffset: 24 });
    expect(offsets.get('b')).toEqual({ xOffset: 0, labelYOffset: 35 });
    expect(offsets.get('c')).toEqual({ xOffset: 16, labelYOffset: 46 });
  });

  it('builds owner and enemy ship labels with orbit status', () => {
    expect(
      buildShipLabelView(
        createShip({ velocity: { dq: 1, dr: 0 } }),
        0,
        true,
        false,
      ),
    ).toMatchObject({
      typeName: 'Packet',
      statusTag: 'Orbit',
      typeColor: 'rgba(255, 255, 255, 0.7)',
    });

    expect(
      buildShipLabelView(
        createShip({ owner: 1, detected: true }),
        0,
        false,
        false,
      ),
    ).toMatchObject({
      typeName: 'Enemy Packet',
      typeColor: 'rgba(255, 140, 100, 0.7)',
      statusTag: null,
    });
  });

  it('derives ship markers and disabled status labels', () => {
    expect(
      getShipIdentityMarker(
        createShip({
          identity: { hasFugitives: true, revealed: false },
        }),
        0,
        true,
        false,
      ),
    ).toBe('friendlyFugitive');

    expect(
      getShipIdentityMarker(
        createShip({
          owner: 1,
          originalOwner: 0,
          identity: { hasFugitives: true, revealed: true },
        }),
        0,
        true,
        false,
      ),
    ).toBe('enemyFugitive');

    expect(
      getShipIdentityMarker(
        createShip({
          owner: 1,
          originalOwner: 0,
          identity: { hasFugitives: false, revealed: true },
        }),
        0,
        true,
        false,
      ),
    ).toBe('enemyDecoy');

    expect(
      getDisabledShipLabel(createShip({ damage: { disabledTurns: 3 } }), false),
    ).toBe('DISABLED: 3T');
  });

  it('derives orbit, heading, and ordnance overlays', () => {
    expect(
      shouldShowOrbitIndicator(
        createShip({ velocity: { dq: 1, dr: 0 } }),
        true,
        false,
      ),
    ).toBe(true);

    expect(getShipHeading({ q: 0, r: 0 }, { dq: 1, dr: 0 }, 28)).toBeCloseTo(
      Math.PI / 6,
      4,
    );

    expect(getOrdnanceLifetimeView(1, false)).toEqual({
      text: '1',
      color: 'rgba(255, 80, 80, 0.9)',
    });

    expect(getDetonatedOrdnanceOverlay(0.5)).toEqual({
      kind: 'diamond',
      size: 4,
      color: '#ff4444',
      alpha: 0.7,
    });

    expect(getDetonatedOrdnanceOverlay(0.95)).toMatchObject({
      kind: 'flash',
      color: '#ffaa00',
      alpha: 0.8,
    });
  });
});
