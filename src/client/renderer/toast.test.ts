import { describe, expect, it } from 'vitest';

import type {
  CombatResult,
  GameState,
  MovementEvent,
  Ship,
} from '../../shared/types/domain';
import {
  buildCombatResultToastLines,
  formatMovementEventToast,
  getToastFadeAlpha,
} from './toast';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-1',
  type: 'packet',
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

const createState = (): GameState => ({
  gameId: 'LOCAL',
  scenario: 'Bi-Planetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'combat',
  activePlayer: 0,
  ships: [
    createShip(),
    createShip({ id: 'enemy', owner: 1, type: 'corvette' }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: 'Mars',
      homeBody: 'Venus',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Venus',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
});

const createMovementEvent = (
  overrides: Partial<MovementEvent> = {},
): MovementEvent => ({
  type: 'asteroidHit',
  shipId: 'ship-1',
  hex: { q: 0, r: 0 },
  dieRoll: 4,
  damageType: 'none',
  disabledTurns: 0,
  ...overrides,
});

const createCombatResult = (
  overrides: Partial<CombatResult> = {},
): CombatResult => ({
  attackerIds: ['ship-1'],
  targetId: 'enemy',
  targetType: 'ship',
  attackType: 'gun',
  odds: '2:1',
  attackStrength: 2,
  defendStrength: 1,
  rangeMod: 0,
  velocityMod: 0,
  dieRoll: 4,
  modifiedRoll: 4,
  damageType: 'none',
  disabledTurns: 0,
  counterattack: null,
  ...overrides,
});

describe('renderer toast helpers', () => {
  it('formats movement event toast text and color', () => {
    expect(
      formatMovementEventToast(
        createMovementEvent({
          type: 'ramming',
          damageType: 'disabled',
          disabledTurns: 2,
        }),
        'packet',
      ),
    ).toEqual({
      text: 'packet: RAMMED [4] — DISABLED 2T',
      color: '#ffaa00',
      variant: 'primary',
    });

    expect(
      formatMovementEventToast(
        createMovementEvent({ type: 'crash' }),
        'packet',
      ),
    ).toEqual({
      text: 'packet: CRASHED',
      color: '#ff4444',
      variant: 'primary',
    });
  });

  it('returns null for movement events without toast copy', () => {
    expect(
      formatMovementEventToast(
        createMovementEvent({
          type: 'capture',
          damageType: 'captured',
        }),
        'packet',
      ),
    ).toBeNull();
  });

  it('builds combat result and counterattack toast lines', () => {
    const state = createState();

    const lines = buildCombatResultToastLines(
      [
        createCombatResult({
          damageType: 'disabled',
          counterattack: createCombatResult({
            targetId: 'ship-1',
            damageType: 'eliminated',
          }),
        }),
      ],
      state,
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      color: '#ffaa00',
      variant: 'primary',
    });
    expect(lines[1]).toMatchObject({
      color: '#ff4444',
      variant: 'secondary',
    });
  });

  it('fades toast alpha over the final second', () => {
    expect(getToastFadeAlpha(5000, 3500)).toBe(1);
    expect(getToastFadeAlpha(5000, 4500)).toBeCloseTo(0.5, 4);
    expect(getToastFadeAlpha(5000, 5200)).toBe(0);
  });
});
