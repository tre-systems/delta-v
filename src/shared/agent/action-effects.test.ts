import { describe, expect, it } from 'vitest';

import { asHexKey } from '../hex';
import { asGameId, asOrdnanceId, asShipId } from '../ids';
import type { GameState, Ordnance, Ship } from '../types/domain';
import { computeActionEffects } from './action-effects';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  nukesLaunchedSinceResupply: 0,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const makeOrdnance = (overrides: Partial<Ordnance> = {}): Ordnance => ({
  id: asOrdnanceId('ord0'),
  type: 'nuke',
  owner: 0,
  sourceShipId: null,
  position: { q: 1, r: 0 },
  velocity: { dq: 0, dr: 0 },
  turnsRemaining: 5,
  lifecycle: 'active',
  ...overrides,
});

const makeState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('TEST'),
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
  ...overrides,
});

describe('computeActionEffects', () => {
  it('emits no effects when states are identical', () => {
    const state = makeState();
    const { effects, turnAdvanced, phaseChanged } = computeActionEffects(
      state,
      state,
      0,
    );
    expect(effects).toEqual([]);
    expect(turnAdvanced).toBe(false);
    expect(phaseChanged).toBe(false);
  });

  it('reports turn + phase transitions', () => {
    const prev = makeState({ turnNumber: 1, phase: 'astrogation' });
    const next = makeState({ turnNumber: 2, phase: 'ordnance' });
    const { effects, turnAdvanced, phaseChanged } = computeActionEffects(
      prev,
      next,
      0,
    );
    expect(turnAdvanced).toBe(true);
    expect(phaseChanged).toBe(true);
    expect(effects.map((e) => e.kind)).toEqual([
      'turnAdvanced',
      'phaseChanged',
    ]);
  });

  it('marks a self ship destroyed with deathCause', () => {
    const ship = makeShip();
    const prev = makeState({ ships: [ship] });
    const next = makeState({
      ships: [
        {
          ...ship,
          lifecycle: 'destroyed',
          deathCause: 'nuke hit',
        },
      ],
    });
    const { effects } = computeActionEffects(prev, next, 0);
    const destroyed = effects.find((e) => e.kind === 'shipDestroyed');
    expect(destroyed).toBeDefined();
    expect(destroyed?.side).toBe('self');
    expect(destroyed?.data?.deathCause).toBe('nuke hit');
  });

  it('tags enemy destruction as opponent side', () => {
    const enemy = makeShip({ id: asShipId('e0'), owner: 1 });
    const prev = makeState({ ships: [enemy] });
    const next = makeState({
      ships: [{ ...enemy, lifecycle: 'destroyed', deathCause: 'gun hit' }],
    });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.find((e) => e.kind === 'shipDestroyed')?.side).toBe(
      'opponent',
    );
  });

  it('hides effects for undetected enemy that stays undetected', () => {
    const enemy = makeShip({ id: asShipId('e0'), owner: 1, detected: false });
    const prev = makeState({ ships: [enemy] });
    const next = makeState({
      ships: [
        {
          ...enemy,
          lifecycle: 'destroyed',
          deathCause: 'self-destruct',
        },
      ],
    });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.some((e) => e.kind === 'shipDestroyed')).toBe(false);
  });

  it('emits enemyDetected when fog-of-war clears', () => {
    const enemy = makeShip({ id: asShipId('e0'), owner: 1, detected: false });
    const prev = makeState({ ships: [enemy] });
    const next = makeState({ ships: [{ ...enemy, detected: true }] });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.some((e) => e.kind === 'enemyDetected')).toBe(true);
  });

  it('emits shipLanded on active → landed', () => {
    const ship = makeShip();
    const prev = makeState({ ships: [ship] });
    const next = makeState({
      ships: [{ ...ship, lifecycle: 'landed' }],
    });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.find((e) => e.kind === 'shipLanded')?.side).toBe('self');
  });

  it('emits shipDisabled when disabledTurns goes from 0 to positive', () => {
    const ship = makeShip();
    const prev = makeState({ ships: [ship] });
    const next = makeState({
      ships: [
        {
          ...ship,
          damage: { disabledTurns: 2 },
        },
      ],
    });
    const { effects } = computeActionEffects(prev, next, 0);
    const disabled = effects.find((e) => e.kind === 'shipDisabled');
    expect(disabled).toBeDefined();
    expect(disabled?.data?.disabledTurnsAfter).toBe(2);
  });

  it('emits ordnanceLaunched for new ordnance', () => {
    const prev = makeState();
    const next = makeState({ ordnance: [makeOrdnance()] });
    const { effects } = computeActionEffects(prev, next, 0);
    const launched = effects.find((e) => e.kind === 'ordnanceLaunched');
    expect(launched?.side).toBe('self');
    expect(launched?.ordnanceId).toBe('ord0');
  });

  it('emits ordnanceDestroyed when ordnance flips to destroyed', () => {
    const ord = makeOrdnance();
    const prev = makeState({ ordnance: [ord] });
    const next = makeState({
      ordnance: [{ ...ord, lifecycle: 'destroyed' }],
    });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.some((e) => e.kind === 'ordnanceDestroyed')).toBe(true);
  });

  it('emits baseDestroyed when a new destroyed hex appears', () => {
    const prev = makeState({ destroyedBases: [] });
    const next = makeState({ destroyedBases: [asHexKey('2,3')] });
    const { effects } = computeActionEffects(prev, next, 0);
    const baseKill = effects.find((e) => e.kind === 'baseDestroyed');
    expect(baseKill?.data?.hexKey).toBe('2,3');
  });

  it('emits victory for the winning player', () => {
    const prev = makeState({ phase: 'combat' });
    const next = makeState({
      phase: 'gameOver',
      outcome: { winner: 0, reason: 'Fleet eliminated!' },
    });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.some((e) => e.kind === 'victory')).toBe(true);
    expect(effects.some((e) => e.kind === 'defeat')).toBe(false);
  });

  it('emits defeat for the losing player', () => {
    const prev = makeState({ phase: 'combat' });
    const next = makeState({
      phase: 'gameOver',
      outcome: { winner: 1, reason: 'Fleet eliminated!' },
    });
    const { effects } = computeActionEffects(prev, next, 0);
    expect(effects.some((e) => e.kind === 'defeat')).toBe(true);
    expect(effects.some((e) => e.kind === 'victory')).toBe(false);
  });
});
