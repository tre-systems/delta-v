// Shared test factory module.
// Provides helpers with sensible defaults for constructing Ship, GameState,
// and other domain objects in tests, eliminating repeated deep object literals.

import { ORDNANCE_LIFETIME } from './constants';
import {
  type HexCoord,
  type HexVec,
  hexAdd,
  hexEqual,
  hexLineDraw,
  hexSubtract,
} from './hex';
import { asGameId, asOrdnanceId, asShipId } from './ids';
import {
  applyPendingGravityEffects,
  collectEnteredGravityEffects,
} from './movement';
import type {
  GameState,
  GravityEffect,
  Ordnance,
  PlayerState,
  Ship,
  SolarSystemMap,
} from './types';

export { asGameId, asOrdnanceId, asShipId };

// Merges top-level fields and also merges the nested `damage` object so
// callers can write `createTestShip({ damage: { disabledTurns: 2 } })`
// without needing to supply every damage sub-field.
type ShipOverrides = Omit<Partial<Ship>, 'damage'> & {
  damage?: Partial<Ship['damage']>;
};

const DEFAULT_PLAYER: PlayerState = {
  connected: true,
  ready: true,
  targetBody: 'Mars',
  homeBody: 'Venus',
  bases: [],
  escapeWins: false,
};

// Returns a minimal valid Ship with sensible defaults.
// Any field can be overridden via the `overrides` parameter.
export const createTestShip = (overrides: ShipOverrides = {}): Ship => {
  const { damage: damageOverrides, ...rest } = overrides;
  return {
    id: asShipId('test-ship'),
    type: 'corvette',
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
    damage: {
      disabledTurns: 0,
      ...damageOverrides,
    },
    ...rest,
  };
};

// Returns a minimal valid Ordnance (nuke by default).
export const createTestOrdnance = (
  overrides: Partial<Ordnance> = {},
): Ordnance => ({
  id: asOrdnanceId('test-ordnance'),
  type: 'nuke',
  owner: 0,
  sourceShipId: null,
  turnsRemaining: 3,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  lifecycle: 'active' as const,
  ...overrides,
});

// Partial overrides for GameState. Ships and players are handled specially
// so the caller can pass a plain array of ships or a single-player partial
// without having to construct the full tuple.
type GameStateOverrides = Omit<Partial<GameState>, 'players'> & {
  players?: [Partial<PlayerState>?, Partial<PlayerState>?];
};

// Returns a minimal valid GameState with sensible defaults.
// Pass `ships` via overrides to populate the ships array; it defaults to
// a single test corvette.
export const createTestState = (
  overrides: GameStateOverrides = {},
): GameState => {
  const { players: playerOverrides, ...rest } = overrides;
  const p0 = { ...DEFAULT_PLAYER, ...(playerOverrides?.[0] ?? {}) };
  const p1 = {
    ...DEFAULT_PLAYER,
    targetBody: 'Venus',
    homeBody: 'Mars',
    ...(playerOverrides?.[1] ?? {}),
  };

  return {
    gameId: asGameId('TEST'),
    scenario: 'biplanetary',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'combat',
    activePlayer: 0,
    ships: [createTestShip()],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: [p0, p1],
    outcome: null,
    ...rest,
  };
};

/** Empty map: no gravity hexes — matches `openMap` in `ai.test.ts`. */
export const EMPTY_SOLAR_MAP: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -200, maxQ: 200, minR: -200, maxR: 200 },
};

export type DriftingEnemyBallisticInput = {
  map: SolarSystemMap;
  ordnanceStart: HexCoord;
  ordnanceVelocity: HexVec;
  enemyStart: HexCoord;
  enemyVelocity: HexVec;
  /** Defaults to `ORDNANCE_LIFETIME` (5). */
  turns?: number;
};

/**
 * Whether a ballistic ordnance path (same kinematics as `moveOrdnance` on an
 * empty map) would share a hex with an enemy that drifts by a constant
 * velocity each turn. Intended for AI regression fixtures — not a full
 * gravity / ship-movement model.
 */
export const driftingEnemyWouldBeHitByOpenSpaceBallistic = (
  input: DriftingEnemyBallisticInput,
): boolean => {
  const turns = input.turns ?? ORDNANCE_LIFETIME;
  let ordPos: HexCoord = { ...input.ordnanceStart };
  let ordVel: HexVec = { ...input.ordnanceVelocity };
  let ordPending: GravityEffect[] = [];
  let enemyPos: HexCoord = { ...input.enemyStart };
  const enemyVel = input.enemyVelocity;

  for (let t = 0; t < turns; t++) {
    const from = { ...ordPos };
    const rawDest = hexAdd(ordPos, ordVel);
    const finalDest = applyPendingGravityEffects(rawDest, ordPending);
    const path = hexLineDraw(from, finalDest);
    for (const h of path) {
      if (hexEqual(h, enemyPos)) {
        return true;
      }
    }
    ordPos = finalDest;
    ordVel = hexSubtract(finalDest, from);
    ordPending = collectEnteredGravityEffects(path, input.map);
    enemyPos = hexAdd(enemyPos, enemyVel);
  }

  return false;
};
