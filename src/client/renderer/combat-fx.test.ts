import { describe, expect, it } from 'vitest';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId, asOrdnanceId, asShipId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { CombatResult } from '../../shared/types/domain';
import { buildCombatEffectsForResults } from './combat-fx';

const minimalCombatResult = (
  overrides: Partial<CombatResult> &
    Pick<CombatResult, 'targetId' | 'targetType'>,
): CombatResult => ({
  attackerIds: [],
  attackType: 'gun',
  odds: '50%',
  attackStrength: 1,
  defendStrength: 1,
  rangeMod: 0,
  velocityMod: 0,
  dieRoll: 1,
  modifiedRoll: 1,
  damageType: 'none',
  disabledTurns: 0,
  counterattack: null,
  ...overrides,
});

describe('buildCombatEffectsForResults', () => {
  it('returns empty when target entity cannot be resolved', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CEFX'),
      findBaseHex,
    );
    const r = minimalCombatResult({
      targetId: asShipId('missing-ship'),
      targetType: 'ship',
      attackerIds: [],
      damageType: 'eliminated',
    });
    expect(buildCombatEffectsForResults([r], state, null, map, 0, 28)).toEqual(
      [],
    );
  });

  it('adds beam from ship attacker and explosion on damage', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CEFY'),
      findBaseHex,
    );
    const [a, b] = state.ships;
    const r = minimalCombatResult({
      attackerIds: [a.id],
      targetId: b.id,
      targetType: 'ship',
      damageType: 'eliminated',
    });
    const fx = buildCombatEffectsForResults([r], state, null, map, 1000, 28);
    const beams = fx.filter((e) => e.type === 'beam');
    const explosions = fx.filter((e) => e.type === 'explosion');
    expect(beams.length).toBeGreaterThanOrEqual(1);
    expect(explosions.length).toBeGreaterThanOrEqual(1);
    expect(beams[0].startTime).toBe(1000);
    expect(explosions[0].startTime).toBeGreaterThan(1000);
  });

  it('skips beam for asteroid hazard attacks', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CEFZ'),
      findBaseHex,
    );
    const [a, b] = state.ships;
    const r = minimalCombatResult({
      attackerIds: [a.id],
      targetId: b.id,
      targetType: 'ship',
      attackType: 'asteroidHazard',
      damageType: 'disabled',
    });
    const fx = buildCombatEffectsForResults([r], state, null, map, 500, 28);
    expect(fx.some((e) => e.type === 'beam')).toBe(false);
  });

  it('marks destroyed ships with the heavier destruction style', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CEFW'),
      findBaseHex,
    );
    const [a, b] = state.ships;
    const r = minimalCombatResult({
      attackerIds: [a.id],
      targetId: b.id,
      targetType: 'ship',
      damageType: 'eliminated',
    });

    const fx = buildCombatEffectsForResults([r], state, null, map, 1000, 28);

    expect(fx).toContainEqual(
      expect.objectContaining({
        type: 'explosion',
        style: 'shipDestruction',
        duration: 1000,
      }),
    );
  });

  it('adds a nuke shockwave and flash when anti-nuke fire destroys ordnance', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CEFN'),
      findBaseHex,
    );
    const [a] = state.ships;
    state.ordnance.push({
      id: asOrdnanceId('ord-nuke'),
      type: 'nuke',
      owner: 1,
      sourceShipId: null,
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 4,
      lifecycle: 'active',
    });
    const r = minimalCombatResult({
      attackerIds: [a.id],
      targetId: asOrdnanceId('ord-nuke'),
      targetType: 'ordnance',
      attackType: 'antiNuke',
      damageType: 'eliminated',
    });

    const fx = buildCombatEffectsForResults([r], state, null, map, 1000, 28);

    expect(fx).toContainEqual(
      expect.objectContaining({
        type: 'explosion',
        style: 'nuke',
        duration: 1300,
      }),
    );
    expect(fx).toContainEqual(
      expect.objectContaining({
        type: 'screenFlash',
        style: 'nuke',
      }),
    );
  });
});
