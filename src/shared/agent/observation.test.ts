import { beforeAll, describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../engine/game-engine';
import { asGameId, asOrdnanceId, asShipId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import {
  createTestOrdnance,
  createTestShip,
  createTestState,
  EMPTY_SOLAR_MAP,
} from '../test-helpers';
import type { GameState, SolarSystemMap } from '../types/domain';

import {
  allowedActionTypesForPhase,
  buildCandidates,
  buildLegalActionInfo,
  buildObservation,
  buildStateSummary,
  shapeObservationState,
  withCompactObservationState,
} from './index';

let map: SolarSystemMap;
let state: GameState;

beforeAll(() => {
  map = buildSolarSystemMap();
  state = createGameOrThrow(
    SCENARIOS.duel,
    map,
    asGameId('TEST-OBS'),
    findBaseHex,
  );
});

describe('allowedActionTypesForPhase', () => {
  it('maps every phase to a legal C2S type set', () => {
    expect([...allowedActionTypesForPhase('fleetBuilding')]).toEqual([
      'fleetReady',
    ]);
    expect([...allowedActionTypesForPhase('astrogation')]).toEqual([
      'astrogation',
      'surrender',
    ]);
    expect([...allowedActionTypesForPhase('ordnance')]).toEqual([
      'ordnance',
      'skipOrdnance',
      'emplaceBase',
    ]);
    expect([...allowedActionTypesForPhase('combat')]).toEqual([
      'beginCombat',
      'combat',
      'skipCombat',
    ]);
    expect([...allowedActionTypesForPhase('logistics')]).toEqual([
      'logistics',
      'skipLogistics',
    ]);
    expect([...allowedActionTypesForPhase('gameOver')]).toEqual(['rematch']);
    expect([...allowedActionTypesForPhase('waiting')]).toEqual([]);
  });
});

describe('buildCandidates', () => {
  it('produces at least one candidate in an active phase', () => {
    const candidates = buildCandidates(state, 0, map);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('first candidate is the recommended (hard AI) choice', () => {
    const candidates = buildCandidates(state, 0, map);
    expect(candidates[0]).toBeDefined();
    expect(candidates[0].type).toBeTypeOf('string');
  });

  it('dedupes identical actions across difficulties', () => {
    const candidates = buildCandidates(state, 0, map);
    const keys = new Set(candidates.map((c) => JSON.stringify(c)));
    expect(keys.size).toBe(candidates.length);
  });

  it('works without a pre-supplied map (builds internally)', () => {
    const candidates = buildCandidates(state, 0);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('offers broad directional astrogation choices for single-ship opening turns', () => {
    const candidates = buildCandidates(state, 1, map).filter(
      (candidate) => candidate.type === 'astrogation',
    );
    const burnDirections = new Set(
      candidates
        .map((candidate) => candidate.orders[0]?.burn)
        .filter((burn): burn is number => burn !== null && burn !== undefined),
    );
    const overloadDirections = new Set(
      candidates
        .map((candidate) => candidate.orders[0]?.overload)
        .filter(
          (overload): overload is number =>
            overload !== null && overload !== undefined,
        ),
    );

    expect(
      candidates.some((candidate) => candidate.orders[0]?.burn === null),
    ).toBe(true);
    expect([...burnDirections].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...overloadDirections].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('demotes consecutive low-confidence ordnance recommendations behind skip', () => {
    const consecutiveState = createTestState({
      phase: 'ordnance',
      activePlayer: 0,
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['torpedo'] },
      ships: [
        createTestShip({
          id: asShipId('p0-frig'),
          owner: 0,
          type: 'frigate',
          position: { q: 0, r: 0 },
          velocity: { dq: 0, dr: 0 },
          lifecycle: 'active',
        }),
        createTestShip({
          id: asShipId('p1-dread'),
          owner: 1,
          type: 'packet',
          position: { q: 7, r: 0 },
          velocity: { dq: 0, dr: 0 },
          lifecycle: 'active',
        }),
      ],
      ordnance: [
        createTestOrdnance({
          id: asOrdnanceId('ord-prev'),
          owner: 0,
          sourceShipId: asShipId('p0-frig'),
          turnsRemaining: 4,
          lifecycle: 'active',
        }),
      ],
    });

    const candidates = buildCandidates(consecutiveState, 0, EMPTY_SOLAR_MAP);
    expect(candidates.some((candidate) => candidate.type === 'ordnance')).toBe(
      true,
    );
    expect(candidates[0].type).toBe('skipOrdnance');
  });
});

describe('buildLegalActionInfo', () => {
  it('returns a structured legal-action record for the phase', () => {
    const info = buildLegalActionInfo(state, 0);
    expect(info.phase).toBe(state.phase);
    expect(info.burnDirections).toEqual(['E', 'NE', 'NW', 'W', 'SW', 'SE']);
    expect(info.ownShips.length).toBeGreaterThan(0);
  });

  it('only includes own ships in ownShips', () => {
    const info = buildLegalActionInfo(state, 0);
    for (const ship of info.ownShips) {
      const original = state.ships.find((s) => s.id === ship.id);
      expect(original?.owner).toBe(0);
    }
  });

  it('only includes enemy ships in enemies', () => {
    const info = buildLegalActionInfo(state, 0);
    for (const ship of info.enemies) {
      const original = state.ships.find((s) => s.id === ship.id);
      expect(original?.owner).toBe(1);
    }
  });

  it('exposes capability flags per ship', () => {
    const info = buildLegalActionInfo(state, 0);
    for (const ship of info.ownShips) {
      expect(typeof ship.canBurn).toBe('boolean');
      expect(typeof ship.canAttack).toBe('boolean');
      expect(typeof ship.canOverload).toBe('boolean');
      expect(typeof ship.canLaunchOrdnance).toBe('boolean');
    }
  });
});

describe('buildStateSummary', () => {
  it('mentions phase, turn, objective, ships, and candidates', () => {
    const candidates = buildCandidates(state, 0, map);
    const summary = buildStateSummary(state, 0, candidates, map);
    expect(summary).toContain(`Turn ${state.turnNumber}`);
    expect(summary).toContain(`Phase: ${state.phase}`);
    expect(summary).toContain('YOUR SHIPS:');
    expect(summary).toContain('ENEMY SHIPS:');
    expect(summary).toContain('CANDIDATES:');
  });
});

describe('buildObservation', () => {
  it('wraps state/candidates/summary/legalActionInfo with version 1', () => {
    const obs = buildObservation(state, 0, { gameCode: 'ABCDE', map });
    expect(obs.version).toBe(1);
    expect(obs.gameCode).toBe('ABCDE');
    expect(obs.playerId).toBe(0);
    expect(obs.state).toBe(state);
    expect(obs.candidates.length).toBeGreaterThan(0);
    expect(obs.recommendedIndex).toBe(0);
    expect(typeof obs.summary).toBe('string');
    expect(obs.legalActionInfo).toBeDefined();
  });

  it('includes lastTurnAutoPlayed when provided in options', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'ABCDE',
      map,
      lastTurnAutoPlayed: { index: 3, reason: 'timeout' },
    });
    expect(obs.lastTurnAutoPlayed).toEqual({ index: 3, reason: 'timeout' });
  });

  it('omits summary when includeSummary is false', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'ABCDE',
      map,
      includeSummary: false,
    });
    expect(obs.summary).toBeUndefined();
    expect(obs.legalActionInfo).toBeDefined();
  });

  it('omits legalActionInfo when includeLegalActionInfo is false', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'ABCDE',
      map,
      includeLegalActionInfo: false,
    });
    expect(obs.legalActionInfo).toBeUndefined();
    expect(obs.summary).toBeDefined();
  });

  it('builds a map internally when one is not supplied', () => {
    const obs = buildObservation(state, 1, { gameCode: 'ABCDE' });
    expect(obs.playerId).toBe(1);
    expect(obs.candidates.length).toBeGreaterThan(0);
  });

  it('omits all v2 enrichments by default', () => {
    const obs = buildObservation(state, 0, { gameCode: 'ABCDE', map });
    expect(obs.tactical).toBeUndefined();
    expect(obs.spatialGrid).toBeUndefined();
    expect(obs.labeledCandidates).toBeUndefined();
  });

  it('includes tactical features when opted in', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'ABCDE',
      map,
      includeTactical: true,
    });
    expect(obs.tactical).toBeDefined();
    const t = obs.tactical;
    expect(
      t?.objectiveDistance === null || typeof t?.objectiveDistance === 'number',
    ).toBe(true);
    expect(typeof t?.fuelAdvantage).toBe('number');
  });

  it('includes spatial grid when opted in', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'ABCDE',
      map,
      includeSpatialGrid: true,
    });
    expect(obs.spatialGrid).toBeDefined();
    expect(obs.spatialGrid).toContain('Legend:');
    expect(obs.spatialGrid).toContain('Viewport');
  });

  it('includes labeled candidates when opted in', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'ABCDE',
      map,
      includeCandidateLabels: true,
    });
    expect(obs.labeledCandidates).toBeDefined();
    expect(obs.labeledCandidates?.length).toBe(obs.candidates.length);
    const first = obs.labeledCandidates?.[0];
    expect(first?.index).toBe(0);
    expect(first?.label).toBeTypeOf('string');
    expect(first?.reasoning).toBeTypeOf('string');
    expect(['low', 'medium', 'high']).toContain(first?.risk);
  });

  it('labels low-confidence consecutive ordnance with short-intercept context', () => {
    const consecutiveState = createTestState({
      phase: 'ordnance',
      activePlayer: 0,
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['torpedo'] },
      ships: [
        createTestShip({
          id: asShipId('p0-frig'),
          owner: 0,
          type: 'frigate',
          position: { q: 0, r: 0 },
          velocity: { dq: 0, dr: 0 },
          lifecycle: 'active',
        }),
        createTestShip({
          id: asShipId('p1-dread'),
          owner: 1,
          type: 'packet',
          position: { q: 7, r: 0 },
          velocity: { dq: 0, dr: 0 },
          lifecycle: 'active',
        }),
      ],
      ordnance: [
        createTestOrdnance({
          id: asOrdnanceId('ord-prev'),
          owner: 0,
          sourceShipId: asShipId('p0-frig'),
          turnsRemaining: 4,
          lifecycle: 'active',
        }),
      ],
    });
    const obs = buildObservation(consecutiveState, 0, {
      gameCode: 'LAB1',
      map: EMPTY_SOLAR_MAP,
      includeCandidateLabels: true,
    });
    const ord = obs.labeledCandidates?.find(
      (e) => e.action.type === 'ordnance',
    );
    expect(ord).toBeDefined();
    expect(ord?.reasoning).toContain('short-intercept');
  });
});

describe('withCompactObservationState', () => {
  it('retains only phase, turnNumber, and activePlayer on state', () => {
    const obs = buildObservation(state, 0, { gameCode: 'X', map });
    const compact = withCompactObservationState(obs);
    expect(Object.keys(compact.state).sort()).toEqual(
      ['activePlayer', 'phase', 'turnNumber'].sort(),
    );
    expect(compact.candidates).toEqual(obs.candidates);
  });

  it('preserves lastTurnAutoPlayed when present', () => {
    const obs = buildObservation(state, 0, {
      gameCode: 'X',
      map,
      lastTurnAutoPlayed: { index: 1, reason: 'timeout' },
    });
    const compact = withCompactObservationState(obs);
    expect(compact.lastTurnAutoPlayed).toEqual({ index: 1, reason: 'timeout' });
  });
});

describe('shapeObservationState', () => {
  it('keeps the full state by default', () => {
    const obs = buildObservation(state, 0, { gameCode: 'ABCDE' });

    const shaped = shapeObservationState(obs, undefined);

    expect(shaped.state).toBe(obs.state);
    expect(shaped.state).toHaveProperty('ships');
  });

  it('uses compact state when explicitly requested', () => {
    const obs = buildObservation(state, 0, { gameCode: 'ABCDE' });

    const shaped = shapeObservationState(obs, true);

    expect(shaped.state).toEqual({
      phase: obs.state.phase,
      turnNumber: obs.state.turnNumber,
      activePlayer: obs.state.activePlayer,
    });
  });

  it('supports compact-by-default callers with explicit full-state override', () => {
    const obs = buildObservation(state, 0, { gameCode: 'ABCDE' });

    const compactDefault = shapeObservationState(obs, undefined, true);
    const fullOverride = shapeObservationState(obs, false, true);

    expect(compactDefault.state).toEqual({
      phase: obs.state.phase,
      turnNumber: obs.state.turnNumber,
      activePlayer: obs.state.activePlayer,
    });
    expect(fullOverride.state).toBe(obs.state);
    expect(fullOverride.state).toHaveProperty('ships');
  });
});
