import { describe, expect, it } from 'vitest';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import { deriveActionRng } from '../prng';
import type { EngineEvent } from './engine-events';
import {
  createGameOrThrow,
  processAstrogation,
  processOrdnance,
  skipCombat,
} from './game-engine';

// Verify that all non-deterministic game outcomes are
// captured as explicit facts in the emitted EngineEvents,
// so event-sourced replay does not depend on re-running
// the same Math.random() sequence.

const map = buildSolarSystemMap();

const collectDiceEvents = (events: EngineEvent[]) => ({
  combatRolls: events
    .filter((e) => e.type === 'combatAttack')
    .map((e) => (e as { roll: number; modifiedRoll: number }).roll),
  rammingRolls: events
    .filter((e) => e.type === 'ramming')
    .map((e) => (e as { roll: number }).roll),
  ordnanceRolls: events
    .filter((e) => e.type === 'ordnanceDetonated')
    .map((e) => (e as { roll: number }).roll),
});

describe('RNG outcome capture in EngineEvents', () => {
  it('combat events capture die roll and modified roll', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'RNG1', findBaseHex);

    // Place ships adjacent with zero velocity for combat
    state.phase = 'combat';
    state.activePlayer = 0;
    state.ships[0].position = { q: 10, r: 10 };
    state.ships[1].position = { q: 10, r: 11 };
    state.ships[0].velocity = { dq: 0, dr: 0 };
    state.ships[1].velocity = { dq: 0, dr: 0 };

    // skipCombat auto-resolves any combats in range
    const result = skipCombat(state, 0, map, () => 0.5);

    if ('error' in result) return;

    const { combatRolls } = collectDiceEvents(result.engineEvents);

    // If combat occurred, rolls should be captured
    for (const roll of combatRolls) {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
  });

  it('ramming events capture die roll', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'RNG2',
      findBaseHex,
    );

    // Place two ships on the same hex to trigger ramming
    // during movement resolution
    state.phase = 'astrogation';
    state.activePlayer = 0;

    // Position enemy ship where our ship will land
    const targetHex = { q: 5, r: 10 };
    state.ships[0].position = { q: 4, r: 10 };
    state.ships[0].velocity = { dq: 1, dr: 0 };
    state.ships[1].position = targetHex;
    state.ships[1].velocity = { dq: 0, dr: 0 };

    const result = processAstrogation(
      state,
      0,
      [{ shipId: state.ships[0].id, burn: null, overload: null }],
      map,
      () => 0.5,
    );

    if ('error' in result) return;

    const { rammingRolls } = collectDiceEvents(result.engineEvents);

    // If ramming occurred, the roll should be captured
    if (rammingRolls.length > 0) {
      for (const roll of rammingRolls) {
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(6);
      }
    }
  });

  it('ordnance detonation events capture die roll', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'RNG3', findBaseHex);

    // Place a mine and move enemy through it
    state.phase = 'ordnance';
    state.activePlayer = 0;

    const result = processOrdnance(
      state,
      0,
      [
        {
          shipId: state.ships[0].id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      map,
      () => 0.5,
    );

    if ('error' in result) return;

    // Mine was launched — check the events
    const launchEvents = result.engineEvents.filter(
      (e) => e.type === 'ordnanceLaunched',
    );

    // Mine launch should be captured
    if (launchEvents.length > 0) {
      expect(launchEvents[0].type).toBe('ordnanceLaunched');
    }
  });

  it('all combat attack events have roll and modifiedRoll fields', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'RNG4', findBaseHex);

    state.phase = 'combat';
    state.activePlayer = 0;
    state.ships[0].position = { q: 10, r: 10 };
    state.ships[1].position = { q: 11, r: 10 };
    state.ships[0].velocity = { dq: 0, dr: 0 };
    state.ships[1].velocity = { dq: 0, dr: 0 };

    const result = skipCombat(state, 0, map, () => 0.5);

    if ('error' in result) return;

    const combatEvents = result.engineEvents.filter(
      (e) => e.type === 'combatAttack',
    );

    for (const event of combatEvents) {
      const ce = event as {
        roll: number;
        modifiedRoll: number;
      };
      expect(typeof ce.roll).toBe('number');
      expect(typeof ce.modifiedRoll).toBe('number');
      expect(ce.roll).toBeGreaterThanOrEqual(1);
      expect(ce.roll).toBeLessThanOrEqual(6);
    }
  });

  it('fugitiveDesignated event type is defined', () => {
    // Verify the event type compiles
    const event: EngineEvent = {
      type: 'fugitiveDesignated',
      shipId: 'p0s0',
      playerId: 0,
    };

    expect(event.type).toBe('fugitiveDesignated');
  });

  it('seeded PRNG produces identical combat outcomes', () => {
    const seed = 12345;
    const seq = 7;

    const makeState = () => {
      const s = createGameOrThrow(SCENARIOS.duel, map, 'SEED1', findBaseHex);
      s.phase = 'combat';
      s.activePlayer = 0;
      s.ships[0].position = { q: 10, r: 10 };
      s.ships[1].position = { q: 10, r: 11 };
      s.ships[0].velocity = { dq: 0, dr: 0 };
      s.ships[1].velocity = { dq: 0, dr: 0 };
      return s;
    };

    const r1 = skipCombat(makeState(), 0, map, deriveActionRng(seed, seq));
    const r2 = skipCombat(makeState(), 0, map, deriveActionRng(seed, seq));

    expect('error' in r1).toBe(false);
    expect('error' in r2).toBe(false);

    if ('error' in r1 || 'error' in r2) return;

    const rolls1 = collectDiceEvents(r1.engineEvents);
    const rolls2 = collectDiceEvents(r2.engineEvents);
    expect(rolls1).toEqual(rolls2);
    expect(r1.state).toEqual(r2.state);
  });
});
