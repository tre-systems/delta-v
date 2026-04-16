import { canAttack, getCombatStrength } from '../combat';
import { SHIP_STATS } from '../constants';
import {
  beginCombatPhase,
  processAstrogation,
  processCombat,
  processLogistics,
  processOrdnance,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../engine/game-engine';
import { type HexKey, hexDistance, hexKey, hexVecLength } from '../hex';
import { computeCourse, detectOrbit } from '../movement';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { maxBy, minBy } from '../util';
import { aiCombat } from './combat';
import {
  findNearestBase,
  getHomeDefenseThreat,
  getInterceptContinuationPreference,
  pickNextCheckpoint,
  projectShipAfterCourse,
  scoreObjectiveHomeDefenseCourse,
} from './common';
import { AI_CONFIG } from './config';
import {
  aiLogistics,
  getPassengerTransferFormationOrders,
  getPrimaryPassengerCarrier,
  getThreateningEnemies,
  isPassengerEscortMission,
  maybeCreatePassengerFuelSupportOrder,
  scorePassengerCarrierEvasion,
  scorePassengerEscortCourse,
} from './logistics';
import { aiOrdnance } from './ordnance';
import { scoreCourse } from './scoring';
import type { AIDifficulty } from './types';

// Difficulty-aware constant RNG used exclusively inside the passenger-escort
// lookahead. Lookahead simulates one to two turns of ordnance/combat to
// score candidate orders; using the real match RNG would bake a single dice
// sequence into the score. A stable constant bias per difficulty reflects
// each tier's risk posture without random noise:
//   - easy: 0.4 — plan conservatively, assume the dice are slightly against you
//   - normal: 0.5 — neutral expectation
//   - hard: 0.6 — assume dice are slightly favorable, so commit to engagements
const LOOKAHEAD_BIAS_BY_DIFFICULTY: Record<AIDifficulty, number> = {
  easy: 0.4,
  normal: 0.5,
  hard: 0.6,
};

const createLookaheadRng = (difficulty: AIDifficulty): (() => number) => {
  const bias = LOOKAHEAD_BIAS_BY_DIFFICULTY[difficulty];
  return () => bias;
};

const getPassengerEmergencyEscortOrders = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  escapeWins: boolean,
  enemyShips: Ship[],
  difficulty: AIDifficulty,
  enemyEscaping: boolean,
  enemyHasPassengerObjective: boolean,
  // The lookahead no longer consumes the outer match RNG — it uses a
  // difficulty-biased constant via `createLookaheadRng` instead (easy 0.4,
  // normal 0.5, hard 0.6). We accept the parameter for API parity with the
  // enclosing `aiAstrogation` signature, but intentionally don't pass it
  // into the simulation. Underscore-prefixed so lint flags any future
  // misuse.
  _rng: () => number,
): Map<string, AstrogationOrder> => {
  if (!isPassengerEscortMission(state, playerId)) {
    return new Map();
  }

  const primaryCarrier = getPrimaryPassengerCarrier(state, playerId);

  if (primaryCarrier == null) {
    return new Map();
  }

  const threats = getThreateningEnemies(enemyShips);
  const primaryThreat = minBy(threats, (enemy) =>
    hexDistance(primaryCarrier.position, enemy.position),
  );

  if (
    primaryThreat == null ||
    hexDistance(primaryCarrier.position, primaryThreat.position) > 2
  ) {
    return new Map();
  }

  const escort = maxBy(
    state.ships.filter(
      (ship) =>
        ship.owner === playerId &&
        ship.id !== primaryCarrier.id &&
        ship.lifecycle !== 'destroyed' &&
        canAttack(ship) &&
        (ship.passengersAboard ?? 0) === 0,
    ),
    (ship) =>
      getCombatStrength([ship]) * 10 -
      hexDistance(ship.position, primaryCarrier.position),
  );

  if (!escort) {
    return new Map();
  }

  // Difficulty-aware RNG bias for lookahead. The lookahead simulates one or
  // two future turns' ordnance/combat to score candidate orders; using the
  // outer match RNG would bake one particular dice sequence into the score
  // and make the AI's expected-value reasoning brittle. A constant mid-bias
  // (easy < normal < hard) keeps the lookahead stable and mirrors each
  // difficulty's risk posture — easy AI anticipates slightly unfavourable
  // rolls, hard AI slightly favourable.
  const lookaheadRng = createLookaheadRng(difficulty);

  const evaluateCandidateOutcome = (
    carrierOrder: AstrogationOrder,
    escortOrder: AstrogationOrder,
  ): number => {
    let simulated = structuredClone(state);
    const myOrders = simulated.ships
      .filter((ship) => ship.owner === playerId)
      .map((ship) => {
        if (ship.id === carrierOrder.shipId) {
          return carrierOrder;
        }

        if (ship.id === escortOrder.shipId) {
          return escortOrder;
        }

        return {
          shipId: ship.id,
          burn: null,
          overload: null,
        };
      });
    const firstResult = processAstrogation(
      simulated,
      playerId,
      myOrders,
      map,
      lookaheadRng,
    );

    if ('error' in firstResult) {
      return -Infinity;
    }
    simulated = firstResult.state;

    while (
      simulated.phase !== 'gameOver' &&
      simulated.turnNumber <= state.turnNumber + 1
    ) {
      if (
        simulated.phase === 'astrogation' &&
        simulated.activePlayer === playerId &&
        simulated.turnNumber > state.turnNumber
      ) {
        break;
      }

      const actor = simulated.activePlayer;

      if (simulated.phase === 'astrogation') {
        const orders = aiAstrogation(
          simulated,
          actor,
          map,
          difficulty,
          lookaheadRng,
        );
        const result = processAstrogation(
          simulated,
          actor,
          orders,
          map,
          lookaheadRng,
        );

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'ordnance') {
        const launches = aiOrdnance(
          simulated,
          actor,
          map,
          difficulty,
          lookaheadRng,
        );
        const result =
          launches.length > 0
            ? processOrdnance(simulated, actor, launches, map, lookaheadRng)
            : skipOrdnance(simulated, actor, map, lookaheadRng);

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'logistics') {
        const transfers = aiLogistics(simulated, actor, map, difficulty);
        const result =
          transfers.length > 0
            ? processLogistics(simulated, actor, transfers, map)
            : skipLogistics(simulated, actor, map);

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'combat') {
        const preResult = beginCombatPhase(simulated, actor, map, lookaheadRng);

        if ('error' in preResult) {
          return -Infinity;
        }
        simulated = preResult.state;
        if (simulated.phase !== 'combat') {
          continue;
        }

        const attacks = aiCombat(simulated, actor, map, difficulty);
        const result =
          attacks.length > 0
            ? processCombat(simulated, actor, attacks, map, lookaheadRng)
            : skipCombat(simulated, actor, map, lookaheadRng);

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      break;
    }

    const simulatedCarrier = simulated.ships.find(
      (ship) => ship.id === primaryCarrier.id,
    );

    if (!simulatedCarrier) {
      return -Infinity;
    }

    if (
      simulated.outcome?.winner === 1 ||
      simulatedCarrier.lifecycle === 'destroyed'
    ) {
      return -10_000;
    }

    const distToTarget =
      targetHex == null ? 0 : hexDistance(simulatedCarrier.position, targetHex);

    return (
      (simulatedCarrier.passengersAboard ?? 0) * 5 -
      simulatedCarrier.damage.disabledTurns * 180 -
      distToTarget * 10 +
      (simulated.phase === 'gameOver' && simulated.outcome?.winner === playerId
        ? 5_000
        : 0)
    );
  };

  const cfg = AI_CONFIG[difficulty];
  const carrierBurns = [0, 1, 2, 3, 4, 5] as const;
  const escortBurns = [null, 0, 1, 2, 3, 4, 5] as const;
  let bestScore = -Infinity;
  let bestCarrierOrder: AstrogationOrder | null = null;
  let bestEscortOrder: AstrogationOrder | null = null;

  for (const carrierBurn of carrierBurns) {
    const carrierCourse = computeCourse(primaryCarrier, carrierBurn, map, {
      destroyedBases: state.destroyedBases,
    });

    if (carrierCourse.outcome === 'crash') {
      continue;
    }

    const projectedCarrier = projectShipAfterCourse(
      primaryCarrier,
      carrierCourse,
    );

    for (const escortBurn of escortBurns) {
      const escortStats = SHIP_STATS[escort.type];
      const escortOverloads =
        escortBurn != null &&
        difficulty !== 'easy' &&
        escortStats?.canOverload &&
        escort.fuel >= 2 &&
        !escort.overloadUsed &&
        deriveCapabilities(state.scenarioRules).combatEnabled
          ? [null, 0, 1, 2, 3, 4, 5]
          : [null];

      for (const escortOverload of escortOverloads) {
        const escortCourse = computeCourse(escort, escortBurn, map, {
          ...(escortOverload != null ? { overload: escortOverload } : {}),
          destroyedBases: state.destroyedBases,
        });

        if (escortCourse.outcome === 'crash') {
          continue;
        }

        const spacing = hexDistance(
          carrierCourse.destination,
          escortCourse.destination,
        );
        const score =
          scoreCourse({
            ship: primaryCarrier,
            course: carrierCourse,
            targetHex,
            targetBody,
            escapeWins,
            escapeEdge: state.scenarioRules.escapeEdge ?? 'any',
            enemyShips,
            cfg,
            map,
            isRace: false,
            enemyEscaping,
            enemyHasPassengerObjective,
            shipIndex: 0,
          }) +
          scorePassengerCarrierEvasion(
            primaryCarrier,
            carrierCourse,
            enemyShips,
          ) +
          scoreCourse({
            ship: escort,
            course: escortCourse,
            targetHex: null,
            targetBody: '',
            escapeWins: false,
            escapeEdge: state.scenarioRules.escapeEdge ?? 'any',
            enemyShips,
            cfg,
            map,
            isRace: false,
            enemyEscaping,
            enemyHasPassengerObjective,
            shipIndex: 1,
          }) +
          scorePassengerEscortCourse(
            escort,
            escortCourse,
            projectedCarrier,
            enemyShips,
          ) +
          (spacing === 0 ? 220 : spacing === 1 ? 40 : -spacing * 30) +
          evaluateCandidateOutcome(
            {
              shipId: primaryCarrier.id,
              burn: carrierBurn,
              overload: null,
            },
            {
              shipId: escort.id,
              burn: escortBurn,
              overload: escortOverload,
            },
          );

        if (score > bestScore) {
          bestScore = score;
          bestCarrierOrder = {
            shipId: primaryCarrier.id,
            burn: carrierBurn,
            overload: null,
          };
          bestEscortOrder = {
            shipId: escort.id,
            burn: escortBurn,
            overload: escortOverload,
          };
        }
      }
    }
  }

  if (bestCarrierOrder == null || bestEscortOrder == null) {
    return new Map();
  }

  return new Map([
    [bestCarrierOrder.shipId, bestCarrierOrder],
    [bestEscortOrder.shipId, bestEscortOrder],
  ]);
};

export const aiAstrogation = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  // rng is required — no default. The AI's passenger-escort lookahead
  // simulates ordnance and combat internally, so the caller must supply
  // the same RNG used for the outer turn resolution so simulation stays
  // deterministic with production play and replay. Forgetting is a compile
  // error, which is the point: a production call that accidentally relied
  // on `Math.random` would silently desync from the authoritative engine.
  rng: () => number,
): AstrogationOrder[] => {
  const cfg = AI_CONFIG[difficulty];
  const orders: AstrogationOrder[] = [];
  const { targetBody, escapeWins } = state.players[playerId];
  const player = state.players[playerId];
  const passengerEscortMission = isPassengerEscortMission(state, playerId);
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const enemyEscaping = state.players[opponentId]?.escapeWins === true;
  const enemyHasPassengerObjective =
    !!state.players[opponentId]?.targetBody &&
    state.ships.some(
      (ship) =>
        ship.owner === opponentId &&
        ship.lifecycle !== 'destroyed' &&
        (ship.passengersAboard ?? 0) > 0,
    );
  const defaultTargetHex: {
    q: number;
    r: number;
  } | null = targetBody
    ? (map.bodies.find((body) => body.name === targetBody)?.center ?? null)
    : null;
  const caps = deriveCapabilities(state.scenarioRules);
  const checkpoints = caps.isCheckpointRace ? caps.checkpointBodies : null;
  const enemyShips = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  );
  const homeDefenseThreat =
    !escapeWins && !passengerEscortMission
      ? getHomeDefenseThreat(state, playerId, map, enemyShips)
      : null;
  const homeDefenseHex =
    homeDefenseThreat != null
      ? (map.bodies.find((body) => body.name === player.homeBody)?.center ??
        null)
      : null;
  const primaryPassengerCarrier = passengerEscortMission
    ? getPrimaryPassengerCarrier(state, playerId)
    : null;
  const primaryPassengerThreatDist =
    passengerEscortMission && primaryPassengerCarrier != null
      ? Math.min(
          ...getThreateningEnemies(enemyShips).map((enemy) =>
            hexDistance(primaryPassengerCarrier.position, enemy.position),
          ),
          Number.POSITIVE_INFINITY,
        )
      : Number.POSITIVE_INFINITY;
  const passengerTransferFormationOrders = getPassengerTransferFormationOrders(
    state,
    playerId,
    map,
    defaultTargetHex,
    targetBody,
    escapeWins,
    enemyShips,
    cfg,
    difficulty,
    !!checkpoints,
    enemyEscaping,
    enemyHasPassengerObjective,
  );
  const passengerEmergencyEscortOrders = getPassengerEmergencyEscortOrders(
    state,
    playerId,
    map,
    defaultTargetHex,
    targetBody,
    escapeWins,
    enemyShips,
    difficulty,
    enemyEscaping,
    enemyHasPassengerObjective,
    rng,
  );
  let shipIdx = 0;

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.lifecycle === 'destroyed') continue;
    if (ship.baseStatus === 'emplaced') continue;

    if (ship.control === 'captured') {
      orders.push({
        shipId: ship.id,
        burn: null,
        overload: null,
      });
      continue;
    }

    if (ship.damage.disabledTurns > 0) {
      orders.push({
        shipId: ship.id,
        burn: null,
        overload: null,
      });
      continue;
    }

    const emergencyOrder = passengerEmergencyEscortOrders.get(ship.id);

    if (emergencyOrder) {
      orders.push(emergencyOrder);
      shipIdx++;
      continue;
    }

    const formationOrder = passengerTransferFormationOrders.get(ship.id);

    if (formationOrder) {
      orders.push(formationOrder);
      shipIdx++;
      continue;
    }

    const fuelSupportOrder = maybeCreatePassengerFuelSupportOrder(
      ship,
      state,
      playerId,
      orders,
      map,
    );

    if (fuelSupportOrder) {
      orders.push(fuelSupportOrder);
      shipIdx++;
      continue;
    }

    let shipTargetHex = defaultTargetHex;
    let shipTargetBody = targetBody;
    let seekingFuel = false;

    if (
      passengerEscortMission &&
      primaryPassengerCarrier != null &&
      primaryPassengerThreatDist <= 5 &&
      ship.id !== primaryPassengerCarrier.id &&
      canAttack(ship) &&
      (ship.passengersAboard ?? 0) === 0
    ) {
      shipTargetHex = null;
      shipTargetBody = '';
    }

    if (checkpoints && player.visitedBodies) {
      const nextBody =
        pickNextCheckpoint(player, checkpoints, map, ship.position) ?? '';
      shipTargetBody = nextBody;
      shipTargetHex = nextBody
        ? (map.bodies.find((body) => body.name === nextBody)?.center ?? null)
        : null;

      if (shipTargetHex && ship.lifecycle !== 'landed') {
        const distToTarget = hexDistance(ship.position, shipTargetHex);
        const speed = hexVecLength(ship.velocity);
        const fuelForTrip = Math.ceil((distToTarget * 2) / 3) + speed + 1;

        if (ship.fuel < fuelForTrip) {
          const basePos = findNearestBase(ship.position, player.bases, map);

          if (basePos) {
            const baseDist = hexDistance(ship.position, basePos);

            if (baseDist < distToTarget && baseDist <= ship.fuel + speed + 2) {
              shipTargetHex = basePos;
              shipTargetBody = '';
              seekingFuel = true;
            }
          }
        }
      }
    }

    let bestBurn: number | null = null;
    let bestOverload: number | null = null;
    let bestLand = false;
    let bestScore = -Infinity;
    let bestInterceptTiebreak = -Infinity;
    let bestFuelSpent = Number.POSITIVE_INFINITY;
    const stats = SHIP_STATS[ship.type];
    const canBurnFuel = ship.fuel > 0;
    const interceptingEnemy =
      (enemyEscaping || enemyHasPassengerObjective) &&
      !escapeWins &&
      shipTargetHex == null;
    const nearbyEnemy = enemyShips.some(
      (enemy) => hexDistance(ship.position, enemy.position) <= 4,
    );
    const objectiveDriveDiscipline =
      shipTargetHex != null && !passengerEscortMission && !checkpoints;
    const allowsCorrectiveBurnLookahead =
      !!checkpoints ||
      shipTargetHex != null ||
      passengerEscortMission ||
      interceptingEnemy;
    const canOverload =
      difficulty !== 'easy' &&
      stats?.canOverload &&
      ship.fuel >= 2 &&
      !ship.overloadUsed &&
      deriveCapabilities(state.scenarioRules).combatEnabled &&
      (!objectiveDriveDiscipline || nearbyEnemy);
    type BurnOption = {
      burn: number | null;
      overload: number | null;
      land?: boolean;
      weakGravityChoices?: Record<HexKey, boolean>;
    };
    const directions = [0, 1, 2, 3, 4, 5] as const;
    const inOrbit = canBurnFuel && detectOrbit(ship, map) !== null;
    const options: BurnOption[] = [
      { burn: null, overload: null },
      ...(canBurnFuel
        ? directions.flatMap((direction) => [
            { burn: direction, overload: null },
            ...(canOverload
              ? directions.map((overload) => ({
                  burn: direction,
                  overload: overload as number | null,
                }))
              : []),
          ])
        : []),
      // Add a single landing option when in orbit.
      // Burn direction is irrelevant for landing, so
      // one candidate suffices.
      ...(inOrbit ? [{ burn: 0, overload: null, land: true }] : []),
    ];
    let bestWeakGrav: Record<string, boolean> | undefined;

    for (const opt of options) {
      const courseOpts = {
        ...(opt.overload !== null ? { overload: opt.overload } : {}),
        ...(opt.land ? { land: true } : {}),
        destroyedBases: state.destroyedBases,
      };
      const course = computeCourse(ship, opt.burn, map, courseOpts);

      if (course.outcome === 'crash') continue;

      let gravityRiskPenalty = 0;

      if (course.outcome !== 'landing') {
        const simShip = projectShipAfterCourse(ship, course);
        const fuelAfter = ship.fuel - course.fuelSpent;
        const driftCourse = computeCourse(simShip, null, map, {
          destroyedBases: state.destroyedBases,
        });

        if (driftCourse.outcome === 'crash') {
          if (!allowsCorrectiveBurnLookahead) {
            continue;
          }
          if (fuelAfter <= 0) continue;

          let canSurvive = false;
          for (let d2 = 0; d2 < 6; d2++) {
            const escapeResult = computeCourse(simShip, d2, map, {
              destroyedBases: state.destroyedBases,
            });

            if (escapeResult.outcome === 'crash') continue;

            if (escapeResult.outcome !== 'landing' && fuelAfter > 1) {
              const sim2 = projectShipAfterCourse(simShip, escapeResult);
              const drift2 = computeCourse(sim2, null, map, {
                destroyedBases: state.destroyedBases,
              });

              if (drift2.outcome === 'crash') {
                let canSurvive2 = false;
                for (let d3 = 0; d3 < 6; d3++) {
                  const esc2 = computeCourse(sim2, d3, map, {
                    destroyedBases: state.destroyedBases,
                  });

                  if (esc2.outcome !== 'crash') {
                    canSurvive2 = true;
                    break;
                  }
                }

                if (!canSurvive2) continue;
              }
            }
            canSurvive = true;
            break;
          }

          if (!canSurvive) continue;
          gravityRiskPenalty = interceptingEnemy ? 0 : cfg.gravityRiskPenalty;
        }
      }

      let score =
        scoreCourse({
          ship,
          course,
          targetHex: shipTargetHex,
          targetBody: shipTargetBody,
          escapeWins,
          escapeEdge: caps.escapeEdge,
          enemyShips,
          cfg,
          map,
          isRace: !!checkpoints,
          enemyEscaping,
          enemyHasPassengerObjective,
          shipIndex: shipIdx,
        }) + gravityRiskPenalty;

      if (
        homeDefenseThreat != null &&
        homeDefenseHex != null &&
        canAttack(ship)
      ) {
        score += scoreObjectiveHomeDefenseCourse(
          ship,
          course,
          homeDefenseThreat,
          homeDefenseHex,
        );
      }

      let comparisonCourse = course;

      if (passengerEscortMission) {
        score += scorePassengerCarrierEvasion(ship, course, enemyShips);
        score += scorePassengerEscortCourse(
          ship,
          course,
          primaryPassengerCarrier,
          enemyShips,
        );
      }

      if (seekingFuel && course.outcome === 'landing') {
        score += cfg.fuelSeekLandingBonus;
      }

      if (opt.burn === null) {
        if (!interceptingEnemy) {
          score += cfg.fuelDriftBonus;
        }
      } else if (opt.overload !== null) {
        const overloadPenalty =
          cfg.fuelOverloadPenalty +
          (shipTargetHex != null ? (checkpoints ? 8 : 4) : 0) +
          (passengerEscortMission ? 2 : 0);
        score -= overloadPenalty * cfg.multiplier;
      }

      let bestLocalWG: Record<string, boolean> | undefined;

      if (
        difficulty !== 'easy' &&
        course.enteredGravityEffects.some(
          (effect) => effect.strength === 'weak',
        )
      ) {
        const weakHexes = course.enteredGravityEffects.filter(
          (effect) => effect.strength === 'weak',
        );

        for (const weakGravity of weakHexes) {
          const weakGravityChoices: Record<string, boolean> = {
            [hexKey(weakGravity.hex)]: true,
          };
          const altCourse = computeCourse(ship, opt.burn, map, {
            ...courseOpts,
            weakGravityChoices,
          });

          if (altCourse.outcome === 'crash') continue;

          if (altCourse.outcome !== 'landing') {
            const simShip2 = projectShipAfterCourse(ship, altCourse);
            const nextAlt = computeCourse(simShip2, null, map, {
              destroyedBases: state.destroyedBases,
            });

            if (nextAlt.outcome === 'crash') continue;
          }

          const altScore = scoreCourse({
            ship,
            course: altCourse,
            targetHex: shipTargetHex,
            targetBody: shipTargetBody,
            escapeWins,
            escapeEdge: caps.escapeEdge,
            enemyShips,
            cfg,
            map,
            isRace: !!checkpoints,
            enemyEscaping,
            enemyHasPassengerObjective,
            shipIndex: shipIdx,
          });
          const altDefenseScore =
            homeDefenseThreat != null &&
            homeDefenseHex != null &&
            canAttack(ship)
              ? scoreObjectiveHomeDefenseCourse(
                  ship,
                  altCourse,
                  homeDefenseThreat,
                  homeDefenseHex,
                )
              : 0;

          if (altScore + altDefenseScore > score) {
            score = altScore + altDefenseScore;
            bestLocalWG = weakGravityChoices;
            comparisonCourse = altCourse;
          }
        }
      }

      const interceptPreference = interceptingEnemy
        ? getInterceptContinuationPreference(
            ship,
            comparisonCourse,
            enemyShips,
            shipIdx,
            cfg,
            map,
            state.destroyedBases,
          )
        : { bonus: 0, tiebreak: -Infinity };

      score += interceptPreference.bonus;
      const interceptTiebreak = interceptPreference.tiebreak;

      if (
        score > bestScore + 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 &&
          (interceptTiebreak > bestInterceptTiebreak + 1e-9 ||
            (Math.abs(interceptTiebreak - bestInterceptTiebreak) <= 1e-9 &&
              comparisonCourse.fuelSpent < bestFuelSpent)))
      ) {
        bestScore = score;
        bestBurn = opt.burn;
        bestOverload = opt.overload;
        bestLand = opt.land ?? false;
        bestWeakGrav = bestLocalWG;
        bestInterceptTiebreak = interceptTiebreak;
        bestFuelSpent = comparisonCourse.fuelSpent;
      }
    }

    if (
      cfg.easyRandomBurnProbability > 0 &&
      rng() < cfg.easyRandomBurnProbability &&
      canBurnFuel
    ) {
      const randomDir = Math.floor(rng() * 6);
      const course = computeCourse(ship, randomDir, map, {
        destroyedBases: state.destroyedBases,
      });

      if (course.outcome !== 'crash') {
        bestBurn = randomDir;
        bestOverload = null;
      }
    }

    orders.push({
      shipId: ship.id,
      burn: bestBurn,
      overload: bestOverload,
      weakGravityChoices: bestWeakGrav ?? undefined,
      land: bestLand || undefined,
    });
    shipIdx++;
  }

  return orders;
};
