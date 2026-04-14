// Compact summary of observable deltas between two successive GameStates.
// Agents use this instead of diffing the raw state themselves, so the
// action → outcome feedback loop stays short. Fog-of-war compliant:
// effects involving enemy ships are elided when the ship was not detected
// before AND is not detected after (nothing the agent could legally see).

import type { GameState, PlayerId, Ship } from '../types/domain';

export interface ActionEffect {
  // Short machine tag. Stable across versions; new kinds only appended.
  kind:
    | 'shipDestroyed'
    | 'shipDisabled'
    | 'shipLanded'
    | 'shipTookOff'
    | 'shipDamaged'
    | 'ordnanceLaunched'
    | 'ordnanceDestroyed'
    | 'enemyDetected'
    | 'baseDestroyed'
    | 'victory'
    | 'defeat'
    | 'turnAdvanced'
    | 'phaseChanged';
  // Human-readable one-liner. Agents may ignore this and read the fields.
  message: string;
  // Side: whose ship/ordnance/base. 'self' or 'opponent' relative to the
  // observing player. Omitted for kinds that don't have a natural owner
  // (turnAdvanced, phaseChanged).
  side?: 'self' | 'opponent';
  // Entity IDs when applicable.
  shipId?: string;
  ordnanceId?: string;
  // Additional structured data, kind-specific.
  data?: Record<string, unknown>;
}

export interface ActionEffectsResult {
  turnAdvanced: boolean;
  phaseChanged: boolean;
  effects: ActionEffect[];
}

const shipById = (state: GameState): Map<string, Ship> => {
  const map = new Map<string, Ship>();
  for (const ship of state.ships) map.set(ship.id as string, ship);
  return map;
};

const sideOf = (owner: PlayerId, playerId: PlayerId): 'self' | 'opponent' =>
  owner === playerId ? 'self' : 'opponent';

// True when neither before nor after the enemy ship is visible to playerId.
// Fog-of-war hide: an undetected enemy that stays undetected is invisible.
const hiddenFromPlayer = (
  prev: Ship | undefined,
  next: Ship | undefined,
  playerId: PlayerId,
): boolean => {
  const owner = (next ?? prev)?.owner;
  if (owner === undefined) return true;
  if (owner === playerId) return false;
  const wasDetected = prev?.detected ?? false;
  const isDetected = next?.detected ?? false;
  return !wasDetected && !isDetected;
};

export const computeActionEffects = (
  prev: GameState,
  next: GameState,
  playerId: PlayerId,
): ActionEffectsResult => {
  const effects: ActionEffect[] = [];
  const turnAdvanced = next.turnNumber > prev.turnNumber;
  const phaseChanged = next.phase !== prev.phase;

  // Turn / phase transitions (agents use these to pace their loop).
  if (turnAdvanced) {
    effects.push({
      kind: 'turnAdvanced',
      message: `Turn advanced to ${next.turnNumber}.`,
      data: { from: prev.turnNumber, to: next.turnNumber },
    });
  }
  if (phaseChanged) {
    effects.push({
      kind: 'phaseChanged',
      message: `Phase changed: ${prev.phase} → ${next.phase}.`,
      data: { from: prev.phase, to: next.phase },
    });
  }

  const prevShips = shipById(prev);
  const nextShips = shipById(next);

  // Ship lifecycle / damage changes.
  for (const [id, after] of nextShips) {
    const before = prevShips.get(id);
    if (hiddenFromPlayer(before, after, playerId)) continue;
    const side = sideOf(after.owner, playerId);

    // Newly detected (enemy only — own ships are always "detected" from
    // our perspective; this is about fog-of-war revealing the opponent).
    if (side === 'opponent' && after.detected && !(before?.detected ?? false)) {
      effects.push({
        kind: 'enemyDetected',
        message: `Enemy ${after.type} ${id} is now detected.`,
        side,
        shipId: id,
        data: { position: after.position, velocity: after.velocity },
      });
    }

    if (!before) continue;

    if (before.lifecycle !== 'destroyed' && after.lifecycle === 'destroyed') {
      effects.push({
        kind: 'shipDestroyed',
        message:
          side === 'self'
            ? `Your ${after.type} ${id} was destroyed (${after.deathCause ?? 'unknown cause'}).`
            : `Enemy ${after.type} ${id} destroyed (${after.deathCause ?? 'unknown cause'}).`,
        side,
        shipId: id,
        data: { deathCause: after.deathCause, killedBy: after.killedBy },
      });
      continue;
    }

    if (before.lifecycle !== 'landed' && after.lifecycle === 'landed') {
      effects.push({
        kind: 'shipLanded',
        message:
          side === 'self'
            ? `Your ${after.type} ${id} landed.`
            : `Enemy ${after.type} ${id} landed.`,
        side,
        shipId: id,
        data: { position: after.position },
      });
    }

    if (before.lifecycle === 'landed' && after.lifecycle === 'active') {
      effects.push({
        kind: 'shipTookOff',
        message:
          side === 'self'
            ? `Your ${after.type} ${id} took off.`
            : `Enemy ${after.type} ${id} took off.`,
        side,
        shipId: id,
      });
    }

    const beforeDisabled = before.damage.disabledTurns;
    const afterDisabled = after.damage.disabledTurns;
    if (afterDisabled > beforeDisabled) {
      effects.push({
        kind:
          afterDisabled > 0 && beforeDisabled === 0
            ? 'shipDisabled'
            : 'shipDamaged',
        message:
          side === 'self'
            ? `Your ${after.type} ${id} took damage (disabled ${afterDisabled} turn${afterDisabled === 1 ? '' : 's'}).`
            : `Enemy ${after.type} ${id} damaged (disabled ${afterDisabled} turn${afterDisabled === 1 ? '' : 's'}).`,
        side,
        shipId: id,
        data: {
          disabledTurnsBefore: beforeDisabled,
          disabledTurnsAfter: afterDisabled,
        },
      });
    }
  }

  // Ship IDs that disappeared entirely (rare — usually lifecycle flips to
  // 'destroyed' first, but event-sourced projections may drop them).
  for (const [id, before] of prevShips) {
    if (nextShips.has(id)) continue;
    if (hiddenFromPlayer(before, undefined, playerId)) continue;
    const side = sideOf(before.owner, playerId);
    effects.push({
      kind: 'shipDestroyed',
      message:
        side === 'self'
          ? `Your ${before.type} ${id} removed from play.`
          : `Enemy ${before.type} ${id} removed from play.`,
      side,
      shipId: id,
    });
  }

  // Ordnance launch/destroy. Enemy ordnance is always visible once it exists
  // on the board (there is no undetected ordnance projection).
  const prevOrd = new Map(prev.ordnance.map((o) => [o.id as string, o]));
  const nextOrd = new Map(next.ordnance.map((o) => [o.id as string, o]));
  for (const [id, after] of nextOrd) {
    const before = prevOrd.get(id);
    const side = sideOf(after.owner, playerId);
    if (!before) {
      effects.push({
        kind: 'ordnanceLaunched',
        message:
          side === 'self'
            ? `You launched ${after.type} ${id}.`
            : `Enemy launched ${after.type} ${id}.`,
        side,
        ordnanceId: id,
        data: { position: after.position, velocity: after.velocity },
      });
      continue;
    }
    if (before.lifecycle !== 'destroyed' && after.lifecycle === 'destroyed') {
      effects.push({
        kind: 'ordnanceDestroyed',
        message:
          side === 'self'
            ? `Your ${after.type} ${id} expired or was destroyed.`
            : `Enemy ${after.type} ${id} destroyed.`,
        side,
        ordnanceId: id,
      });
    }
  }
  for (const [id, before] of prevOrd) {
    if (nextOrd.has(id)) continue;
    const side = sideOf(before.owner, playerId);
    effects.push({
      kind: 'ordnanceDestroyed',
      message:
        side === 'self'
          ? `Your ${before.type} ${id} removed from play.`
          : `Enemy ${before.type} ${id} removed from play.`,
      side,
      ordnanceId: id,
    });
  }

  // Base destruction (player.bases vs destroyedBases deltas).
  const prevDestroyed = new Set(prev.destroyedBases);
  for (const key of next.destroyedBases) {
    if (!prevDestroyed.has(key)) {
      effects.push({
        kind: 'baseDestroyed',
        message: `Orbital base at ${key} was destroyed.`,
        data: { hexKey: key },
      });
    }
  }

  // Victory / defeat.
  if (prev.phase !== 'gameOver' && next.phase === 'gameOver') {
    const outcome = next.outcome;
    if (outcome) {
      const isWinner = outcome.winner === playerId;
      effects.push({
        kind: isWinner ? 'victory' : 'defeat',
        message: `${isWinner ? 'Victory' : 'Defeat'}: ${outcome.reason}.`,
        data: { reason: outcome.reason, winner: outcome.winner },
      });
    } else {
      effects.push({
        kind: 'defeat',
        message: 'Game over (no outcome recorded).',
      });
    }
  }

  return { turnAdvanced, phaseChanged, effects };
};
