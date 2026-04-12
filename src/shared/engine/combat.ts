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
import { ANTI_NUKE_ODDS, SHIP_STATS } from '../constants';
import { hexDistance, hexKey } from '../hex';
import type { OrdnanceId, ShipId } from '../ids';
import {
  type CombatAttack,
  type CombatResult,
  type EngineError,
  ErrorCode,
  type GameState,
  type Ordnance,
  type PlayerId,
  type Ship,
  type SolarSystemMap,
} from '../types';
import { sumBy } from '../util';
import type { EngineEvent } from './engine-events';
import { shouldEnterLogisticsPhase } from './logistics';
import { resolvePendingAsteroidHazards } from './ordnance';
import {
  engineFailure,
  getOwnedPlanetaryBases,
  hasAnyEnemyShips,
  isPlanetaryDefenseEnabled,
  transitionPhaseWithEvent,
  validatePhaseAction,
} from './util';
import { advanceTurn, applyEscapeMoralVictory, checkGameEnd } from './victory';

// After combat resolves, transition to logistics if eligible,
// otherwise advance the turn directly.
const advanceAfterCombat = (
  state: GameState,
  engineEvents: EngineEvent[],
): void => {
  if (shouldEnterLogisticsPhase(state)) {
    transitionPhaseWithEvent(state, 'logistics', engineEvents);
  } else {
    advanceTurn(state, engineEvents);
  }
};

export interface CombatPhaseResult {
  results: CombatResult[];
  state: GameState;
  engineEvents: EngineEvent[];
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

const resolveAntiNukeAttack = (
  attackers: Ship[],
  target: Ordnance,
  rng: () => number,
): CombatResult => {
  const rangeMod = computeGroupRangeModToTarget(attackers, target);
  const velocityMod = computeGroupVelocityModToTarget(attackers, target);
  const dieRoll = rollD6(rng);
  const modifiedRoll = dieRoll - rangeMod - velocityMod;
  const rolledResult = lookupGunCombat(ANTI_NUKE_ODDS, modifiedRoll);
  const destroyed = rolledResult.type !== 'none';

  if (destroyed) {
    target.lifecycle = 'destroyed';
  }

  return {
    attackerIds: attackers.map((ship) => ship.id),
    targetId: target.id,
    targetType: 'ordnance',
    attackType: 'antiNuke',
    odds: ANTI_NUKE_ODDS,
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

export const hasManualCombatTargets = (
  state: GameState,
  map: SolarSystemMap,
): boolean => {
  const attackers = state.ships.filter(
    (s) =>
      s.owner === state.activePlayer &&
      s.lifecycle !== 'destroyed' &&
      canAttack(s),
  );

  if (attackers.length === 0) return false;

  if (
    state.ships.some(
      (target) =>
        target.owner !== state.activePlayer &&
        target.lifecycle === 'active' &&
        attackers.some((attacker) => hasLineOfSight(attacker, target, map)),
    )
  ) {
    return true;
  }

  return state.ordnance.some(
    (ord) =>
      ord.type === 'nuke' &&
      ord.owner !== state.activePlayer &&
      ord.lifecycle !== 'destroyed' &&
      attackers.some((attacker) => hasLineOfSightToTarget(attacker, ord, map)),
  );
};

const hasBaseDefenseTargets = (
  state: GameState,
  map: SolarSystemMap,
): boolean => {
  for (const { coord: baseCoord } of getOwnedPlanetaryBases(
    state,
    state.activePlayer,
    map,
  )) {
    const baseHex = map.hexes.get(hexKey(baseCoord));
    const bodyName = baseHex?.base?.bodyName;

    if (!bodyName) continue;

    for (const ship of state.ships) {
      if (ship.owner === state.activePlayer || ship.lifecycle !== 'active') {
        continue;
      }

      const shipHex = map.hexes.get(hexKey(ship.position));

      if (!shipHex?.gravity || shipHex.gravity.bodyName !== bodyName) {
        continue;
      }

      if (hexDistance(ship.position, baseCoord) === 1) {
        return true;
      }
    }

    for (const ord of state.ordnance) {
      if (
        ord.owner === state.activePlayer ||
        ord.lifecycle === 'destroyed' ||
        ord.type !== 'nuke'
      ) {
        continue;
      }

      if (hasBaseLineOfSight(baseCoord, ord, map)) {
        return true;
      }
    }
  }

  return false;
};

const shouldRemainInCombatPhase = (
  state: GameState,
  map?: SolarSystemMap,
): boolean => {
  if (
    state.pendingAsteroidHazards.some((hazard) => {
      const ship = state.ships.find((s) => s.id === hazard.shipId);
      return (
        ship?.owner === state.activePlayer && ship.lifecycle !== 'destroyed'
      );
    })
  ) {
    return true;
  }

  if (state.scenarioRules.combatDisabled) return false;

  if (!map) {
    return hasAnyEnemyShips(state);
  }

  return (
    hasManualCombatTargets(state, map) ||
    (isPlanetaryDefenseEnabled(state) && hasBaseDefenseTargets(state, map))
  );
};

const combatResultToEvents = (
  r: CombatResult,
  state: GameState,
): EngineEvent[] => {
  const events: EngineEvent[] = [
    {
      type: 'combatAttack',
      attackerIds: r.attackerIds,
      targetId: r.targetId,
      targetType: r.targetType,
      attackType: r.attackType,
      roll: r.dieRoll,
      modifiedRoll: r.modifiedRoll,
      damageType: r.damageType,
      disabledTurns: r.disabledTurns,
    },
  ];

  if (r.targetType === 'ship') {
    const target = state.ships.find((ship) => ship.id === r.targetId);
    if (r.damageType === 'eliminated' || target?.lifecycle === 'destroyed') {
      events.push({
        type: 'shipDestroyed',
        shipId: r.targetId as ShipId,
        cause: r.attackType,
      });
    }
  } else if (r.damageType === 'eliminated') {
    events.push({
      type: 'ordnanceDestroyed',
      ordnanceId: r.targetId as OrdnanceId,
      cause: r.attackType,
    });
  }

  if (r.counterattack) {
    events.push(...combatResultToEvents(r.counterattack, state));
  }

  return events;
};

// Resolve automatic combat-step effects that happen
// before attack declarations.
export const beginCombatPhase = (
  inputState: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  rng: () => number,
):
  | CombatPhaseResult
  | { state: GameState; engineEvents: EngineEvent[] }
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'combat');

  if (phaseError) return { error: phaseError };

  const results = resolvePendingAsteroidHazards(state, playerId, rng);

  for (const r of results) {
    engineEvents.push(...combatResultToEvents(r, state));
  }

  applyEscapeMoralVictory(state);

  if (map) {
    checkGameEnd(state, map, engineEvents);
  }

  if (state.outcome !== null) {
    return results.length > 0
      ? { results, state, engineEvents }
      : { state, engineEvents };
  }

  if (!shouldRemainInCombatPhase(state, map)) {
    advanceAfterCombat(state, engineEvents);

    return results.length > 0
      ? { results, state, engineEvents }
      : { state, engineEvents };
  }

  return results.length > 0
    ? { results, state, engineEvents }
    : { state, engineEvents };
};

// Process combat attacks for the active player.
export const processCombat = (
  inputState: GameState,
  playerId: PlayerId,
  attacks: CombatAttack[],
  map: SolarSystemMap,
  rng: () => number,
): CombatPhaseResult | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'combat');

  if (phaseError) return { error: phaseError };

  const results = resolvePendingAsteroidHazards(state, playerId, rng);

  for (const r of results) {
    engineEvents.push(...combatResultToEvents(r, state));
  }

  applyEscapeMoralVictory(state);

  if (state.outcome === null) {
    checkGameEnd(state, map, engineEvents);
  }

  if (state.outcome !== null) {
    return { results, state, engineEvents };
  }

  const hazardCount = results.length;

  if (state.scenarioRules.combatDisabled && attacks.length > 0) {
    return engineFailure(
      ErrorCode.NOT_ALLOWED,
      'Combat is not allowed in this scenario',
    );
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
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          'Each ship may appear at most once in an attack declaration',
        );
      }

      const existingGroup = committedAttackers.get(id);

      if (existingGroup && existingGroup !== groupKey) {
        return engineFailure(
          ErrorCode.STATE_CONFLICT,
          'Each ship may attack only once per combat phase',
        );
      }

      const ship = state.ships.find((s) => s.id === id);

      if (!ship || ship.owner !== playerId) {
        return engineFailure(
          ErrorCode.INVALID_SELECTION,
          'Invalid attacker selection',
        );
      }

      if (!existingGroup && !canAttack(ship)) {
        return engineFailure(
          ErrorCode.INVALID_SELECTION,
          'Invalid attacker selection',
        );
      }

      attackSeen.add(id);
      attackers.push(ship);
    }

    if (attackers.length === 0) {
      return engineFailure(
        ErrorCode.INVALID_SELECTION,
        'Invalid attacker selection',
      );
    }

    const { targetType } = attack;
    const targetKey = `${targetType}:${attack.targetId}`;

    const maxAttackStrength = sumBy(
      attackers,
      (ship) => SHIP_STATS[ship.type]?.combat ?? 0,
    );

    if (committedTargets.has(targetKey)) {
      return engineFailure(
        ErrorCode.STATE_CONFLICT,
        'Each ship may be attacked only once per combat phase',
      );
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
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'An attacking group cannot split fire between ship and ordnance targets',
      );
    }

    const remainingStrength = group.maxStrength - group.allocatedStrength;

    if (remainingStrength <= 0) {
      return engineFailure(
        ErrorCode.RESOURCE_LIMIT,
        'Attack group has no strength remaining to allocate',
      );
    }

    committedTargets.add(targetKey);

    if (targetType === 'ordnance') {
      if (group.allocatedStrength > 0) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          'Split fire is only supported against ships in the same hex',
        );
      }

      if (attack.attackStrength != null) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          'Reduced-strength attacks are only supported against ships',
        );
      }

      const target = state.ordnance.find((o) => o.id === attack.targetId);

      if (
        !target ||
        target.owner === playerId ||
        target.lifecycle === 'destroyed' ||
        target.type !== 'nuke'
      ) {
        return engineFailure(ErrorCode.INVALID_TARGET, 'Invalid combat target');
      }

      if (
        map &&
        attackers.some(
          (attacker) => !hasLineOfSightToTarget(attacker, target, map),
        )
      ) {
        return engineFailure(
          ErrorCode.NOT_ALLOWED,
          'Attacker lacks line of sight to target',
        );
      }

      group.allocatedStrength = group.maxStrength;

      results.push(resolveAntiNukeAttack(attackers, target, rng));

      continue;
    }

    const target = state.ships.find((s) => s.id === attack.targetId);

    if (!target) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Target ship not found');
    }
    if (target.owner === playerId) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Cannot target own ship');
    }
    if (target.lifecycle !== 'active') {
      return engineFailure(
        ErrorCode.INVALID_TARGET,
        `Target not active (${target.lifecycle})`,
      );
    }

    if (!target.detected) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Target is not detected');
    }

    const targetHexKey = hexKey(target.position);

    if (group.targetHexKey && group.targetHexKey !== targetHexKey) {
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'Split fire may only target ships in the same hex',
      );
    }

    if (attack.attackStrength != null) {
      if (
        !Number.isInteger(attack.attackStrength) ||
        attack.attackStrength < 1 ||
        attack.attackStrength > remainingStrength
      ) {
        return engineFailure(
          ErrorCode.INVALID_INPUT,
          'Invalid declared attack strength',
        );
      }
    }

    if (
      map &&
      attackers.some((attacker) => !hasLineOfSight(attacker, target, map))
    ) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Attacker lacks line of sight to target',
      );
    }

    const allocatedStrength = attack.attackStrength ?? remainingStrength;

    group.targetHexKey = targetHexKey;
    group.allocatedStrength += allocatedStrength;

    const resolution = resolveCombat(
      attackers,
      target,
      state.ships,
      rng,
      map,
      allocatedStrength,
    );

    results.push(toCombatResult(resolution));
  }

  if (map && isPlanetaryDefenseEnabled(state)) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);
    results.push(...baseResults);
  }

  state.ordnance = state.ordnance.filter((o) => o.lifecycle !== 'destroyed');

  for (let i = hazardCount; i < results.length; i++) {
    const r = results[i];
    engineEvents.push(...combatResultToEvents(r, state));
  }

  applyEscapeMoralVictory(state);
  checkGameEnd(state, map, engineEvents);

  if (state.outcome === null) {
    advanceAfterCombat(state, engineEvents);
  }

  return { results, state, engineEvents };
};

// Process a single combat attack for sequential resolution.
// Does NOT advance the turn — the player calls endCombat when done.
export const processSingleCombat = (
  inputState: GameState,
  playerId: PlayerId,
  attack: CombatAttack,
  map: SolarSystemMap,
  rng: () => number,
): CombatPhaseResult | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'combat');
  if (phaseError) return { error: phaseError };

  const targeted = new Set(state.combatTargetedThisPhase ?? []);
  const targetKey = `${attack.targetType}:${attack.targetId}`;

  if (targeted.has(targetKey)) {
    return engineFailure(
      ErrorCode.STATE_CONFLICT,
      'Each target may be attacked only once per combat phase',
    );
  }

  const attackers: Ship[] = [];
  const attackSeen = new Set<string>();
  for (const id of attack.attackerIds) {
    if (attackSeen.has(id)) {
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'Each ship may appear at most once in an attack declaration',
      );
    }
    const ship = state.ships.find((s) => s.id === id);
    if (!ship || ship.owner !== playerId) {
      return engineFailure(
        ErrorCode.INVALID_SELECTION,
        'Invalid attacker selection',
      );
    }
    if (ship.firedThisPhase) {
      return engineFailure(
        ErrorCode.STATE_CONFLICT,
        'Ship has already attacked this phase',
      );
    }
    if (!canAttack(ship)) {
      return engineFailure(ErrorCode.INVALID_SELECTION, 'Ship cannot attack');
    }
    attackSeen.add(id);
    attackers.push(ship);
  }

  if (attackers.length === 0) {
    return engineFailure(ErrorCode.INVALID_SELECTION, 'No valid attackers');
  }

  const results: CombatResult[] = [];

  if (attack.targetType === 'ordnance') {
    if (attack.attackStrength != null) {
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'Reduced-strength attacks are only supported against ships',
      );
    }
    const target = state.ordnance.find((o) => o.id === attack.targetId);
    if (
      !target ||
      target.owner === playerId ||
      target.lifecycle === 'destroyed' ||
      target.type !== 'nuke'
    ) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Invalid combat target');
    }
    if (
      attackers.some(
        (attacker) => !hasLineOfSightToTarget(attacker, target, map),
      )
    ) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Attacker lacks line of sight to target',
      );
    }
    results.push(resolveAntiNukeAttack(attackers, target, rng));
  } else {
    const target = state.ships.find((s) => s.id === attack.targetId);
    if (!target) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Target ship not found');
    }
    if (target.owner === playerId) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Cannot target own ship');
    }
    if (target.lifecycle !== 'active') {
      return engineFailure(
        ErrorCode.INVALID_TARGET,
        `Target not active (${target.lifecycle})`,
      );
    }
    if (!target.detected) {
      return engineFailure(ErrorCode.INVALID_TARGET, 'Target is not detected');
    }
    if (attackers.some((attacker) => !hasLineOfSight(attacker, target, map))) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Attacker lacks line of sight to target',
      );
    }
    const maxStrength = sumBy(
      attackers,
      (ship) => SHIP_STATS[ship.type]?.combat ?? 0,
    );
    if (
      attack.attackStrength != null &&
      (!Number.isInteger(attack.attackStrength) ||
        attack.attackStrength < 1 ||
        attack.attackStrength > maxStrength)
    ) {
      return engineFailure(
        ErrorCode.INVALID_INPUT,
        'Invalid declared attack strength',
      );
    }
    const allocatedStrength = attack.attackStrength ?? maxStrength;
    const resolution = resolveCombat(
      attackers,
      target,
      state.ships,
      rng,
      map,
      allocatedStrength,
    );
    results.push(toCombatResult(resolution));
  }

  // Mark attackers as fired and target as attacked
  for (const attacker of attackers) {
    attacker.firedThisPhase = true;
  }
  state.combatTargetedThisPhase = [...targeted, targetKey];

  // Clean up destroyed ordnance
  state.ordnance = state.ordnance.filter((o) => o.lifecycle !== 'destroyed');

  for (const r of results) {
    engineEvents.push(...combatResultToEvents(r, state));
  }

  applyEscapeMoralVictory(state);
  checkGameEnd(state, map, engineEvents);

  return { results, state, engineEvents };
};

// End the combat phase after sequential attacks. Resolves base
// defense, clears per-phase tracking, and advances the turn.
export const endCombat = (
  inputState: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  rng: () => number,
):
  | {
      state: GameState;
      results?: CombatResult[];
      engineEvents: EngineEvent[];
    }
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'combat');
  if (phaseError) return { error: phaseError };

  const results: CombatResult[] = [];

  if (map && isPlanetaryDefenseEnabled(state)) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);
    for (const r of baseResults) {
      engineEvents.push(...combatResultToEvents(r, state));
    }
    results.push(...baseResults);
  }

  state.ordnance = state.ordnance.filter((o) => o.lifecycle !== 'destroyed');

  applyEscapeMoralVictory(state);
  checkGameEnd(state, map, engineEvents);

  if (state.outcome === null) {
    advanceAfterCombat(state, engineEvents);
  }

  return results.length > 0
    ? { state, results, engineEvents }
    : { state, engineEvents };
};

// Skip combat phase (player has no attacks to make).
export const skipCombat = (
  inputState: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  rng: () => number,
):
  | { state: GameState; results?: CombatResult[]; engineEvents: EngineEvent[] }
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'combat');

  if (phaseError) return { error: phaseError };

  const results = resolvePendingAsteroidHazards(state, playerId, rng);

  for (const r of results) {
    engineEvents.push(...combatResultToEvents(r, state));
  }

  applyEscapeMoralVictory(state);

  if (map) {
    checkGameEnd(state, map, engineEvents);
  }

  if (state.outcome !== null) {
    return results.length > 0
      ? { state, results, engineEvents }
      : { state, engineEvents };
  }

  if (map && isPlanetaryDefenseEnabled(state)) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);

    for (const r of baseResults) {
      engineEvents.push(...combatResultToEvents(r, state));
    }

    results.push(...baseResults);
    applyEscapeMoralVictory(state);
    checkGameEnd(state, map, engineEvents);
  }

  if (state.outcome === null) {
    advanceAfterCombat(state, engineEvents);
  }

  return results.length > 0
    ? { state, results, engineEvents }
    : { state, engineEvents };
};

// Determine whether the active player should enter
// combat after movement.
export const shouldEnterCombatPhase = (
  state: GameState,
  map: SolarSystemMap,
): boolean => {
  if (
    state.pendingAsteroidHazards.some((hazard) => {
      const ship = state.ships.find((s) => s.id === hazard.shipId);
      return (
        ship?.owner === state.activePlayer && ship.lifecycle !== 'destroyed'
      );
    })
  ) {
    return true;
  }

  // No gun/base combat in race scenarios
  // (asteroid hazards still resolve above)
  if (state.scenarioRules.combatDisabled) return false;

  if (isPlanetaryDefenseEnabled(state) && hasBaseDefenseTargets(state, map)) {
    return true;
  }

  return hasManualCombatTargets(state, map);
};
