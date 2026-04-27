import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type { GameState, Ship } from '../../shared/types/domain';
import { getProjectionParityDiff, normalizeStateForParity } from './projection';

const baseShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const baseState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('PARITY'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [baseShip()],
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
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Terra',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
  ...overrides,
});

describe('normalizeStateForParity', () => {
  it('strips pendingAsteroidHazards (transient mid-phase queue)', () => {
    // The live engine pushes hazards onto the queue during movement and
    // drains it at combat-resolution start, but no EngineEvent records
    // the push, so event-stream replay reproduces an empty array. Strip
    // it before comparison so the parity check doesn't fire 43 false
    // positives every time someone reconnects mid-combat.
    const live = baseState({
      pendingAsteroidHazards: [
        { shipId: asShipId('p0s0'), hex: { q: -9, r: -9 } },
      ],
    });

    const normalized = normalizeStateForParity(live);

    expect(normalized.pendingAsteroidHazards).toEqual([]);
  });

  it('strips combatTargetedThisPhase (UI residue)', () => {
    const live = baseState();
    (live as { combatTargetedThisPhase?: unknown }).combatTargetedThisPhase = {
      p0s0: ['enemy'],
    };

    const normalized = normalizeStateForParity(live);

    expect(normalized.combatTargetedThisPhase).toBeUndefined();
  });

  it('strips per-player connected/ready (session residue)', () => {
    const live = baseState();

    const normalized = normalizeStateForParity(live);

    for (const player of normalized.players) {
      expect(player.connected).toBe(false);
      expect(player.ready).toBe(false);
    }
  });

  it('strips per-ship detected + firedThisPhase (sensor + UI residue)', () => {
    const live = baseState({
      ships: [
        baseShip({
          detected: true,
          firedThisPhase: true as unknown as Ship['firedThisPhase'],
        }),
      ],
    });

    const normalized = normalizeStateForParity(live);

    expect(normalized.ships[0].detected).toBe(false);
    expect(normalized.ships[0].firedThisPhase).toBeUndefined();
  });
});

describe('getProjectionParityDiff', () => {
  it('reports empty diff when only pendingAsteroidHazards differs', () => {
    const live = baseState({
      pendingAsteroidHazards: [
        { shipId: asShipId('p0s0'), hex: { q: -9, r: -9 } },
      ],
    });
    const projected = baseState({ pendingAsteroidHazards: [] });

    const diffs = getProjectionParityDiff(projected, live);

    expect(diffs).toEqual([]);
  });

  it('still reports a real divergence (ship moved)', () => {
    const live = baseState({
      ships: [baseShip({ position: { q: 5, r: 0 } })],
    });
    const projected = baseState({
      ships: [baseShip({ position: { q: 0, r: 0 } })],
    });

    const diffs = getProjectionParityDiff(projected, live);

    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].path).toMatch(/^ships\[0\]\.position/);
  });

  it('flags missing projected state with a top-level diff', () => {
    const live = baseState();

    const diffs = getProjectionParityDiff(null, live);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('');
    expect(diffs[0].projected).toBeNull();
  });
});
