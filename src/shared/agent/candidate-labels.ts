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

// Heuristic risk tagging. Skip actions are always low risk. Nukes are high.
// Overload burns and multi-attacker combat against unseen targets skew medium.
// This is deliberately crude — it gives the LLM a prior, not a verdict.
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
      return 'low';

    case 'fleetReady':
      return 'low';

    case 'astrogation': {
      const hasOverload = action.orders.some((o) => o.overload !== null);
      return hasOverload ? 'medium' : 'low';
    }

    case 'surrender':
      return 'high';

    case 'ordnance': {
      const hasNuke = action.launches.some((l) => l.ordnanceType === 'nuke');
      return hasNuke ? 'high' : 'medium';
    }

    case 'emplaceBase':
      return 'medium';

    case 'beginCombat':
      return 'low';

    case 'combat':
    case 'combatSingle': {
      // Attacking an undetected target we think we know about is risky.
      // An attack against a resolved (detected) ship is low risk; targeting
      // ordnance is always low risk. Ships missing from the projection get
      // treated as unseen.
      const attacks =
        action.type === 'combat' ? action.attacks : [action.attack];
      const opponentId: PlayerId = playerId === 0 ? 1 : 0;
      const enemyShipIds = new Set(
        state.ships
          .filter((s) => s.owner === opponentId)
          .map((s) => s.id as string),
      );
      const enemyById = new Map(
        state.ships
          .filter((s) => s.owner === opponentId)
          .map((s) => [s.id as string, s] as const),
      );
      const anyUnseen = attacks.some((atk) => {
        const targetId = atk.targetId as unknown as string;
        if (!enemyShipIds.has(targetId)) return false; // targeting ordnance
        const target = enemyById.get(targetId);
        return target ? !target.detected : true;
      });
      return anyUnseen ? 'medium' : 'low';
    }

    case 'logistics':
      return 'low';

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};

const findShip = (state: GameState, id: string): Ship | undefined =>
  state.ships.find((s) => s.id === id);

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

const describeAstrogationCost = (
  action: Extract<C2S, { type: 'astrogation' }>,
  state: GameState,
  playerId: PlayerId,
): string => {
  let totalCost = 0;
  let totalFuelBefore = 0;
  for (const order of action.orders) {
    const ship = findShip(state, order.shipId);
    if (!ship || ship.owner !== playerId) continue;
    totalFuelBefore += ship.fuel;
    if (order.burn !== null) totalCost += 1;
    if (order.overload !== null) totalCost += 1;
  }
  if (totalCost === 0) return '';
  const maxFuel = action.orders.reduce((sum, o) => {
    const ship = findShip(state, o.shipId);
    if (!ship || ship.owner !== playerId) return sum;
    const stats = SHIP_STATS[ship.type];
    return sum + (Number.isFinite(stats.fuel) ? stats.fuel : 0);
  }, 0);
  const remaining = totalFuelBefore - totalCost;
  return ` Fuel: -${totalCost}, remaining ${remaining}/${maxFuel}.`;
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
      const fuelInfo = describeAstrogationCost(action, state, playerId);
      return `${prefix}: astrogation (${bits.join(', ') || 'no movement'}) on turn ${state.turnNumber}.${fuelInfo}`;
    }
    case 'ordnance':
      return `${prefix}: launch ${action.launches.length} ordnance (${action.launches
        .map((l) => l.ordnanceType)
        .join(', ')}).`;
    case 'combat': {
      const targets = new Set(action.attacks.map((a) => a.targetId));
      const oddsDetails = action.attacks
        .map((a) =>
          describeCombatOdds(a.attackerIds as string[], a.targetId, state),
        )
        .filter(Boolean)
        .join(' ');
      return `${prefix}: ${action.attacks.length} attacks on ${targets.size} target${targets.size === 1 ? '' : 's'}.${oddsDetails}`;
    }
    case 'combatSingle': {
      const oddsDetail = describeCombatOdds(
        action.attack.attackerIds as string[],
        action.attack.targetId,
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
