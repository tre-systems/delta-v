import { describe, expect, it } from 'vitest';

import type {
  GameState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { createMinimapLayout } from '../game/minimap';
import { buildMinimapSceneView } from './minimap';

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

const createMap = (): SolarSystemMap => ({
  hexes: new Map(),
  bodies: [
    {
      name: 'Mars',
      center: { q: 0, r: 0 },
      surfaceRadius: 0,
      color: '#cc4422',
      renderRadius: 0.7,
    },
    {
      name: 'Jupiter',
      center: { q: 8, r: -8 },
      surfaceRadius: 2,
      color: '#cc9966',
      renderRadius: 2.8,
    },
  ],
  bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
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
      id: 'friendly',
      owner: 0,
      position: { q: 0, r: 0 },
    }),
    createShip({
      id: 'enemy-visible',
      owner: 1,
      position: { q: 2, r: -1 },
      detected: true,
    }),
    createShip({
      id: 'enemy-hidden',
      owner: 1,
      position: { q: 3, r: -2 },
      detected: false,
    }),
    createShip({
      id: 'destroyed',
      owner: 0,
      lifecycle: 'destroyed',
    }),
  ],
  ordnance: [
    {
      id: 'nuke',
      type: 'nuke',
      owner: 0,
      sourceShipId: null,
      position: { q: 1, r: 1 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 2,
      lifecycle: 'active' as const,
    },
    {
      id: 'mine',
      type: 'mine',
      owner: 1,
      sourceShipId: null,
      position: { q: 2, r: 2 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 3,
      lifecycle: 'active' as const,
    },
    {
      id: 'gone',
      type: 'torpedo',
      owner: 1,
      sourceShipId: null,
      position: { q: 3, r: 3 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 1,
      lifecycle: 'destroyed' as const,
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

describe('renderer minimap helpers', () => {
  it('builds minimap scene with visible ships, trails, ordnance, and viewport', () => {
    const map = createMap();
    const state = createState();
    const layout = createMinimapLayout(map.bounds, 1200, 800, 28);

    const shipTrails = new Map([
      [
        'friendly',
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

    const scene = buildMinimapSceneView(
      map,
      state,
      0,
      shipTrails,
      layout,
      { x: 0, y: 0, zoom: 1.5 },
      1200,
      800,
      28,
      null,
    );

    expect(scene.bodies).toHaveLength(2);
    expect(scene.bodies[0]).toMatchObject({
      color: '#cc4422',
      alpha: 0.7,
    });
    expect(scene.bodies[0].radius).toBeGreaterThanOrEqual(2);

    expect(scene.shipTrails).toHaveLength(2);
    expect(scene.shipTrails[0].color).toBe('rgba(79, 195, 247, 0.14)');
    expect(scene.shipTrails[1].color).toBe('rgba(255, 138, 101, 0.14)');

    expect(scene.ships).toHaveLength(2);
    expect(scene.ships.map((dot) => dot.color)).toEqual(['#4fc3f7', '#ff8a65']);

    expect(scene.ordnance).toHaveLength(2);
    expect(scene.ordnance.map((dot) => dot.color)).toEqual([
      '#ff4444',
      '#ffb74d',
    ]);

    expect(scene.viewport).not.toBeNull();
    expect(scene.viewport?.width).toBeGreaterThan(2);
    expect(scene.viewport?.height).toBeGreaterThan(2);
  });

  it('adds objective bearing from the selected ship toward the target body', () => {
    const map = createMap();
    const state = createState();
    state.ships[0].position = { q: 6, r: -2 };

    const layout = createMinimapLayout(map.bounds, 1200, 800, 28);

    const scene = buildMinimapSceneView(
      map,
      state,
      0,
      new Map(),
      layout,
      { x: 0, y: 0, zoom: 1.5 },
      1200,
      800,
      28,
      'friendly',
    );

    expect(scene.objectiveBearing).not.toBeNull();
    expect(scene.objectiveBearing?.from.x).not.toBe(
      scene.objectiveBearing?.to.x,
    );
  });

  it('returns no viewport when the clipped view would be too small', () => {
    const map = createMap();
    const state = createState();
    const layout = createMinimapLayout(map.bounds, 1200, 800, 28);

    const scene = buildMinimapSceneView(
      map,
      state,
      0,
      new Map(),
      layout,
      { x: 0, y: 0, zoom: 1000 },
      1,
      1,
      28,
      null,
    );

    expect(scene.viewport).toBeNull();
    expect(scene.objectiveBearing).toBeNull();
  });
});
