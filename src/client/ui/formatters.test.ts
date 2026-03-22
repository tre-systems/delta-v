import { describe, expect, it } from 'vitest';

import type {
  CombatResult,
  MovementEvent,
  Ship,
} from '../../shared/types/domain';
import {
  formatCombatResultEntries,
  formatMovementEventEntry,
  getLatencyStatus,
  getPhaseAlertCopy,
  parseJoinInput,
} from './formatters';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'corsair',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
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

describe('ui formatters', () => {
  it('parses invite links and raw codes', () => {
    expect(
      parseJoinInput(
        ' https://delta-v.example/?code=abcde&playerToken=pt-1 ',
        5,
      ),
    ).toEqual({
      code: 'ABCDE',
      playerToken: 'pt-1',
    });

    expect(parseJoinInput('abcde', 5)).toEqual({
      code: 'ABCDE',
      playerToken: null,
    });

    expect(parseJoinInput('abc', 5)).toBeNull();
  });

  it('returns latency and phase alert presentation state', () => {
    expect(getLatencyStatus(null)).toEqual({
      text: '',
      className: 'latency-text',
    });

    expect(getLatencyStatus(180)).toEqual({
      text: '180ms',
      className: 'latency-text latency-ok',
    });

    expect(getPhaseAlertCopy('combat', false)).toEqual({
      title: 'Combat',
      subtitle: "OPPONENT'S TURN",
      subtitleColor: 'var(--warning)',
    });
  });

  it('formats movement event entries including captures', () => {
    const ships = [
      createShip({ id: 'a', type: 'corsair' }),
      createShip({ id: 'b', type: 'corvette', owner: 1 }),
    ];

    const capture: MovementEvent = {
      type: 'capture',
      shipId: 'b',
      hex: { q: 0, r: 0 },
      dieRoll: 0,
      damageType: 'captured',
      disabledTurns: 0,
      capturedBy: 'a',
    };

    const asteroid: MovementEvent = {
      type: 'asteroidHit',
      shipId: 'a',
      hex: { q: 1, r: 0 },
      dieRoll: 5,
      damageType: 'disabled',
      disabledTurns: 2,
    };

    expect(formatMovementEventEntry(capture, ships)).toEqual({
      text: 'Corvette has been CAPTURED by Corsair!',
      className: 'log-damage',
    });

    expect(formatMovementEventEntry(asteroid, ships)).toEqual({
      text: 'Corsair struck an asteroid! [Roll: 5] -> Systems disabled for 2T',
      className: 'log-damage',
    });
  });

  it('formats combat results and counterattacks for the game log', () => {
    const ships = [
      createShip({ id: 'a', type: 'corsair', owner: 0 }),
      createShip({ id: 'b', type: 'corvette', owner: 0 }),
      createShip({ id: 'x', type: 'frigate', owner: 1 }),
    ];

    const result: CombatResult = {
      attackerIds: ['a', 'b'],
      targetId: 'x',
      targetType: 'ship',
      attackType: 'gun',
      odds: '1:1',
      attackStrength: 6,
      defendStrength: 8,
      rangeMod: -1,
      velocityMod: 0,
      dieRoll: 4,
      modifiedRoll: 3,
      damageType: 'disabled',
      disabledTurns: 2,
      counterattack: {
        attackerIds: ['x'],
        targetId: 'a',
        targetType: 'ship',
        attackType: 'gun',
        odds: '2:1',
        attackStrength: 8,
        defendStrength: 4,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll: 5,
        modifiedRoll: 5,
        damageType: 'none',
        disabledTurns: 0,
        counterattack: null,
      },
    };

    expect(formatCombatResultEntries(result, ships, 0)).toEqual([
      {
        text: 'Corsair & Corvette fired on Frigate [Odds: 1:1 (R-1)] -> Roll: 4 -> DISABLED (2T)',
        className: 'log-damage',
      },
      {
        text: '  Target returned fire on Corsair: Miss',
        className: '',
      },
    ]);
  });

  it('formats asteroid hazard combat entries as environmental events', () => {
    const ships = [createShip({ id: 'x', type: 'packet', owner: 1 })];

    const result: CombatResult = {
      attackerIds: [],
      targetId: 'x',
      targetType: 'ship',
      attackType: 'asteroidHazard',
      odds: '1:1',
      attackStrength: 0,
      defendStrength: 0,
      rangeMod: 0,
      velocityMod: 0,
      dieRoll: 6,
      modifiedRoll: 6,
      damageType: 'eliminated',
      disabledTurns: 0,
      counterattack: null,
    };

    expect(formatCombatResultEntries(result, ships, 0)).toEqual([
      {
        text: 'Packet struck an asteroid: DESTROYED [Roll: 6]',
        className: 'log-eliminated',
      },
    ]);
  });
});
