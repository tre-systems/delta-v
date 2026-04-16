// Enriches raw C2S candidates with a human-readable label, a short reasoning
// string, and a crude risk tag so LLM agents can reason about trade-offs
// without re-deriving them from the structured state.

import {
  computeGroupRangeMod,
  computeGroupVelocityMod,
  computeOdds,
  getCombatStrength,
} from '../combat';
import { SHIP_STATS } from '../constants';
import { HEX_DIRECTIONS, hexDistance } from '../hex';
import type { GameState, PlayerId, Ship } from '../types/domain';
import type { C2S } from '../types/protocol';
import { describeCandidate } from './describe';

export interface LabeledCandidate {
  index: number;
  action: C2S;
  label: string;
  reasoning: string;
  risk: 'low' | 'medium' | 'high';
}

// --- Shared helpers ---

const findShip = (state: GameState, id: string): Ship | undefined =>
  state.ships.find((s) => s.id === id);

const getEnemyShips = (state: GameState, playerId: PlayerId): Ship[] => {
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  return state.ships.filter(
    (s) => s.owner === opponentId && s.lifecycle !== 'destroyed',
  );
};

// Find nearest enemy from a given hex position. Returns { id, distance } or
// null when no enemies exist. Used by astrogation projections and torpedo
// intercept prediction to avoid duplicating the inner distance loop.
const findNearestEnemy = (
  pos: { q: number; r: number },
  enemies: readonly Ship[],
): { id: string; distance: number } | null => {
  let best: { id: string; distance: number } | null = null;
  for (const enemy of enemies) {
    const d = hexDistance(pos, enemy.position);
    if (!best || d < best.distance) best = { id: enemy.id, distance: d };
  }
  return best;
};

// Heuristic risk tagging. Crude but consistent:
//   high  = nukes, surrender (irreversible, large consequences)
//   medium = overloads, ordnance, base emplacement, attacking undetected ships
//   low   = everything else (skips, normal burns, detected-target combat)
const riskFor = (
  action: C2S,
  state: GameState,
  playerId: PlayerId,
): LabeledCandidate['risk'] => {
  switch (action.type) {
    case 'skipOrdnance':
    case 'skipCombat':
    case 'skipLogistics':
    case 'chat':
    case 'ping':
    case 'rematch':
    case 'endCombat':
    case 'fleetReady':
    case 'beginCombat':
    case 'logistics':
      return 'low';

    case 'astrogation':
      return action.orders.some((o) => o.overload !== null) ? 'medium' : 'low';

    case 'surrender':
      return 'high';

    case 'ordnance':
      return action.launches.some((l) => l.ordnanceType === 'nuke')
        ? 'high'
        : 'medium';

    case 'emplaceBase':
      return 'medium';

    case 'combat':
    case 'combatSingle': {
      // Attacking undetected targets is risky; detected targets are routine.
      const attacks =
        action.type === 'combat' ? action.attacks : [action.attack];
      const enemyById = new Map(
        getEnemyShips(state, playerId).map((s) => [s.id as string, s]),
      );
      const anyUnseen = attacks.some((atk) => {
        const target = enemyById.get(String(atk.targetId));
        return target ? !target.detected : false;
      });
      return anyUnseen ? 'medium' : 'low';
    }

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};

// --- Combat odds ---

const describeCombatOdds = (
  attackerIds: readonly string[],
  targetId: string,
  state: GameState,
): string => {
  const attackers = attackerIds
    .map((id) => findShip(state, id))
    .filter((s): s is Ship => s != null);
  const target = findShip(state, targetId);
  if (attackers.length === 0 || !target) return '';

  const atkStr = getCombatStrength(attackers);
  const defStr = getCombatStrength([target]);
  const rangeMod = computeGroupRangeMod(attackers, target);
  const velMod = computeGroupVelocityMod(attackers, target);
  const odds = computeOdds(atkStr, defStr);
  return ` ${atkStr} vs ${defStr}, range -${rangeMod}, vel -${velMod}, odds ${odds}.`;
};

// --- Astrogation: fuel cost, projected destination, collision warnings ---
// Combined into one function to iterate orders once rather than twice.

const describeAstrogationDetails = (
  action: Extract<C2S, { type: 'astrogation' }>,
  state: GameState,
  playerId: PlayerId,
): string => {
  const enemies = getEnemyShips(state, playerId);
  const notes: string[] = [];
  let totalCost = 0;
  let totalFuelBefore = 0;
  let totalFuelCapacity = 0;

  for (const order of action.orders) {
    const ship = findShip(state, order.shipId);
    if (!ship || ship.owner !== playerId) continue;

    // Fuel accounting
    totalFuelBefore += ship.fuel;
    const stats = SHIP_STATS[ship.type];
    totalFuelCapacity += Number.isFinite(stats.fuel) ? stats.fuel : 0;
    if (order.burn !== null) totalCost += 1;
    if (order.overload !== null) totalCost += 1;

    // Project destination: velocity + burn + overload + pending gravity
    let dq = ship.velocity.dq;
    let dr = ship.velocity.dr;
    for (const burnDir of [order.burn, order.overload]) {
      if (burnDir !== null) {
        const dir = HEX_DIRECTIONS[burnDir];
        if (dir) {
          dq += dir.dq;
          dr += dir.dr;
        }
      }
    }
    for (const grav of ship.pendingGravityEffects ?? []) {
      if (grav.ignored) continue;
      const dir = HEX_DIRECTIONS[grav.direction];
      if (dir) {
        dq += dir.dq;
        dr += dir.dr;
      }
    }
    const destQ = ship.position.q + dq;
    const destR = ship.position.r + dr;
    const dest = { q: destQ, r: destR };

    // Warn if burn cancels velocity to zero — stationary ships are easy
    // ram targets and can't maneuver if disabled.
    let postBurnDq = ship.velocity.dq;
    let postBurnDr = ship.velocity.dr;
    for (const burnDir of [order.burn, order.overload]) {
      if (burnDir !== null) {
        const bDir = HEX_DIRECTIONS[burnDir];
        if (bDir) {
          postBurnDq += bDir.dq;
          postBurnDr += bDir.dr;
        }
      }
    }
    if (postBurnDq === 0 && postBurnDr === 0) {
      notes.push(
        `STATIONARY WARNING: ${ship.id} will have zero velocity after this burn.`,
      );
    }

    // Collision check: ram warning if landing on an enemy hex
    for (const enemy of enemies) {
      if (enemy.position.q === destQ && enemy.position.r === destR) {
        notes.push(
          `RAM WARNING: ${ship.id} -> (${destQ},${destR}) collides with ${enemy.id}!`,
        );
      }
    }

    // Sol proximity check (center q=-2 r=2, surface radius 2)
    const solDist = hexDistance(dest, { q: -2, r: 2 });
    if (solDist <= 2) {
      notes.push(
        `SOL DANGER: ${ship.id} -> (${destQ},${destR}) is ${solDist} hex from Sol!`,
      );
    }

    // Projected position + range to nearest enemy
    const nearest = findNearestEnemy(dest, enemies);
    if (nearest) {
      notes.push(
        `${ship.id} -> (${destQ},${destR}), range ${nearest.distance} to ${nearest.id}.`,
      );
    }
  }

  // Compose: fuel info (if any burns) + projection notes
  const parts: string[] = [];
  if (totalCost > 0) {
    const remaining = totalFuelBefore - totalCost;
    parts.push(
      `Fuel: -${totalCost}, remaining ${remaining}/${totalFuelCapacity}.`,
    );
  }
  parts.push(...notes);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
};

const reasoningFor = (
  action: C2S,
  index: number,
  state: GameState,
  playerId: PlayerId,
): string => {
  const recommended = index === 0;
  const prefix = recommended
    ? 'Hard-difficulty AI recommendation'
    : index === 1
      ? 'Normal-difficulty alternative'
      : index === 2
        ? 'Easy-difficulty alternative'
        : 'Bare skip option';

  switch (action.type) {
    case 'astrogation': {
      const burns = action.orders.filter((o) => o.burn !== null).length;
      const overloads = action.orders.filter((o) => o.overload !== null).length;
      const coasting = action.orders.filter((o) => o.burn === null).length;
      const bits = [];
      if (burns > 0) bits.push(`${burns} burn${burns === 1 ? '' : 's'}`);
      if (overloads > 0)
        bits.push(`${overloads} overload${overloads === 1 ? '' : 's'}`);
      if (coasting > 0) bits.push(`${coasting} coasting`);
      const details = describeAstrogationDetails(action, state, playerId);
      return `${prefix}: astrogation (${bits.join(', ') || 'no movement'}) on turn ${state.turnNumber}.${details}`;
    }
    case 'ordnance': {
      const enemies = getEnemyShips(state, playerId);
      const launchDetails = action.launches
        .map((l) => {
          const ship = findShip(state, l.shipId);
          if (!ship) return l.ordnanceType;
          // Predict torpedo first-turn position: ship velocity + accel
          if (
            l.ordnanceType === 'torpedo' &&
            l.torpedoAccel != null &&
            l.torpedoAccelSteps
          ) {
            const accelDir = HEX_DIRECTIONS[l.torpedoAccel];
            if (accelDir) {
              const tDq = ship.velocity.dq + accelDir.dq * l.torpedoAccelSteps;
              const tDr = ship.velocity.dr + accelDir.dr * l.torpedoAccelSteps;
              const dest = {
                q: ship.position.q + tDq,
                r: ship.position.r + tDr,
              };
              const nearest = findNearestEnemy(dest, enemies);
              if (nearest) {
                return `torpedo -> (${dest.q},${dest.r}), ${nearest.distance} hex from ${nearest.id}`;
              }
            }
          }
          return l.ordnanceType;
        })
        .join(', ');
      return `${prefix}: launch ${action.launches.length} ordnance (${launchDetails}).`;
    }
    case 'combat': {
      const targets = new Set(action.attacks.map((a) => a.targetId));
      const oddsDetails = action.attacks
        .map((a) =>
          describeCombatOdds(
            a.attackerIds.map(String),
            String(a.targetId),
            state,
          ),
        )
        .filter(Boolean)
        .join(' ');
      return `${prefix}: ${action.attacks.length} attacks on ${targets.size} target${targets.size === 1 ? '' : 's'}.${oddsDetails}`;
    }
    case 'combatSingle': {
      const oddsDetail = describeCombatOdds(
        action.attack.attackerIds.map(String),
        String(action.attack.targetId),
        state,
      );
      return `${prefix}: single attack on ${action.attack.targetId}.${oddsDetail}`;
    }
    case 'logistics':
      return `${prefix}: ${action.transfers.length} transfers.`;
    case 'fleetReady':
      return `${prefix}: purchase ${action.purchases.length} ships.`;
    case 'skipOrdnance':
      return `${prefix}: skip ordnance phase — preserve munitions for a clearer shot.`;
    case 'skipCombat':
      return `${prefix}: skip combat — no worthwhile engagement available.`;
    case 'skipLogistics':
      return `${prefix}: skip logistics — no beneficial transfers available.`;
    case 'beginCombat':
      return `${prefix}: begin combat phase (resolve asteroid hazards).`;
    case 'endCombat':
      return `${prefix}: end combat phase.`;
    case 'surrender':
      return `${prefix}: surrender ${action.shipIds.length} ships.`;
    case 'emplaceBase':
      return `${prefix}: emplace ${action.emplacements.length} base${action.emplacements.length === 1 ? '' : 's'}.`;
    case 'rematch':
      return `${prefix}: request rematch.`;
    case 'chat':
      return `${prefix}: chat message.`;
    case 'ping':
      return `${prefix}: keep-alive ping.`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};

export const labelCandidate = (
  action: C2S,
  index: number,
  state: GameState,
  playerId: PlayerId,
): LabeledCandidate => ({
  index,
  action,
  label: describeCandidate(action, index),
  reasoning: reasoningFor(action, index, state, playerId),
  risk: riskFor(action, state, playerId),
});

export const labelCandidates = (
  candidates: readonly C2S[],
  state: GameState,
  playerId: PlayerId,
): LabeledCandidate[] =>
  candidates.map((action, index) =>
    labelCandidate(action, index, state, playerId),
  );
