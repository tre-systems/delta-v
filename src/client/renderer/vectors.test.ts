import { describe, expect, it } from 'vitest';
import type { HexKey } from '../../shared/hex';
import { asHexKey } from '../../shared/hex';
import type {
  GameState,
  MapHex,
  Ship,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  buildDetectionRangeViews,
  buildMovementPathViews,
  buildOrdnanceTrailViews,
  buildShipTrailViews,
  buildVelocityVectorViews,
} from './vectors';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-1',
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

const createState = (): GameState => ({
  gameId: 'LOCAL',
  scenario: 'Bi-Planetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip({
      id: 'selected',
      owner: 0,
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
    }),
    createShip({
      id: 'enemy-visible',
      owner: 1,
      position: { q: 2, r: -1 },
      velocity: { dq: 0, dr: 1 },
      detected: true,
    }),
    createShip({
      id: 'enemy-hidden',
      owner: 1,
      position: { q: 3, r: -2 },
      velocity: { dq: 1, dr: -1 },
      detected: false,
    }),
  ],
  ordnance: [
    {
      id: 'mine-1',
      type: 'mine',
      owner: 0,
      sourceShipId: null,
      position: { q: 1, r: 1 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 3,
      lifecycle: 'active' as const,
    },
  ],
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
      bases: [asHexKey('0,1')],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Venus',
      homeBody: 'Mars',
      bases: [asHexKey('2,2')],
      escapeWins: false,
    },
  ],
  outcome: null,
});

const createMap = (): SolarSystemMap => ({
  hexes: new Map<HexKey, MapHex>([
    [
      asHexKey('0,1'),
      {
        terrain: 'space',
        base: { name: 'Mars Base', bodyName: 'Mars' },
      },
    ],
    [
      asHexKey('2,2'),
      {
        terrain: 'space',
        base: { name: 'Venus Base', bodyName: 'Venus' },
      },
    ],
  ]),
  bodies: [],
  bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
});

describe('renderer vector helpers', () => {
  it('builds selected ship and base detection overlays', () => {
    const views = buildDetectionRangeViews(
      createState(),
      0,
      'selected',
      createMap(),
      28,
    );

    expect(views).toHaveLength(2);

    expect(views[0]).toMatchObject({
      color: 'rgba(79, 195, 247, 0.08)',
      lineDash: [4, 6],
    });

    expect(views[1]).toMatchObject({
      color: 'rgba(79, 195, 247, 0.05)',
      lineDash: [3, 8],
    });
  });

  it('builds velocity vectors for visible moving ships only', () => {
    const views = buildVelocityVectorViews(createState(), 0, 28);

    expect(views).toHaveLength(2);

    expect(views[0]).toMatchObject({
      color: 'rgba(79, 195, 247, 0.22)',
      lineDash: [4, 4],
      speedLabel: null,
    });

    expect(views[1].speedLabel).toMatchObject({
      text: 'v1',
      color: 'rgba(255, 152, 0, 0.25)',
    });
  });

  it('builds visible ship and ordnance trails', () => {
    const state = createState();

    const shipTrails = new Map([
      [
        'selected',
        [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
      ],
      [
        'enemy-visible',
        [
          { q: 2, r: -1 },
          { q: 3, r: -1 },
        ],
      ],
      [
        'enemy-hidden',
        [
          { q: 3, r: -2 },
          { q: 4, r: -2 },
        ],
      ],
    ]);

    const ordnanceTrails = new Map([
      [
        'mine-1',
        [
          { q: 1, r: 1 },
          { q: 2, r: 1 },
        ],
      ],
      [
        'gone',
        [
          { q: 5, r: 5 },
          { q: 6, r: 5 },
        ],
      ],
    ]);

    const shipViews = buildShipTrailViews(state, 0, shipTrails, 28);
    const ordViews = buildOrdnanceTrailViews(state, 0, ordnanceTrails, 28);

    expect(shipViews).toHaveLength(2);
    expect(shipViews.map((view) => view.lineColor)).toEqual([
      'rgba(79, 195, 247, 0.06)',
      'rgba(255, 152, 0, 0.06)',
    ]);

    expect(ordViews).toHaveLength(2);
    expect(ordViews[0]).toMatchObject({
      lineDash: [2, 4],
      lineColor: 'rgba(79, 195, 247, 0.04)',
    });
    expect(ordViews[1].lineColor).toBe('rgba(255, 152, 0, 0.04)');
  });

  it('builds movement path views and passed waypoints from progress', () => {
    const movement: ShipMovement = {
      shipId: 'selected',
      from: { q: 0, r: 0 },
      to: { q: 2, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
      newVelocity: { dq: 1, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      outcome: 'normal',
    };

    const views = buildMovementPathViews(
      createState(),
      0,
      [movement],
      0.75,
      28,
    );

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      color: 'rgba(79, 195, 247, 0.22)',
      lineDash: [3, 5],
    });
    expect(views[0].passedWaypoints).toHaveLength(1);
  });
});
