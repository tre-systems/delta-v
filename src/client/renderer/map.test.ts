import { describe, expect, it } from 'vitest';

import { asHexKey } from '../../shared/hex';
import { asGameId } from '../../shared/ids';
import type {
  GameState,
  PlayerState,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  buildAsteroidDebrisView,
  buildBaseMarkerView,
  buildBodyView,
  buildCheckpointMarkerViews,
  buildLandingObjectiveView,
  buildMapBorderView,
  lightenColor,
} from './map';

const createPlayer = (overrides: Partial<PlayerState> = {}): PlayerState => {
  return {
    connected: true,
    ready: true,
    targetBody: 'Mars',
    homeBody: 'Venus',
    bases: [],
    escapeWins: false,
    ...overrides,
  };
};

const createState = (): GameState => {
  return {
    gameId: asGameId('LOCAL'),
    scenario: 'biplanetary',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships: [],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: [
      createPlayer({ bases: [asHexKey('mars-base')] }),
      createPlayer({ bases: [asHexKey('venus-base')] }),
    ],
    outcome: null,
  };
};

const createMap = (): SolarSystemMap => {
  return {
    hexes: new Map(),
    bodies: [
      {
        name: 'Mars',
        center: { q: -1, r: -2 },
        surfaceRadius: 0,
        color: '#cc4422',
        renderRadius: 0.7,
      },
      {
        name: 'Venus',
        center: { q: 3, r: 4 },
        surfaceRadius: 1,
        color: '#e8c87a',
        renderRadius: 1.2,
      },
    ],
    bounds: { minQ: -10, maxQ: 10, minR: -8, maxR: 8 },
  };
};

describe('renderer map helpers', () => {
  it('builds body visuals and lightens colors', () => {
    const body = createMap().bodies[0];
    const view = buildBodyView(body, 28, 500);

    expect(lightenColor('#112233', 30)).toBe('rgb(47, 64, 81)');
    expect(view).toMatchObject({
      radius: 19.599999999999998,
      edgeColor: '#cc4422',
      coreColor: 'rgb(234, 98, 64)',
      label: 'MARS',
    });
    expect(view.ripples).toHaveLength(3);
  });

  it('builds base markers for destroyed, friendly, enemy, and neutral bases', () => {
    const state = createState();
    state.destroyedBases.push(asHexKey('wrecked-base'));

    expect(
      buildBaseMarkerView(asHexKey('wrecked-base'), state, 0),
    ).toMatchObject({
      kind: 'destroyed',
      fillStyle: null,
    });

    expect(buildBaseMarkerView(asHexKey('mars-base'), state, 0)).toMatchObject({
      kind: 'friendly',
      fillStyle: '#4fc3f7',
    });

    expect(buildBaseMarkerView(asHexKey('venus-base'), state, 0)).toMatchObject(
      {
        kind: 'enemy',
        fillStyle: '#ff8a65',
      },
    );

    expect(
      buildBaseMarkerView(asHexKey('neutral-base'), state, 0),
    ).toMatchObject({
      kind: 'neutral',
      fillStyle: '#66bb6a',
    });
  });

  it('builds border and asteroid debris views deterministically', () => {
    const bounds = createMap().bounds;

    expect(buildMapBorderView(bounds, false, 1000, 28)).toMatchObject({
      strokeStyle: 'rgba(255, 255, 255, 0.04)',
      lineDash: [],
      lineWidth: 1,
    });

    expect(buildMapBorderView(bounds, true, 1000, 28)).toMatchObject({
      lineDash: [8, 6],
      lineWidth: 2,
    });

    const debris = buildAsteroidDebrisView({ q: -6, r: -11 }, 28);

    expect(debris.particles.length).toBeGreaterThanOrEqual(4);
    expect(debris.particles.length).toBeLessThanOrEqual(8);
    expect(debris.center).toBeDefined();

    // Particles are deterministic for the same coord
    expect(debris).toEqual(buildAsteroidDebrisView({ q: -6, r: -11 }, 28));
  });

  it('builds landing objective views for escape and target-body play', () => {
    const map = createMap();

    const escapeView = buildLandingObjectiveView(
      createPlayer({ escapeWins: true }),
      map,
      1000,
      28,
    );

    expect(escapeView?.kind).toBe('escape');
    expect(
      escapeView && escapeView.kind === 'escape' ? escapeView.markers : [],
    ).toHaveLength(4);

    const targetView = buildLandingObjectiveView(
      createPlayer({ targetBody: 'Mars' }),
      map,
      1000,
      28,
    );

    expect(targetView).toMatchObject({
      kind: 'targetBody',
      labelText: '▼ TARGET',
    });

    expect(
      buildLandingObjectiveView(
        createPlayer({ targetBody: 'Pluto' }),
        map,
        1000,
        28,
      ),
    ).toBeNull();
  });

  it('returns no checkpoint markers when scenario has no checkpointBodies', () => {
    const state = createState();
    const map = createMap();
    expect(buildCheckpointMarkerViews(state, 0, map, 28)).toEqual([]);
  });

  it('marks visited vs unvisited checkpoints with distinct styling', () => {
    const state = createState();
    state.scenarioRules = { checkpointBodies: ['Mars', 'Venus'] };
    state.players[0] = createPlayer({
      homeBody: 'Venus',
      visitedBodies: ['Mars'],
    });
    const map = createMap();

    const views = buildCheckpointMarkerViews(state, 0, map, 28);
    expect(views.map((v) => v.bodyName)).toEqual(['Mars', 'Venus']);

    const mars = views[0];
    const venus = views[1];
    expect(mars.visited).toBe(true);
    expect(venus.visited).toBe(false);
    expect(mars.strokeStyle).not.toEqual(venus.strokeStyle);
    expect(venus.lineDash).toEqual([3, 5]);
    expect(mars.lineDash).toEqual([]);
  });

  it('highlights home body in green once every checkpoint is visited', () => {
    const state = createState();
    state.scenarioRules = { checkpointBodies: ['Mars', 'Venus'] };
    state.players[0] = createPlayer({
      homeBody: 'Venus',
      visitedBodies: ['Mars', 'Venus'],
    });
    const map = createMap();

    const views = buildCheckpointMarkerViews(state, 0, map, 28);
    const venus = views.find((v) => v.bodyName === 'Venus');
    expect(venus?.pipFill).toMatch(/rgba\(100, 255, 140/);
  });

  it('skips checkpoint bodies that are not on the map', () => {
    const state = createState();
    state.scenarioRules = {
      checkpointBodies: ['Mars', 'Jupiter'],
    };
    state.players[0] = createPlayer({ visitedBodies: [] });
    const map = createMap();

    const views = buildCheckpointMarkerViews(state, 0, map, 28);
    expect(views.map((v) => v.bodyName)).toEqual(['Mars']);
  });
});
