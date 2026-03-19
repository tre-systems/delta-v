import {
  type CombatResolution,
  canAttack,
  computeGroupRangeModToTarget,
  computeGroupVelocityModToTarget,
  hasBaseLineOfSight,
  hasLineOfSight,
  hasLineOfSightToTarget,
  lookupGunCombat,
  resolveBaseDefense,
  resolveCombat,
  rollD6,
} from '../combat';
import { SHIP_STATS } from '../constants';
import { hexDistance, hexKey } from '../hex';
import type { CombatAttack, CombatResult, GameState, Ordnance, Ship, SolarSystemMap } from '../types';
import { sumBy } from '../util';
import { resolvePendingAsteroidHazards } from './ordnance';
import { getOwnedPlanetaryBases, hasAnyEnemyShips, isPlanetaryDefenseEnabled } from './util';
import { advanceTurn, checkGameEnd, updateEscapeMoralVictory } from './victory';

export interface CombatPhaseResult {
  results: CombatResult[];
  state: GameState;
}

const toCombatResult = (r: CombatResolution): CombatResult => ({
  attackerIds: r.attackerIds,
  targetId: r.targetId,
  targetType: 'ship',
  attackType: 'gun',
  odds: r.odds,
  attackStrength: r.attackStrength,
  defendStrength: r.defendStrength,
  rangeMod: r.rangeMod,
  velocityMod: r.velocityMod,
  dieRoll: r.dieRoll,
  modifiedRoll: r.modifiedRoll,
  damageType: r.damageResult.type,
  disabledTurns: r.damageResult.disabledTurns,
  counterattack: r.counterattack ? toCombatResult(r.counterattack) : null,
});

const resolveAntiNukeAttack = (attackers: Ship[], target: Ordnance, rng: () => number): CombatResult => {
  const rangeMod = computeGroupRangeModToTarget(attackers, target);
  const velocityMod = computeGroupVelocityModToTarget(attackers, target);
  const dieRoll = rollD6(rng);
  const modifiedRoll = dieRoll - rangeMod - velocityMod;
  const rolledResult = lookupGunCombat('2:1', modifiedRoll);
  const destroyed = rolledResult.type !== 'none';
  if (destroyed) {
    target.destroyed = true;
  }

  return {
    attackerIds: attackers.map((ship) => ship.id),
    targetId: target.id,
    targetType: 'ordnance',
    attackType: 'antiNuke',
    odds: '2:1',
    attackStrength: 0,
    defendStrength: 0,
    rangeMod,
    velocityMod,
    dieRoll,
    modifiedRoll,
    damageType: destroyed ? 'eliminated' : 'none',
    disabledTurns: 0,
    counterattack: null,
  };
};

const hasManualCombatTargets = (state: GameState, map: SolarSystemMap): boolean => {
  const attackers = state.ships.filter((s) => s.owner === state.activePlayer && !s.destroyed && canAttack(s));
  if (attackers.length === 0) return false;

  if (
    state.ships.some(
      (target) =>
        target.owner !== state.activePlayer &&
        !target.destroyed &&
        !target.landed &&
        attackers.some((attacker) => hasLineOfSight(attacker, target, map)),
    )
  ) {
    return true;
  }

  return state.ordnance.some(
    (ord) =>
      ord.type === 'nuke' &&
      ord.owner !== state.activePlayer &&
      !ord.destroyed &&
      attackers.some((attacker) => hasLineOfSightToTarget(attacker, ord, map)),
  );
};

const hasBaseDefenseTargets = (state: GameState, map: SolarSystemMap): boolean => {
  for (const { coord: baseCoord } of getOwnedPlanetaryBases(state, state.activePlayer, map)) {
    const baseHex = map.hexes.get(hexKey(baseCoord));
    const bodyName = baseHex?.base?.bodyName;
    if (!bodyName) continue;
    for (const ship of state.ships) {
      if (ship.owner === state.activePlayer || ship.destroyed || ship.landed) continue;
      const shipHex = map.hexes.get(hexKey(ship.position));
      if (!shipHex?.gravity || shipHex.gravity.bodyName !== bodyName) continue;
      if (hexDistance(ship.position, baseCoord) === 1) {
        return true;
      }
    }
    for (const ord of state.ordnance) {
      if (ord.owner === state.activePlayer || ord.destroyed || ord.type !== 'nuke') continue;
      if (hasBaseLineOfSight(baseCoord, ord, map)) {
        return true;
      }
    }
  }

  return false;
};

const shouldRemainInCombatPhase = (state: GameState, map?: SolarSystemMap): boolean => {
  if (
    state.pendingAsteroidHazards.some((hazard) => {
      const ship = state.ships.find((s) => s.id === hazard.shipId);
      return ship?.owner === state.activePlayer && !ship.destroyed;
    })
  ) {
    return true;
  }
  if (state.scenarioRules.combatDisabled) return false;
  if (!map) {
    return hasAnyEnemyShips(state);
  }
  return hasManualCombatTargets(state, map) || (isPlanetaryDefenseEnabled(state) && hasBaseDefenseTargets(state, map));
};

/**
 * Resolve automatic combat-step effects that happen before attack declarations.
 */
export const beginCombatPhase = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
): CombatPhaseResult | { state: GameState } | { error: string } => {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const results = resolvePendingAsteroidHazards(state, playerId, rng);
  updateEscapeMoralVictory(state);
  if (map) {
    checkGameEnd(state, map);
  }
  if (state.winner !== null) {
    return results.length > 0 ? { results, state } : { state };
  }

  if (!shouldRemainInCombatPhase(state, map)) {
    advanceTurn(state);
    return results.length > 0 ? { results, state } : { state };
  }

  return results.length > 0 ? { results, state } : { state };
};

/**
 * Process combat attacks for the active player.
 */
export const processCombat = (
  state: GameState,
  playerId: number,
  attacks: CombatAttack[],
  map: SolarSystemMap,
  rng: () => number,
): CombatPhaseResult | { error: string } => {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const results = resolvePendingAsteroidHazards(state, playerId, rng);
  updateEscapeMoralVictory(state);
  if (state.winner === null) {
    checkGameEnd(state, map);
  }
  if (state.winner !== null) {
    return { results, state };
  }

  if (state.scenarioRules.combatDisabled && attacks.length > 0) {
    return { error: 'Combat is not allowed in this scenario' };
  }

  const committedAttackers = new Map<string, string>();
  const committedTargets = new Set<string>();
  const attackGroups = new Map<
    string,
    {
      maxStrength: number;
      allocatedStrength: number;
      targetHexKey: string | null;
      targetType: 'ship' | 'ordnance';
    }
  >();

  for (const attack of attacks) {
    const attackSeen = new Set<string>();
    const attackers: Ship[] = [];
    const groupKey = [...attack.attackerIds].sort().join('|');

    for (const id of attack.attackerIds) {
      if (attackSeen.has(id)) {
        return { error: 'Each ship may appear at most once in an attack declaration' };
      }
      const existingGroup = committedAttackers.get(id);
      if (existingGroup && existingGroup !== groupKey) {
        return { error: 'Each ship may attack only once per combat phase' };
      }

      const ship = state.ships.find((s) => s.id === id);
      if (!ship || ship.owner !== playerId) {
        return { error: 'Invalid attacker selection' };
      }
      if (!existingGroup && !canAttack(ship)) {
        return { error: 'Invalid attacker selection' };
      }

      attackSeen.add(id);
      attackers.push(ship);
    }

    if (attackers.length === 0) {
      return { error: 'Invalid attacker selection' };
    }

    const targetType = attack.targetType ?? 'ship';
    const targetKey = `${targetType}:${attack.targetId}`;
    const maxAttackStrength = sumBy(attackers, (ship) => SHIP_STATS[ship.type]?.combat ?? 0);
    if (committedTargets.has(targetKey)) {
      return { error: 'Each ship may be attacked only once per combat phase' };
    }

    let group = attackGroups.get(groupKey);
    for (const attacker of attackers) {
      committedAttackers.set(attacker.id, groupKey);
    }
    if (!group) {
      group = {
        maxStrength: maxAttackStrength,
        allocatedStrength: 0,
        targetHexKey: null,
        targetType,
      };
      attackGroups.set(groupKey, group);
    } else if (group.targetType !== targetType) {
      return { error: 'An attacking group cannot split fire between ship and ordnance targets' };
    }

    const remainingStrength = group.maxStrength - group.allocatedStrength;
    if (remainingStrength <= 0) {
      return { error: 'Attack group has no strength remaining to allocate' };
    }
    committedTargets.add(targetKey);

    if (targetType === 'ordnance') {
      if (group.allocatedStrength > 0) {
        return { error: 'Split fire is only supported against ships in the same hex' };
      }
      if (attack.attackStrength != null) {
        return { error: 'Reduced-strength attacks are only supported against ships' };
      }
      const target = state.ordnance.find((o) => o.id === attack.targetId);
      if (!target || target.owner === playerId || target.destroyed || target.type !== 'nuke') {
        return { error: 'Invalid combat target' };
      }
      if (map && attackers.some((attacker) => !hasLineOfSightToTarget(attacker, target, map))) {
        return { error: 'Attacker lacks line of sight to target' };
      }
      group.allocatedStrength = group.maxStrength;
      results.push(resolveAntiNukeAttack(attackers, target, rng));
      continue;
    }

    const target = state.ships.find((s) => s.id === attack.targetId);
    if (!target || target.owner === playerId || target.destroyed || target.landed) {
      return { error: 'Invalid combat target' };
    }
    const targetHexKey = hexKey(target.position);
    if (group.targetHexKey && group.targetHexKey !== targetHexKey) {
      return { error: 'Split fire may only target ships in the same hex' };
    }
    if (attack.attackStrength != null) {
      if (
        !Number.isInteger(attack.attackStrength) ||
        attack.attackStrength < 1 ||
        attack.attackStrength > remainingStrength
      ) {
        return { error: 'Invalid declared attack strength' };
      }
    }
    if (map && attackers.some((attacker) => !hasLineOfSight(attacker, target, map))) {
      return { error: 'Attacker lacks line of sight to target' };
    }

    const allocatedStrength = attack.attackStrength ?? remainingStrength;
    group.targetHexKey = targetHexKey;
    group.allocatedStrength += allocatedStrength;

    const resolution = resolveCombat(attackers, target, state.ships, rng, map, allocatedStrength);
    results.push(toCombatResult(resolution));
  }

  if (map && isPlanetaryDefenseEnabled(state)) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);
    results.push(...baseResults);
  }

  state.ordnance = state.ordnance.filter((o) => !o.destroyed);
  updateEscapeMoralVictory(state);

  checkGameEnd(state, map);

  if (state.winner === null) {
    advanceTurn(state);
  }

  return { results, state };
};

/**
 * Skip combat phase (player has no attacks to make).
 */
export const skipCombat = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
): { state: GameState; results?: CombatResult[] } | { error: string } => {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const results = resolvePendingAsteroidHazards(state, playerId, rng);
  updateEscapeMoralVictory(state);
  if (map) {
    checkGameEnd(state, map);
  }
  if (state.winner !== null) {
    return results.length > 0 ? { state, results } : { state };
  }

  if (map && isPlanetaryDefenseEnabled(state)) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);
    results.push(...baseResults);
    updateEscapeMoralVictory(state);
    checkGameEnd(state, map);
  }

  if (state.winner === null) {
    advanceTurn(state);
  }

  return results.length > 0 ? { state, results } : { state };
};

/**
 * Determine whether the active player should enter combat after movement.
 */
export const shouldEnterCombatPhase = (state: GameState, map: SolarSystemMap): boolean => {
  if (
    state.pendingAsteroidHazards.some((hazard) => {
      const ship = state.ships.find((s) => s.id === hazard.shipId);
      return ship?.owner === state.activePlayer && !ship.destroyed;
    })
  ) {
    return true;
  }

  // No gun/base combat in race scenarios (asteroid hazards still resolve above)
  if (state.scenarioRules.combatDisabled) return false;

  if (isPlanetaryDefenseEnabled(state) && hasBaseDefenseTargets(state, map)) {
    return true;
  }

  return hasManualCombatTargets(state, map);
};
