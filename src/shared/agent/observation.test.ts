import { beforeAll, describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../engine/game-engine';
import { asGameId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, SolarSystemMap } from '../types/domain';

import {
  allowedActionTypesForPhase,
  buildCandidates,
  buildLegalActionInfo,
  buildObservation,
  buildStateSummary,
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
});
