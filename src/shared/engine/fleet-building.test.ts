import { beforeEach, describe, expect, it } from 'vitest';
import type { ShipType } from '../constants';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { FleetPurchase, SolarSystemMap } from '../types';
import { processFleetReady } from './fleet-building';
import { createGame } from './game-creation';

let map: SolarSystemMap;
beforeEach(() => {
  map = buildSolarSystemMap();
});

describe('fleet building (MegaCredit economy)', () => {
  it('Interplanetary War scenario starts in fleetBuilding phase', () => {
    const state = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01',
      findBaseHex,
    );
    expect(state.phase).toBe('fleetBuilding');
    expect(state.players[0].credits).toBe(850);
    expect(state.players[1].credits).toBe(850);
    expect(state.players[0].ready).toBe(false);
    expect(state.players[1].ready).toBe(false);
    expect(state.ships).toHaveLength(0);
  });
  it('processFleetReady spawns purchased ships at bases', () => {
    const state = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01',
      findBaseHex,
    );
    const purchases: FleetPurchase[] = [
      { shipType: 'corvette' },
      { shipType: 'corsair' },
    ];
    const result = processFleetReady(
      state,
      0,
      purchases,
      map,
      SCENARIOS.interplanetaryWar.availableShipTypes,
    );
    expect('error' in result).toBe(false);
    if ('state' in result) {
      const p0Ships = result.state.ships.filter((s) => s.owner === 0);
      expect(p0Ships).toHaveLength(2);
      expect(p0Ships[0].type).toBe('corvette');
      expect(p0Ships[1].type).toBe('corsair');
      expect(p0Ships[0].lifecycle).toBe('landed');
      expect(result.state.players[0].credits).toBe(730);
      expect(result.state.players[0].ready).toBe(true);
      expect(result.state.phase).toBe('fleetBuilding');
      expect(result.engineEvents).toContainEqual({
        type: 'fleetPurchased',
        playerId: 0,
        purchases,
        shipTypes: ['corvette', 'corsair'],
      });
    }
  });
  it('transitions to astrogation when both players submit', () => {
    const state = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01',
      findBaseHex,
    );
    const r1 = processFleetReady(state, 0, [{ shipType: 'corvette' }], map);
    if ('error' in r1) throw new Error(r1.error.message);
    const r2 = processFleetReady(r1.state, 1, [{ shipType: 'corsair' }], map);
    expect('error' in r2).toBe(false);
    if ('state' in r2) {
      expect(r2.state.phase).toBe('astrogation');
      expect(r2.state.ships).toHaveLength(2);
    }
  });
  it('rejects purchases exceeding credits', () => {
    const state = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01',
      findBaseHex,
    );
    const result = processFleetReady(
      state,
      0,
      [{ shipType: 'dreadnaught' }, { shipType: 'torch' }],
      map,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toContain('Not enough credits');
    }
  });
  it('rejects unknown ship type', () => {
    const state = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01',
      findBaseHex,
    );
    const result = processFleetReady(
      state,
      0,
      [{ shipType: 'battlecruiser' as ShipType }],
      map,
    );
    expect('error' in result).toBe(true);
  });
  it('rejects direct orbital base purchase', () => {
    const state = createGame(
      SCENARIOS.interplanetaryWar,
      map,
      'WAR01',
      findBaseHex,
    );
    const result = processFleetReady(
      state,
      0,
      [{ shipType: 'orbitalBase' }],
      map,
    );
    expect('error' in result).toBe(true);
  });
  it('rejects fleet ready when not in fleetBuilding phase', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const result = processFleetReady(state, 0, [], map);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toContain('Not in fleet building');
    }
  });
});
