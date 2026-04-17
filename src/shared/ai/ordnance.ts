import { canAttack, getCombatStrength } from '../combat';
import { SHIP_STATS } from '../constants';
import { validateOrdnanceLaunch } from '../engine/util';
import { hexAdd, hexDistance, hexEqual, hexVecLength } from '../hex';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  GameState,
  OrdnanceLaunch,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { maxBy, minBy } from '../util';
import { findDirectionToward } from './common';
import { resolveAIConfig } from './config';
import type { AIDifficulty } from './types';

interface ScoredEnemyTarget {
  enemy: Ship;
  currentDistance: number;
  predictedDistance: number;
  predictedPosition: { q: number; r: number };
  score: number;
}

const scoreEnemyTarget = (
  ship: Ship,
  enemy: Ship,
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): ScoredEnemyTarget => {
  const player = state.players[playerId];
  const predictedPosition = hexAdd(enemy.position, enemy.velocity);
  const currentDistance = hexDistance(ship.position, enemy.position);
  const predictedDistance = hexDistance(ship.position, predictedPosition);
  const targetHex = player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
      null)
    : null;
  const targetThreat =
    targetHex == null
      ? 0
      : Math.max(
          0,
          8 -
            Math.min(
              hexDistance(enemy.position, targetHex),
              hexDistance(predictedPosition, targetHex),
            ),
        ) * 10;
  const escapeThreat = player.escapeWins
    ? Math.max(0, 8 - currentDistance) * 8
    : 0;
  const passengerThreat = (enemy.passengersAboard ?? 0) > 0 ? 30 : 0;
  const combatThreat = canAttack(enemy) ? 24 : 6;
  const strengthThreat = getCombatStrength([enemy]) * 8;

  return {
    enemy,
    currentDistance,
    predictedDistance,
    predictedPosition,
    score:
      strengthThreat +
      combatThreat +
      targetThreat +
      escapeThreat +
      passengerThreat -
      predictedDistance * 6 -
      currentDistance * 2 +
      enemy.damage.disabledTurns * 4,
  };
};

export const aiOrdnance = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  // rng is required — no default. Same rationale as `aiAstrogation`:
  // passing an explicit RNG keeps ordnance dice resolution deterministic
  // with the caller, and forgetting is a compile error rather than a
  // silent `Math.random` leak.
  rng: () => number,
): OrdnanceLaunch[] => {
  const cfg = resolveAIConfig(
    difficulty,
    state.scenarioRules?.aiConfigOverrides as
      | Parameters<typeof resolveAIConfig>[1]
      | undefined,
  );
  const launches: OrdnanceLaunch[] = [];
  const caps = deriveCapabilities(state.scenarioRules);

  if (cfg.ordnanceSkipChance > 0 && rng() < cfg.ordnanceSkipChance) {
    return launches;
  }

  const enemyShips = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  );

  if (enemyShips.length === 0) return launches;

  const torpedoRange = cfg.torpedoRange;
  const mineRange = cfg.mineRange;

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.lifecycle !== 'active') {
      continue;
    }

    if (ship.damage.disabledTurns > 0) continue;
    if (caps.targetWinRequiresPassengers && (ship.passengersAboard ?? 0) > 0) {
      continue;
    }

    if (!SHIP_STATS[ship.type]) continue;

    const hasFriendlyLaunchStack = state.ships.some(
      (other) =>
        other.id !== ship.id &&
        other.owner === playerId &&
        other.lifecycle !== 'destroyed' &&
        hexEqual(other.position, ship.position),
    );
    const nearestEnemy = minBy(enemyShips, (enemy) =>
      hexDistance(ship.position, enemy.position),
    );
    const bestEnemyTarget = maxBy(
      enemyShips.map((enemy) =>
        scoreEnemyTarget(ship, enemy, state, playerId, map),
      ),
      (target) => target.score,
    );

    if (!nearestEnemy || !bestEnemyTarget) continue;

    const nearestDist = hexDistance(ship.position, nearestEnemy.position);
    const bestEnemy = bestEnemyTarget.enemy;
    const bestEnemyCurrentDist = bestEnemyTarget.currentDistance;
    const bestEnemyPredictedDist = bestEnemyTarget.predictedDistance;
    const canLaunchNuke =
      validateOrdnanceLaunch(state, ship, 'nuke') === null &&
      !hasFriendlyLaunchStack &&
      (ship.passengersAboard ?? 0) === 0;
    const canLaunchTorpedo =
      validateOrdnanceLaunch(state, ship, 'torpedo') === null;
    const canLaunchMine = validateOrdnanceLaunch(state, ship, 'mine') === null;

    // Early-turn nuke guard ported from scripts/llm-agent-coach.ts:
    // in the first two turns, a nuke is only considered when the enemy is
    // already point-blank (≤ 2 hexes). Before this guard the in-engine bot
    // and local single-player AI would open with nukes from 6 hexes away,
    // which makes duel matches swingy and unfun (see AGENT_IMPROVEMENTS_LOG
    // 2026-04-15 session notes). Hard difficulty is still aggressive once
    // past turn 2 or in close range.
    const earlyTurnNukeAllowed =
      state.turnNumber > 2 ||
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= 2;

    // Parity-deficit guard: if we already have ≤ 1 operational ship, a
    // failed nuke exchange loses the match. Hold fire unless the target is
    // already in point-blank so the nuke can't be shot down before arrival.
    const ownOperationalShips = state.ships.filter(
      (candidate) =>
        candidate.owner === playerId &&
        candidate.lifecycle === 'active' &&
        candidate.damage.disabledTurns === 0,
    ).length;
    const parityDeficitNukeAllowed =
      ownOperationalShips > 1 || bestEnemyCurrentDist <= 1;

    if (
      cfg.willCommitNukes &&
      earlyTurnNukeAllowed &&
      parityDeficitNukeAllowed &&
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange &&
      canLaunchNuke
    ) {
      const enemyStrength = getCombatStrength([bestEnemy]);
      const myStrength = getCombatStrength([ship]);
      const shouldUseNuke =
        bestEnemyTarget.score >= 70 ||
        (enemyStrength >= myStrength &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange) ||
        ((bestEnemy.passengersAboard ?? 0) > 0 &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange);

      if (shouldUseNuke && bestEnemyCurrentDist <= cfg.nukeStrengthRange) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
        continue;
      }
    }

    if (
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange &&
      canLaunchTorpedo
    ) {
      const bestDir = findDirectionToward(
        ship.position,
        bestEnemyTarget.predictedPosition,
      );
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
        torpedoAccelSteps:
          bestEnemyPredictedDist > 4 || hexVecLength(bestEnemy.velocity) > 1
            ? 2
            : 1,
      });
      continue;
    }

    if (nearestDist <= mineRange && canLaunchMine) {
      launches.push({
        shipId: ship.id,
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      });
      continue;
    }

    const player = state.players[playerId];

    if (player?.escapeWins && nearestDist <= 8 && canLaunchMine) {
      const speed = hexVecLength(ship.velocity);

      if (speed >= 2 && difficulty !== 'easy') {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
      }
    }
  }

  return launches;
};
