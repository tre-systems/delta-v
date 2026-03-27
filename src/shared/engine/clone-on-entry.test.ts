import { beforeEach, describe, expect, it } from 'vitest';
import { must } from '../assert';
import { asHexKey } from '../hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, SolarSystemMap } from '../types';
import {
  beginCombatPhase,
  createGame,
  processAstrogation,
  processCombat,
  processFleetReady,
  processOrdnance,
  skipCombat,
  skipOrdnance,
} from './game-engine';
import { processLogistics, processSurrender, skipLogistics } from './logistics';
import { processEmplacement } from './ordnance';

let map: SolarSystemMap;
const fixedRng = () => 0.5;
beforeEach(() => {
  map = buildSolarSystemMap();
});
const makeState = (overrides: Partial<GameState> = {}): GameState => {
  const base = createGame(SCENARIOS.biplanetary, map, 'TEST1', findBaseHex);
  return { ...base, ...overrides };
};
const snapshotState = (state: GameState): string => JSON.stringify(state);
describe('clone-on-entry: engine entry points do not mutate input state', () => {
  describe('processAstrogation', () => {
    it('does not mutate input on success', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      const ship = must(state.ships.find((s) => s.owner === 0));
      processAstrogation(
        state,
        0,
        [{ shipId: ship.id, burn: null, overload: null }],
        map,
        fixedRng,
      );
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processAstrogation(state, 1, [], map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('processFleetReady', () => {
    it('does not mutate input on success', () => {
      const state = makeState({
        phase: 'fleetBuilding',
        players: [
          {
            connected: true,
            ready: false,
            bases: [asHexKey('0,0')],
            credits: 100,
            targetBody: 'Mars',
            homeBody: 'Earth',
            escapeWins: false,
          },
          {
            connected: true,
            ready: true,
            bases: [asHexKey('0,0')],
            targetBody: 'Earth',
            homeBody: 'Mars',
            escapeWins: false,
          },
        ],
      });
      const snapshot = snapshotState(state);
      processFleetReady(state, 0, [], map);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processFleetReady(state, 0, [], map);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('processOrdnance', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'ordnance' });
      state.ships[0].lifecycle = 'active';
      state.ships[0].position = { q: 0, r: 0 };
      state.ships[0].velocity = { dq: 1, dr: 0 };
      state.pendingAstrogationOrders = [
        {
          shipId: state.ships[0].id,
          burn: 0,
          overload: null,
        },
      ];
      const snapshot = snapshotState(state);
      processOrdnance(state, 0, [], map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processOrdnance(state, 0, [], map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('skipOrdnance', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'ordnance' });
      state.ships[0].lifecycle = 'active';
      state.ships[0].position = { q: 0, r: 0 };
      state.ships[0].velocity = { dq: 1, dr: 0 };
      state.pendingAstrogationOrders = [
        {
          shipId: state.ships[0].id,
          burn: 0,
          overload: null,
        },
      ];
      const snapshot = snapshotState(state);
      skipOrdnance(state, 0, map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      skipOrdnance(state, 0, map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('beginCombatPhase', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'combat' });
      const snapshot = snapshotState(state);
      beginCombatPhase(state, 0, map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      beginCombatPhase(state, 0, map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('processCombat', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'combat' });
      const snapshot = snapshotState(state);
      processCombat(state, 0, [], map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processCombat(state, 0, [], map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('skipCombat', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'combat' });
      const snapshot = snapshotState(state);
      skipCombat(state, 0, map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      skipCombat(state, 0, map, fixedRng);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('processLogistics', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'logistics' });
      const snapshot = snapshotState(state);
      processLogistics(state, 0, [], map);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processLogistics(state, 0, [], map);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('skipLogistics', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'logistics' });
      const snapshot = snapshotState(state);
      skipLogistics(state, 0, map);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      skipLogistics(state, 0, map);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('processSurrender', () => {
    it('does not mutate input on success', () => {
      const state = makeState({
        scenarioRules: {
          ...makeState().scenarioRules,
          logisticsEnabled: true,
        },
      });
      const ship = must(state.ships.find((s) => s.owner === 0));
      const snapshot = snapshotState(state);
      processSurrender(state, 0, [ship.id]);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processSurrender(state, 0, []);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
  describe('processEmplacement', () => {
    it('does not mutate input on success', () => {
      const state = makeState({ phase: 'ordnance' });
      const snapshot = snapshotState(state);
      processEmplacement(state, 0, [], map);
      expect(snapshotState(state)).toBe(snapshot);
    });
    it('does not mutate input on error', () => {
      const state = makeState();
      const snapshot = snapshotState(state);
      processEmplacement(state, 0, [], map);
      expect(snapshotState(state)).toBe(snapshot);
    });
  });
});
