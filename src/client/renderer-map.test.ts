import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, SolarSystemMap } from '../shared/types';
import {
  buildAsteroidDebrisView,
  buildBaseMarkerView,
  buildBodyView,
  buildLandingObjectiveView,
  buildMapBorderView,
  lightenColor,
} from './renderer-map';

function createPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    connected: true,
    ready: true,
    targetBody: 'Mars',
    homeBody: 'Venus',
    bases: [],
    escapeWins: false,
    ...overrides,
  };
}

function createState(): GameState {
  return {
    gameId: 'LOCAL',
    scenario: 'Bi-Planetary',
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
      createPlayer({ bases: ['mars-base'] }),
      createPlayer({ bases: ['venus-base'] }),
    ],
    winner: null,
    winReason: null,
  };
}

function createMap(): SolarSystemMap {
  return {
    hexes: new Map(),
    bodies: [
      { name: 'Mars', center: { q: -1, r: -2 }, surfaceRadius: 0, color: '#cc4422', renderRadius: 0.7 },
      { name: 'Venus', center: { q: 3, r: 4 }, surfaceRadius: 1, color: '#e8c87a', renderRadius: 1.2 },
    ],
    bounds: { minQ: -10, maxQ: 10, minR: -8, maxR: 8 },
  };
}

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
    state.destroyedBases.push('wrecked-base');

    expect(buildBaseMarkerView('wrecked-base', state, 0)).toMatchObject({
      kind: 'destroyed',
      fillStyle: null,
    });
    expect(buildBaseMarkerView('mars-base', state, 0)).toMatchObject({
      kind: 'friendly',
      fillStyle: '#4fc3f7',
    });
    expect(buildBaseMarkerView('venus-base', state, 0)).toMatchObject({
      kind: 'enemy',
      fillStyle: '#ff8a65',
    });
    expect(buildBaseMarkerView('neutral-base', state, 0)).toMatchObject({
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
    expect(debris.particles).toHaveLength(6);
    expect(debris.center).toBeDefined();
    // Particles are deterministic for the same coord
    expect(debris).toEqual(buildAsteroidDebrisView({ q: -6, r: -11 }, 28));
  });

  it('builds landing objective views for escape and target-body play', () => {
    const map = createMap();
    const escapeView = buildLandingObjectiveView(createPlayer({ escapeWins: true }), map, 1000, 28);
    expect(escapeView?.kind).toBe('escape');
    expect(escapeView && escapeView.kind === 'escape' ? escapeView.markers : []).toHaveLength(4);

    const targetView = buildLandingObjectiveView(createPlayer({ targetBody: 'Mars' }), map, 1000, 28);
    expect(targetView).toMatchObject({
      kind: 'targetBody',
      labelText: '▼ TARGET',
    });

    expect(buildLandingObjectiveView(createPlayer({ targetBody: 'Pluto' }), map, 1000, 28)).toBeNull();
  });
});
