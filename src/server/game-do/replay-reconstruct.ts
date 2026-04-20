// Reconstruct live-style `movementResult` / `combatResult` S2C messages from
// a batch of engine events. This is what archived replays replay through —
// the live pipeline only persists engine events (no S2C payloads), so we
// rebuild the movement/combat batches here so the client's animation and
// log pipeline fires as if it were a live match.

import type { EngineEvent } from '../../shared/engine/engine-events';
import type { ReplayMessage } from '../../shared/replay';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  ShipMovement,
} from '../../shared/types/domain';

const isMovementish = (event: EngineEvent): boolean =>
  event.type === 'shipMoved' ||
  event.type === 'ordnanceMoved' ||
  event.type === 'ordnanceLaunched';

const isCombatish = (event: EngineEvent): boolean =>
  event.type === 'combatAttack';

const shipMovementOutcome = (
  shipMoved: Extract<EngineEvent, { type: 'shipMoved' }>,
  events: EngineEvent[],
): ShipMovement => {
  const base = {
    shipId: shipMoved.shipId,
    from: shipMoved.from,
    to: shipMoved.to,
    path: shipMoved.path,
    newVelocity: shipMoved.newVelocity,
    fuelSpent: shipMoved.fuelSpent,
    gravityEffects: shipMoved.pendingGravityEffects,
  };

  const landed = events.find(
    (e): e is Extract<EngineEvent, { type: 'shipLanded' }> =>
      e.type === 'shipLanded' && e.shipId === shipMoved.shipId,
  );
  if (landed) {
    return { ...base, outcome: 'landing', landedAt: landed.landedAt };
  }

  const crashed = events.some(
    (e) => e.type === 'shipCrashed' && e.shipId === shipMoved.shipId,
  );
  if (crashed) {
    return { ...base, outcome: 'crash' };
  }

  return { ...base, outcome: 'normal' };
};

const ordnanceMovementFrom = (
  moved: Extract<EngineEvent, { type: 'ordnanceMoved' }>,
  events: EngineEvent[],
  previousState: GameState | null,
): OrdnanceMovement => {
  const detonated = events.some(
    (e) => e.type === 'ordnanceDetonated' && e.ordnanceId === moved.ordnanceId,
  );
  const priorOrd = previousState?.ordnance.find(
    (item) => item.id === moved.ordnanceId,
  );
  const from = priorOrd?.position ?? moved.position;
  return {
    ordnanceId: moved.ordnanceId,
    owner: priorOrd?.owner,
    ordnanceType: priorOrd?.type,
    from,
    to: moved.position,
    path: [from, moved.position],
    detonated,
  };
};

// Map relevant engine events to the client-facing MovementEvent log entries
// (crash banner, ramming, torpedo/nuke hits, captures). These drive the
// in-match log lines so replays read the same way a live match does.
const toMovementEvents = (events: EngineEvent[]): MovementEvent[] => {
  const out: MovementEvent[] = [];
  for (const event of events) {
    if (event.type === 'shipCrashed') {
      out.push({
        type: 'crash',
        shipId: event.shipId,
        hex: event.hex,
        dieRoll: 0,
        damageType: 'eliminated',
        disabledTurns: 0,
      });
    } else if (event.type === 'ramming') {
      out.push({
        type: 'ramming',
        shipId: event.shipId,
        hex: event.hex,
        dieRoll: event.roll,
        damageType: event.damageType,
        disabledTurns: event.disabledTurns,
      });
    } else if (event.type === 'ordnanceDetonated') {
      const logType: MovementEvent['type'] =
        event.ordnanceType === 'nuke'
          ? 'nukeDetonation'
          : event.ordnanceType === 'torpedo'
            ? 'torpedoHit'
            : 'mineDetonation';
      // Only emit a MovementEvent when the detonation hit a ship — the live
      // pipeline only logs hits, not whiffs.
      if (event.targetShipId) {
        out.push({
          type: logType,
          shipId: event.targetShipId,
          hex: event.hex,
          dieRoll: event.roll,
          damageType: event.damageType === 'none' ? 'none' : event.damageType,
          disabledTurns: event.disabledTurns,
          ordnanceId: event.ordnanceId,
        });
      }
    } else if (event.type === 'shipCaptured') {
      // Synthesize a capture log line keyed on the ship position — we don't
      // have the hex on the event itself, so the client consumer needs to
      // look it up from state. Emit with a zero hex; log code only uses
      // shipId/capturedBy.
      out.push({
        type: 'capture',
        shipId: event.shipId,
        hex: { q: 0, r: 0 },
        dieRoll: 0,
        damageType: 'captured',
        disabledTurns: 0,
        capturedBy: event.capturedByShipId,
      });
    }
  }
  return out;
};

const toCombatResults = (events: EngineEvent[]): CombatResult[] => {
  const out: CombatResult[] = [];
  for (const event of events) {
    if (event.type !== 'combatAttack') continue;
    out.push({
      attackerIds: event.attackerIds,
      targetId: event.targetId,
      targetType: event.targetType,
      attackType: event.attackType,
      // Engine event doesn't preserve the original odds/strength/range-mod
      // detail. The client only uses these for log formatting — fall back to
      // reasonable placeholders that still read correctly ("d6 -> modified
      // roll → DAMAGE").
      odds: '—',
      attackStrength: 0,
      defendStrength: 0,
      rangeMod: 0,
      velocityMod: 0,
      dieRoll: event.roll,
      modifiedRoll: event.modifiedRoll,
      damageType: event.damageType,
      disabledTurns: event.disabledTurns,
      counterattack: null,
    });
  }
  return out;
};

export const buildReplayMessageFromEvents = (
  events: EngineEvent[],
  nextState: GameState,
  previousState: GameState | null,
  isFirstEntry: boolean,
): ReplayMessage => {
  if (isFirstEntry) {
    return { type: 'gameStart', state: nextState };
  }

  if (events.some(isMovementish)) {
    const movements: ShipMovement[] = events
      .filter(
        (e): e is Extract<EngineEvent, { type: 'shipMoved' }> =>
          e.type === 'shipMoved',
      )
      .map((e) => shipMovementOutcome(e, events));

    const ordnanceMovements: OrdnanceMovement[] = events
      .filter(
        (e): e is Extract<EngineEvent, { type: 'ordnanceMoved' }> =>
          e.type === 'ordnanceMoved',
      )
      .map((e) => ordnanceMovementFrom(e, events, previousState));

    return {
      type: 'movementResult',
      movements,
      ordnanceMovements,
      events: toMovementEvents(events),
      state: nextState,
    };
  }

  if (events.some(isCombatish)) {
    return {
      type: 'combatResult',
      results: toCombatResults(events),
      state: nextState,
    };
  }

  return { type: 'stateUpdate', state: nextState };
};
