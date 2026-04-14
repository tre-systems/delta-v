// Human-readable prose describers used by the agent `summary` field.
// Pure functions over state; safe in browser and Worker runtimes.

import { SHIP_STATS } from '../constants';
import type { HexCoord, HexVec } from '../hex';
import { hexDistance } from '../hex';
import type { CelestialBody, Ship } from '../types/domain';
import type { C2S } from '../types/protocol';

export const DIRECTION_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const;

export const nearestBody = (
  pos: HexCoord,
  bodies: CelestialBody[],
): { name: string; distance: number } => {
  let best = { name: 'deep space', distance: Infinity };
  for (const body of bodies) {
    const dist = hexDistance(pos, body.center);
    if (dist < best.distance) {
      best = { name: body.name, distance: dist };
    }
  }
  return best;
};

export const describePosition = (
  pos: HexCoord,
  bodies: CelestialBody[],
): string => {
  const closest = nearestBody(pos, bodies);
  if (closest.distance === 0) return `on ${closest.name}`;
  if (closest.distance <= 3)
    return `${closest.distance} hex from ${closest.name}`;
  return `at (${pos.q},${pos.r}), ${closest.distance} hex from ${closest.name}`;
};

export const describeVelocity = (vel: HexVec): string => {
  const speed = Math.max(
    Math.abs(vel.dq),
    Math.abs(vel.dr),
    Math.abs(vel.dq + vel.dr),
  );
  return speed === 0 ? 'stationary' : `speed ${speed}`;
};

export const describeShip = (ship: Ship, bodies: CelestialBody[]): string => {
  const stats = SHIP_STATS[ship.type];
  const parts = [
    `${stats.name} "${ship.id}"`,
    describePosition(ship.position, bodies),
    describeVelocity(ship.velocity),
    `fuel ${ship.fuel}/${stats.fuel === Infinity ? 'inf' : stats.fuel}`,
  ];
  if (ship.lifecycle === 'landed') parts.push('LANDED');
  if (ship.lifecycle === 'destroyed') parts.push('DESTROYED');
  if (ship.damage.disabledTurns > 0)
    parts.push(`disabled ${ship.damage.disabledTurns}T`);
  return parts.join(', ');
};

export const describeCandidate = (action: C2S, index: number): string => {
  const prefix = index === 0 ? `[${index}] (recommended)` : `[${index}]`;
  switch (action.type) {
    case 'astrogation': {
      const burns = action.orders
        .map((o) => {
          if (o.burn === null) return `${o.shipId}: coast`;
          const dir = DIRECTION_NAMES[o.burn] ?? `dir${o.burn}`;
          const overload = o.overload !== null ? ' +overload' : '';
          return `${o.shipId}: burn ${dir}${overload}`;
        })
        .join('; ');
      return `${prefix} astrogation — ${burns}`;
    }
    case 'combat': {
      const attacks = action.attacks
        .map((a) => `${a.attackerIds.join('+')}->${a.targetId}`)
        .join('; ');
      return `${prefix} combat — ${attacks}`;
    }
    case 'ordnance': {
      const launches = action.launches
        .map((l) => `${l.shipId} launches ${l.ordnanceType}`)
        .join('; ');
      return `${prefix} ordnance — ${launches}`;
    }
    case 'logistics': {
      const transfers = action.transfers
        .map(
          (t) =>
            `${t.sourceShipId}->${t.targetShipId} ${t.amount} ${t.transferType}`,
        )
        .join('; ');
      return `${prefix} logistics — ${transfers}`;
    }
    case 'fleetReady':
      return `${prefix} fleet ready — ${action.purchases.length} purchases`;
    default:
      return `${prefix} ${action.type}`;
  }
};
