import { describe, expect, it } from 'vitest';

import { must } from '../../shared/assert';
import { hexKey } from '../../shared/hex';
import { buildSolarSystemMap } from '../../shared/map-data';
import type {
  GameState,
  GravityEffect,
  PlayerState,
  Ship,
} from '../../shared/types/domain';
import {
  buildAstrogationCoursePreviewViews,
  type CoursePreviewPlanningState,
} from './course';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'corvette',
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

const createState = (ships: Ship[]): GameState => ({
  gameId: 'TEST',
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

const createPlanning = (
  overrides: Partial<CoursePreviewPlanningState> = {},
): CoursePreviewPlanningState => ({
  selectedShipId: null,
  burns: new Map(),
  overloads: new Map(),
  weakGravityChoices: new Map(),
  hoverHex: null,
  ...overrides,
});

describe('renderer course helpers', () => {
  it('builds selected preview with burn markers even before a burn is chosen', () => {
    const map = buildSolarSystemMap();
    const state = createState([createShip()]);

    const previews = buildAstrogationCoursePreviewViews(
      state,
      0,
      createPlanning({ selectedShipId: 'ship-0' }),
      map,
      28,
    );

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      shipId: 'ship-0',
      lineColor: '#4fc3f7',
      lineDash: [6, 4],
      ghostShip: { shipType: 'corvette', owner: 0, alpha: 0.4 },
    });
    expect(previews[0].burnMarkers).toHaveLength(6);
    expect(previews[0].overloadMarkers).toHaveLength(0);
    expect(previews[0].fuelCostLabel).toBeNull();
  });

  it('builds overload ring and fuel label for a warship with a declared burn', () => {
    const map = buildSolarSystemMap();
    const state = createState([createShip()]);

    const previews = buildAstrogationCoursePreviewViews(
      state,
      0,
      createPlanning({
        selectedShipId: 'ship-0',
        burns: new Map([['ship-0', 0]]),
      }),
      map,
      28,
    );

    expect(previews[0]).toMatchObject({
      lineDash: [],
      fuelCostLabel: null,
    });
    expect(previews[0].overloadMarkers).toHaveLength(6);
  });

  it('marks weak gravity toggles as ignored when chosen', () => {
    const map = buildSolarSystemMap();
    const weakHex = { q: 10, r: -7 };

    const state = createState([
      createShip({
        position: { q: 9, r: -7 },
        velocity: { dq: 1, dr: 0 },
      }),
    ]);

    const previews = buildAstrogationCoursePreviewViews(
      state,
      0,
      createPlanning({
        selectedShipId: 'ship-0',
        weakGravityChoices: new Map([['ship-0', { [hexKey(weakHex)]: true }]]),
      }),
      map,
      28,
    );

    expect(previews[0].weakGravityMarkers.length).toBeGreaterThan(0);
    expect(previews[0].weakGravityMarkers[0].strikeFrom).not.toBeNull();
    expect(previews[0].weakGravityMarkers[0].strikeTo).not.toBeNull();
  });

  it('builds full gravity arrows from pending gravity effects', () => {
    const map = buildSolarSystemMap();
    const gravityHex = { q: -8, r: -5 };
    const gravity = map.hexes.get(hexKey(gravityHex))?.gravity;

    expect(gravity).toBeDefined();

    const pendingGravity: GravityEffect = {
      hex: gravityHex,
      direction: must(gravity).direction,
      bodyName: 'Mars',
      strength: 'full',
      ignored: false,
    };

    const state = createState([
      createShip({
        position: gravityHex,
        velocity: { dq: 0, dr: -1 },
        pendingGravityEffects: [pendingGravity],
      }),
    ]);

    const previews = buildAstrogationCoursePreviewViews(
      state,
      0,
      createPlanning({ selectedShipId: 'ship-0' }),
      map,
      28,
    );

    expect(previews[0].gravityArrows).toHaveLength(1);
    expect(previews[0].gravityArrows[0]).toMatchObject({
      color: 'rgba(255, 200, 50, 0.6)',
      lineWidth: 1.5,
    });
  });

  it('draws a crash marker when the plotted course impacts a body', () => {
    const map = buildSolarSystemMap();
    const state = createState([
      createShip({
        position: { q: 3, r: 0 },
        velocity: { dq: -3, dr: 0 },
      }),
    ]);

    const previews = buildAstrogationCoursePreviewViews(
      state,
      0,
      createPlanning({ selectedShipId: 'ship-0' }),
      map,
      28,
    );

    expect(previews).toHaveLength(1);
    expect(previews[0].lineColor).toBe('#ff4444');
    expect(previews[0].ghostShip).toBeNull();
    expect(previews[0].crashMarker).not.toBeNull();
  });
});
