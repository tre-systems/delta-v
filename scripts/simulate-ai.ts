import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIDoctrineContext,
  buildAIFleetPurchases,
  choosePassengerCombatPlan,
  type PlanCandidate,
  type PlanDecision,
  type PlanDiagnostic,
  type PlanEvaluation,
  type PlanIntent,
} from '../src/shared/ai';
import { estimateRemainingCheckpointTourCost } from '../src/shared/ai/common';
import { scorePassengerArrivalOdds } from '../src/shared/ai/logistics';
import { canAttack } from '../src/shared/combat';
import {
  beginCombatPhase,
  createGame,
  processAstrogation,
  processCombat,
  processFleetReady,
  processLogistics,
  processOrdnance,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../src/shared/engine/game-engine';
import { getOrderableShipsForPlayer } from '../src/shared/engine/util';
import { hexDistance, hexVecLength } from '../src/shared/hex';
import { asGameId } from '../src/shared/ids';
import type { ScenarioKey } from '../src/shared/map-data';
import {
  buildSolarSystemMap,
  findBaseHex,
  isValidScenario,
  SCENARIOS,
} from '../src/shared/map-data';
import { mulberry32 } from '../src/shared/prng';
import type {
  AstrogationOrder,
  GameState,
  Phase,
  PlayerId,
  ScenarioDefinition,
  Ship,
  TransferOrder,
} from '../src/shared/types';

export interface SimulationMetrics {
  scenario: string;
  totalGames: number;
  player0Wins: number;
  player1Wins: number;
  draws: number;
  totalTurns: number;
  crashes: number; // Internal engine errors during simulation
  crashSeeds: number[];
  aiInvalidActions: number;
  invalidActionSeeds: number[];
  failureCounters: SimulationFailureCounters;
  reasons: Record<string, number>;
  scorecard: ScenarioScorecard;
}

export interface SimulationFailureCounters {
  invalidActions: number;
  invalidActionPhases: Record<string, number>;
  fuelStalls: number;
  passengerTransferMistakes: number;
}

export interface ScenarioScorecard {
  decidedGames: number;
  player0DecidedRate: number | null;
  averageTurns: number | null;
  objectiveResolutions: number;
  objectiveShare: number;
  fleetEliminations: number;
  fleetEliminationShare: number;
  timeouts: number;
  timeoutShare: number;
  passengerDeliveries: number;
  passengerDeliveryShare: number;
  grandTourCompletions: number;
  grandTourCompletionShare: number;
  invalidActions: number;
  invalidActionShare: number;
  fuelStalls: number;
  fuelStallsPerGame: number;
  passengerTransferMistakes: number;
  passengerTransferMistakesPerGame: number;
}

export interface SimulationOptions {
  p0Diff: AIDifficulty;
  p1Diff: AIDifficulty;
  randomizeStart: boolean;
  forcedStart: PlayerId | null;
  baseSeed: number;
  json: boolean;
  captureFailuresDir?: string | null;
  captureFailuresLimit?: number;
  captureFailureKinds?: SimulationFailureKind[] | null;
  /** When true, skip banner/progress/footer logs (errors still print). */
  quiet?: boolean;
}

export type SimulationFailureKind =
  | 'fuelStall'
  | 'invalidAction'
  | 'objectiveDrift'
  | 'passengerObjectiveFailure'
  | 'passengerTransferMistake';

const SIMULATION_FAILURE_KINDS: readonly SimulationFailureKind[] = [
  'fuelStall',
  'invalidAction',
  'objectiveDrift',
  'passengerObjectiveFailure',
  'passengerTransferMistake',
];

export interface PassengerTransferMistake {
  sourceShipId: string;
  targetShipId: string;
  amount: number;
  sourceArrivalScore: number;
  targetArrivalScore: number;
  reason: string;
}

export interface SimulationPlanCandidateTrace {
  id: string;
  intent: PlanIntent;
  action: unknown;
  evaluation: PlanEvaluation;
  diagnostics?: readonly PlanDiagnostic[];
}

export interface SimulationPlanDecisionTrace {
  chosen: SimulationPlanCandidateTrace;
  rejected: SimulationPlanCandidateTrace[];
}

export interface SimulationFailureCapture {
  schemaVersion: 1;
  kind: SimulationFailureKind;
  scenario: ScenarioKey;
  seed: number;
  gameIndex: number;
  turnNumber: number;
  phase: Phase;
  activePlayer: PlayerId;
  difficulty: AIDifficulty;
  playerDifficulties: { p0: AIDifficulty; p1: AIDifficulty };
  state: GameState;
  action?: unknown;
  planDecision?: SimulationPlanDecisionTrace;
  planDecisions?: SimulationPlanDecisionTrace[];
  stalledShipIds?: string[];
  passengerTransferMistakes?: PassengerTransferMistake[];
  message?: string;
}

export interface SimulationFailureCaptureManifestEntry {
  path: string;
  kind: SimulationFailureKind;
  scenario: ScenarioKey;
  seed: number;
  gameIndex: number;
  turnNumber: number;
  phase: Phase;
  activePlayer: PlayerId;
  difficulty: AIDifficulty;
  message?: string;
  stalledShipIds?: string[];
  passengerTransferMistakeCount?: number;
  chosenPlanIntent?: PlanIntent;
  chosenPlanId?: string;
  chosenPlanIntents?: PlanIntent[];
  chosenPlanIds?: string[];
}

export interface SimulationFailureCaptureManifest {
  schemaVersion: 1;
  scenario: ScenarioKey;
  captureLimit: number;
  captureKinds: SimulationFailureKind[] | null;
  captured: number;
  entries: SimulationFailureCaptureManifestEntry[];
}

type SimulationFailureRecorder = (
  capture: SimulationFailureCapture,
) => Promise<void>;

export type SimulationPolicyWarning = {
  scenario: string;
  kind: 'balance' | 'objective';
  message: string;
};

export type SimulationPolicyEvaluation = {
  failed: boolean;
  warnings: SimulationPolicyWarning[];
};

// Per-scenario P0 decided-game rate thresholds (min, max).
// Decided games = total minus draws/timeouts.
// null = skip balance check (cooperative/race scenarios).
const BALANCE_THRESHOLDS: Record<string, [number, number] | null> = {
  biplanetary: [0.45, 0.85], // Mars→Venus has nav advantage
  escape: [0.0, 0.7], // Asymmetric — enforcers favored after moral victory tightening
  convoy: [0.3, 0.7], // Asymmetric escort
  evacuation: [0.35, 0.65], // 100-game target is 40-60; CI uses 60-game tolerance for sample noise
  duel: [0.3, 0.7], // Symmetric combat (harness randomizes starting seat)
  blockade: [0.25, 0.65], // Asymmetric speed vs combat
  interplanetaryWar: [0.3, 0.7], // Equal credits, different bases
  fleetAction: [0.45, 0.8], // Mars has nav advantage
  grandTour: null, // Cooperative race
};

type ObjectiveWarningPolicy = {
  objectiveReasonMatchers: RegExp[];
  minObjectiveShare?: number;
  maxEliminationShare?: number;
  // Convoy ran 19.3 stalls/game in the 2026-04-24 hard-vs-hard sweep,
  // duel ran 2.8. Fleet-scale scenarios came in 72-110. A gate around 30
  // catches that order-of-magnitude regression without flapping on
  // healthy convoy/blockade samples.
  maxFuelStallsPerGame?: number;
  decidedP0RateBounds?: [number, number];
};

const OBJECTIVE_WARNING_POLICIES: Record<string, ObjectiveWarningPolicy> = {
  biplanetary: {
    objectiveReasonMatchers: [/^Landed on .*?!$/],
    minObjectiveShare: 0.05,
    maxEliminationShare: 0.9,
    maxFuelStallsPerGame: 30,
  },
  blockade: {
    objectiveReasonMatchers: [/^Landed on .*?!$/],
    // Asymmetric interception race: the runner should still attempt Mars,
    // but defender wins by destruction are expected and goal-consistent.
    // Keep balance checks, but do not treat low landing share as objective
    // drift the way we do in symmetric landing races.
    maxFuelStallsPerGame: 30,
  },
  evacuation: {
    objectiveReasonMatchers: [/with colonists!/, /Passenger objective failed/],
    minObjectiveShare: 0.05,
    maxEliminationShare: 0.9,
    maxFuelStallsPerGame: 30,
  },
  convoy: {
    objectiveReasonMatchers: [/with colonists!/, /Passenger objective failed/],
    minObjectiveShare: 0.05,
    maxEliminationShare: 0.9,
    maxFuelStallsPerGame: 30,
  },
  grandTour: {
    objectiveReasonMatchers: [
      /Grand Tour complete!/,
      /Checkpoint race timeout — progress tiebreak/,
    ],
    minObjectiveShare: 0.1,
    decidedP0RateBounds: [0.35, 0.65],
    maxFuelStallsPerGame: 30,
  },
  // Fleet-scale combat scenarios have no landing objective to gate, but
  // the 2026-04-24 sweep flagged them with 72-110 stalls/game — an order
  // of magnitude worse than convoy. Gate fuel stalls so a regression
  // there can't hide behind a clean win-rate distribution.
  fleetAction: {
    objectiveReasonMatchers: [],
    maxFuelStallsPerGame: 30,
  },
  interplanetaryWar: {
    objectiveReasonMatchers: [],
    maxFuelStallsPerGame: 30,
  },
};

// Symmetric scenarios where the starting player should be randomized to cancel
// first-mover advantage in aggregate scorecards.
const RANDOMIZE_START_SCENARIOS: ReadonlySet<string> = new Set([
  'biplanetary',
  'interplanetaryWar',
  'fleetAction',
]);

// Symmetric scenarios with fixed player definitions but randomized live seat
// assignment. Swap the scenario sides in the simulator so scorecards measure
// player fairness rather than one named faction's deterministic route.
const RANDOMIZE_PLAYER_ORDER_SCENARIOS: ReadonlySet<string> = new Set([
  'biplanetary',
]);

const maybeSwapScenarioPlayers = (
  scenario: ScenarioDefinition,
  shouldSwap: boolean,
): ScenarioDefinition => {
  if (!shouldSwap) return scenario;

  const swapped = structuredClone(scenario);
  swapped.players = [swapped.players[1], swapped.players[0]];
  return swapped;
};

const parseDifficulty = (value: string): AIDifficulty => {
  if (value === 'easy' || value === 'normal' || value === 'hard') {
    return value;
  }

  throw new Error(
    `Invalid difficulty "${value}" (expected easy, normal, or hard)`,
  );
};

const parseFailureKind = (value: string): SimulationFailureKind => {
  if ((SIMULATION_FAILURE_KINDS as readonly string[]).includes(value)) {
    return value as SimulationFailureKind;
  }

  throw new Error(
    `Invalid failure kind "${value}" (expected ${SIMULATION_FAILURE_KINDS.join(', ')})`,
  );
};

const deriveGameSeed = (baseSeed: number, gameIndex: number): number =>
  (baseSeed + Math.imul(gameIndex + 1, 0x9e3779b9)) | 0;

const safeFilenameSegment = (value: string): string =>
  value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'unknown';

const writeFailureCapture = async (
  directory: string,
  ordinal: number,
  capture: SimulationFailureCapture,
): Promise<SimulationFailureCaptureManifestEntry> => {
  await mkdir(directory, { recursive: true });
  const filename = [
    String(ordinal).padStart(3, '0'),
    safeFilenameSegment(capture.scenario),
    String(capture.seed),
    capture.kind,
    `turn-${capture.turnNumber}`,
    `p${capture.activePlayer}`,
  ].join('-');
  const absolutePath = path.join(directory, `${filename}.json`);

  await writeFile(absolutePath, `${JSON.stringify(capture, null, 2)}\n`);
  return buildFailureCaptureManifestEntry(`${filename}.json`, capture);
};

const summarizePlanCandidate = <TAction>(
  candidate: PlanCandidate<TAction>,
): SimulationPlanCandidateTrace => ({
  id: candidate.id,
  intent: candidate.intent,
  action: candidate.action,
  evaluation: candidate.evaluation,
  ...(candidate.diagnostics ? { diagnostics: candidate.diagnostics } : {}),
});

const summarizePlanDecision = <TAction>(
  decision: PlanDecision<TAction> | null,
): SimulationPlanDecisionTrace | undefined =>
  decision
    ? {
        chosen: summarizePlanCandidate(decision.chosen),
        rejected: decision.rejected.slice(0, 3).map(summarizePlanCandidate),
      }
    : undefined;

export const buildFailureCaptureManifestEntry = (
  relativePath: string,
  capture: SimulationFailureCapture,
): SimulationFailureCaptureManifestEntry => {
  const primaryPlanDecision =
    capture.planDecision ?? capture.planDecisions?.[0];

  return {
    path: relativePath,
    kind: capture.kind,
    scenario: capture.scenario,
    seed: capture.seed,
    gameIndex: capture.gameIndex,
    turnNumber: capture.turnNumber,
    phase: capture.phase,
    activePlayer: capture.activePlayer,
    difficulty: capture.difficulty,
    ...(capture.message ? { message: capture.message } : {}),
    ...(capture.stalledShipIds
      ? { stalledShipIds: capture.stalledShipIds }
      : {}),
    ...(capture.passengerTransferMistakes
      ? {
          passengerTransferMistakeCount:
            capture.passengerTransferMistakes.length,
        }
      : {}),
    ...(primaryPlanDecision
      ? {
          chosenPlanIntent: primaryPlanDecision.chosen.intent,
          chosenPlanId: primaryPlanDecision.chosen.id,
        }
      : {}),
    ...(capture.planDecisions
      ? {
          chosenPlanIntents: capture.planDecisions.map(
            (decision) => decision.chosen.intent,
          ),
          chosenPlanIds: capture.planDecisions.map(
            (decision) => decision.chosen.id,
          ),
        }
      : {}),
  };
};

export const shouldCaptureFailureKind = (
  kind: SimulationFailureKind,
  allowedKinds: readonly SimulationFailureKind[] | null | undefined,
): boolean =>
  allowedKinds == null ||
  allowedKinds.length === 0 ||
  allowedKinds.includes(kind);

const writeFailureCaptureManifest = async (
  directory: string,
  manifest: SimulationFailureCaptureManifest,
): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'capture-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
};

class AIActionError extends Error {
  constructor(
    readonly phase: Phase,
    readonly playerId: PlayerId,
    readonly failureCounters: SimulationFailureCounters,
    message: string,
  ) {
    super(`AI ${phase} action rejected for P${playerId}: ${message}`);
    this.name = 'AIActionError';
  }
}

const emptyFailureCounters = (): SimulationFailureCounters => ({
  invalidActions: 0,
  invalidActionPhases: {},
  fuelStalls: 0,
  passengerTransferMistakes: 0,
});

const mergeFailureCounters = (
  target: SimulationFailureCounters,
  source: SimulationFailureCounters,
): void => {
  target.invalidActions += source.invalidActions;
  target.fuelStalls += source.fuelStalls;
  target.passengerTransferMistakes += source.passengerTransferMistakes;

  for (const [phase, count] of Object.entries(source.invalidActionPhases)) {
    target.invalidActionPhases[phase] =
      (target.invalidActionPhases[phase] ?? 0) + count;
  }
};

const PASSENGER_TRANSFER_ARRIVAL_LOSS_THRESHOLD = 40;

export const findPassengerTransferMistakes = (
  state: GameState,
  playerId: PlayerId,
  transfers: readonly TransferOrder[],
  map: ReturnType<typeof buildSolarSystemMap>,
): PassengerTransferMistake[] => {
  if (!state.scenarioRules.targetWinRequiresPassengers) {
    return [];
  }

  const mistakes: PassengerTransferMistake[] = [];

  for (const transfer of transfers) {
    if (transfer.transferType !== 'passengers') {
      continue;
    }

    const source = state.ships.find(
      (ship) => ship.id === transfer.sourceShipId,
    );
    const target = state.ships.find(
      (ship) => ship.id === transfer.targetShipId,
    );

    if (!source || !target || source.owner !== playerId) {
      continue;
    }

    const sourceCompromised =
      source.damage.disabledTurns > 0 ||
      source.control !== 'own' ||
      source.lifecycle !== 'active';

    if (sourceCompromised || (source.passengersAboard ?? 0) <= 0) {
      continue;
    }

    const sourceArrivalScore = scorePassengerArrivalOdds(
      source,
      playerId,
      state,
      map,
    );
    const targetArrivalScore = scorePassengerArrivalOdds(
      target,
      playerId,
      state,
      map,
    );
    const arrivalLoss = sourceArrivalScore - targetArrivalScore;

    if (arrivalLoss < PASSENGER_TRANSFER_ARRIVAL_LOSS_THRESHOLD) {
      continue;
    }

    mistakes.push({
      sourceShipId: source.id,
      targetShipId: target.id,
      amount: transfer.amount,
      sourceArrivalScore,
      targetArrivalScore,
      reason:
        `passenger transfer loses ${arrivalLoss.toFixed(1)} arrival score ` +
        `from ${source.id} to ${target.id}`,
    });
  }

  return mistakes;
};

export const findFuelStallShipIds = (
  state: GameState,
  playerId: PlayerId,
  orders: readonly AstrogationOrder[],
): string[] => {
  const ordersByShip = new Map(orders.map((order) => [order.shipId, order]));
  const hasPlayerMovementObjective = (playerId: PlayerId): boolean => {
    const player = state.players[playerId];
    const hasLivePassengerCarrier =
      state.scenarioRules.targetWinRequiresPassengers &&
      state.ships.some(
        (ship) =>
          ship.owner === playerId &&
          ship.lifecycle === 'active' &&
          (ship.passengersAboard ?? 0) > 0,
      );

    return (
      player.escapeWins ||
      (!!player.targetBody &&
        (!state.scenarioRules.targetWinRequiresPassengers ||
          hasLivePassengerCarrier)) ||
      (state.scenarioRules.checkpointBodies?.length ?? 0) > 0
    );
  };
  const isCloseCombatStationKeeping = (ship: Ship): boolean =>
    !hasPlayerMovementObjective(ship.owner) &&
    canAttack(ship) &&
    state.ships.some(
      (enemy) =>
        enemy.owner !== ship.owner &&
        enemy.lifecycle !== 'destroyed' &&
        hexDistance(ship.position, enemy.position) <= 2,
    );
  const isPassengerScreenStationKeeping = (ship: Ship): boolean => {
    if (!state.scenarioRules.targetWinRequiresPassengers || !canAttack(ship)) {
      return false;
    }

    const liveCarrier = state.ships.find(
      (candidate) =>
        candidate.owner === ship.owner &&
        candidate.id !== ship.id &&
        candidate.lifecycle === 'active' &&
        (candidate.passengersAboard ?? 0) > 0,
    );

    if (liveCarrier == null) {
      return false;
    }

    return state.ships.some(
      (enemy) =>
        enemy.owner !== ship.owner &&
        enemy.lifecycle !== 'destroyed' &&
        canAttack(enemy) &&
        hexDistance(ship.position, enemy.position) <= 2,
    );
  };
  const isPassengerFuelSupportStationKeeping = (ship: Ship): boolean => {
    if (!state.scenarioRules.targetWinRequiresPassengers || canAttack(ship)) {
      return false;
    }

    const liveCarrier = state.ships.find(
      (candidate) =>
        candidate.owner === ship.owner &&
        candidate.id !== ship.id &&
        candidate.lifecycle === 'active' &&
        (candidate.passengersAboard ?? 0) > 0 &&
        candidate.position.q === ship.position.q &&
        candidate.position.r === ship.position.r &&
        candidate.velocity.dq === ship.velocity.dq &&
        candidate.velocity.dr === ship.velocity.dr,
    );

    if (liveCarrier == null) {
      return false;
    }

    const carrierOrder = ordersByShip.get(liveCarrier.id);

    return (
      carrierOrder != null &&
      carrierOrder.burn === null &&
      (carrierOrder.overload ?? null) === null &&
      carrierOrder.land !== true
    );
  };
  const isPassengerSupportHoldingDuringCarrierLanding = (
    ship: Ship,
  ): boolean => {
    if (
      !state.scenarioRules.targetWinRequiresPassengers ||
      (ship.passengersAboard ?? 0) > 0
    ) {
      return false;
    }

    return state.ships.some((candidate) => {
      if (
        candidate.owner !== ship.owner ||
        candidate.id === ship.id ||
        candidate.lifecycle !== 'active' ||
        (candidate.passengersAboard ?? 0) <= 0 ||
        hexDistance(ship.position, candidate.position) > 3
      ) {
        return false;
      }

      const carrierOrder = ordersByShip.get(candidate.id);

      return carrierOrder?.land === true;
    });
  };
  const isSupportShipWithoutMovementObjective = (ship: Ship): boolean =>
    !hasPlayerMovementObjective(ship.owner) && !canAttack(ship);

  return getOrderableShipsForPlayer(state, playerId)
    .filter((ship) => {
      if (ship.lifecycle !== 'active') return false;
      if (ship.damage.disabledTurns > 0) return false;
      if (ship.fuel <= 0) return false;
      if (hexVecLength(ship.velocity) !== 0) return false;

      const order = ordersByShip.get(ship.id);
      return (
        order != null &&
        order.burn === null &&
        (order.overload ?? null) === null &&
        order.land !== true &&
        !isSupportShipWithoutMovementObjective(ship) &&
        !isCloseCombatStationKeeping(ship) &&
        !isPassengerScreenStationKeeping(ship) &&
        !isPassengerFuelSupportStationKeeping(ship) &&
        !isPassengerSupportHoldingDuringCarrierLanding(ship)
      );
    })
    .map((ship) => ship.id);
};

const resolveCheckpointRaceTimeout = (
  state: GameState,
  map: ReturnType<typeof buildSolarSystemMap>,
): { winner: PlayerId | null; reason: string } => {
  const checkpoints = state.scenarioRules.checkpointBodies;

  if (!checkpoints || checkpoints.length === 0) {
    return { winner: null, reason: 'timeout' };
  }

  const standings = ([0, 1] as const).map((playerId) => {
    const player = state.players[playerId];
    const aliveShips = state.ships.filter(
      (ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed',
    );
    const visitedCount = checkpoints.filter((body) =>
      player.visitedBodies?.includes(body),
    ).length;
    const remainingTourCost =
      aliveShips.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(
            ...aliveShips.map((ship) =>
              estimateRemainingCheckpointTourCost(
                player,
                checkpoints,
                map,
                ship.position,
              ),
            ),
          );

    return {
      playerId,
      visitedCount,
      remainingTourCost,
      totalFuelSpent: player.totalFuelSpent ?? 0,
      aliveShips: aliveShips.length,
    };
  });

  standings.sort((a, b) => {
    if (a.visitedCount !== b.visitedCount) {
      return b.visitedCount - a.visitedCount;
    }
    if (a.aliveShips !== b.aliveShips) {
      return b.aliveShips - a.aliveShips;
    }
    if (a.remainingTourCost !== b.remainingTourCost) {
      return a.remainingTourCost - b.remainingTourCost;
    }
    if (a.totalFuelSpent !== b.totalFuelSpent) {
      return a.totalFuelSpent - b.totalFuelSpent;
    }
    return a.playerId - b.playerId;
  });

  const [leader, runnerUp] = standings;

  if (
    leader.visitedCount === runnerUp.visitedCount &&
    leader.aliveShips === runnerUp.aliveShips &&
    leader.remainingTourCost === runnerUp.remainingTourCost &&
    leader.totalFuelSpent === runnerUp.totalFuelSpent
  ) {
    return { winner: null, reason: 'timeout' };
  }

  return {
    winner: leader.playerId,
    reason: `Checkpoint race timeout — progress tiebreak (${leader.visitedCount}/${checkpoints.length} checkpoints, ${leader.remainingTourCost} estimated hexes remaining).`,
  };
};

const countReasonsMatching = (
  reasons: Record<string, number>,
  matchers: readonly RegExp[],
): number =>
  Object.entries(reasons).reduce(
    (total, [reason, count]) =>
      matchers.some((matcher) => matcher.test(reason)) ? total + count : total,
    0,
  );

const matchesAnyReason = (
  reason: string,
  matchers: readonly RegExp[],
): boolean => matchers.some((matcher) => matcher.test(reason));

const countTimeoutReasons = (reasons: Record<string, number>): number =>
  Object.entries(reasons).reduce((total, [reason, count]) => {
    const lower = reason.toLowerCase();
    return lower.includes('timeout') ? total + count : total;
  }, 0);

export const buildScenarioScorecard = (
  metrics: Omit<SimulationMetrics, 'scorecard'>,
): ScenarioScorecard => {
  const objectivePolicy = OBJECTIVE_WARNING_POLICIES[metrics.scenario];
  const objectiveResolutions = objectivePolicy
    ? countReasonsMatching(
        metrics.reasons,
        objectivePolicy.objectiveReasonMatchers,
      )
    : 0;
  const fleetEliminations = metrics.reasons['Fleet eliminated!'] ?? 0;
  const passengerDeliveries = countReasonsMatching(metrics.reasons, [
    /with colonists!/,
  ]);
  const grandTourCompletions = countReasonsMatching(metrics.reasons, [
    /Grand Tour complete!/,
  ]);
  const timeouts = Math.max(
    metrics.draws,
    countTimeoutReasons(metrics.reasons),
  );
  const decidedGames = metrics.player0Wins + metrics.player1Wins;
  const totalGames = Math.max(1, metrics.totalGames);

  return {
    decidedGames,
    player0DecidedRate:
      decidedGames > 0 ? metrics.player0Wins / decidedGames : null,
    averageTurns:
      metrics.totalGames > 0 ? metrics.totalTurns / metrics.totalGames : null,
    objectiveResolutions,
    objectiveShare: objectiveResolutions / totalGames,
    fleetEliminations,
    fleetEliminationShare: fleetEliminations / totalGames,
    timeouts,
    timeoutShare: timeouts / totalGames,
    passengerDeliveries,
    passengerDeliveryShare: passengerDeliveries / totalGames,
    grandTourCompletions,
    grandTourCompletionShare: grandTourCompletions / totalGames,
    invalidActions: metrics.failureCounters.invalidActions,
    invalidActionShare: metrics.failureCounters.invalidActions / totalGames,
    fuelStalls: metrics.failureCounters.fuelStalls,
    fuelStallsPerGame: metrics.failureCounters.fuelStalls / totalGames,
    passengerTransferMistakes:
      metrics.failureCounters.passengerTransferMistakes,
    passengerTransferMistakesPerGame:
      metrics.failureCounters.passengerTransferMistakes / totalGames,
  };
};

export const evaluateSimulationPolicies = (
  metricsList: readonly SimulationMetrics[],
): SimulationPolicyEvaluation => {
  const warnings: SimulationPolicyWarning[] = [];
  let failed = false;

  for (const metrics of metricsList) {
    if (metrics.crashes > 0 || metrics.aiInvalidActions > 0) {
      failed = true;
    }

    const threshold = BALANCE_THRESHOLDS[metrics.scenario];
    if (threshold) {
      const decidedGames = metrics.scorecard.decidedGames;
      if (decidedGames >= 5) {
        const p0Rate = metrics.scorecard.player0DecidedRate ?? 0;
        const [lo, hi] = threshold;
        if (p0Rate < lo || p0Rate > hi) {
          warnings.push({
            scenario: metrics.scenario,
            kind: 'balance',
            message:
              `P0 decided rate ${(p0Rate * 100).toFixed(1)}% outside ` +
              `[${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%]`,
          });
        }
      }
    }

    const objectivePolicy = OBJECTIVE_WARNING_POLICIES[metrics.scenario];

    if (!objectivePolicy) {
      continue;
    }

    const objectiveShare = metrics.scorecard.objectiveShare;
    const eliminationShare = metrics.scorecard.fleetEliminationShare;

    if (
      objectivePolicy.minObjectiveShare != null &&
      objectiveShare < objectivePolicy.minObjectiveShare
    ) {
      warnings.push({
        scenario: metrics.scenario,
        kind: 'objective',
        message:
          `objective resolutions ${(objectiveShare * 100).toFixed(1)}% below ` +
          `${(objectivePolicy.minObjectiveShare * 100).toFixed(0)}%`,
      });
    }

    if (
      objectivePolicy.maxEliminationShare != null &&
      eliminationShare > objectivePolicy.maxEliminationShare
    ) {
      warnings.push({
        scenario: metrics.scenario,
        kind: 'objective',
        message:
          `fleet-elimination share ${(eliminationShare * 100).toFixed(1)}% above ` +
          `${(objectivePolicy.maxEliminationShare * 100).toFixed(0)}%`,
      });
    }

    if (objectivePolicy.decidedP0RateBounds != null) {
      const decidedGames = metrics.scorecard.decidedGames;

      if (decidedGames >= 5) {
        const p0Rate = metrics.scorecard.player0DecidedRate ?? 0;
        const [lo, hi] = objectivePolicy.decidedP0RateBounds;

        if (p0Rate < lo || p0Rate > hi) {
          warnings.push({
            scenario: metrics.scenario,
            kind: 'objective',
            message:
              `objective-seat balance P0 decided rate ` +
              `${(p0Rate * 100).toFixed(1)}% outside ` +
              `[${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%]`,
          });
        }
      }
    }

    if (
      objectivePolicy.maxFuelStallsPerGame != null &&
      metrics.totalGames >= 5
    ) {
      const stallsPerGame = metrics.scorecard.fuelStallsPerGame;
      if (stallsPerGame > objectivePolicy.maxFuelStallsPerGame) {
        warnings.push({
          scenario: metrics.scenario,
          kind: 'objective',
          message:
            `fuel stalls/game ${stallsPerGame.toFixed(1)} above ` +
            `${objectivePolicy.maxFuelStallsPerGame.toFixed(0)} (fueled ships ` +
            `coasting instead of burning — see BACKLOG fleet-scale entry)`,
        });
      }
    }
  }

  return { failed, warnings };
};

const runSingleGame = async (
  scenarioName: ScenarioKey,
  p0Diff: AIDifficulty,
  p1Diff: AIDifficulty,
  {
    randomizeStart,
    forcedStart,
    gameSeed,
    gameIndex,
    captureFailure,
  }: {
    randomizeStart: boolean;
    forcedStart: PlayerId | null;
    gameSeed: number;
    gameIndex: number;
    captureFailure?: SimulationFailureRecorder;
  },
) => {
  const failureCounters = emptyFailureCounters();
  const swapPlayerOrder =
    RANDOMIZE_PLAYER_ORDER_SCENARIOS.has(scenarioName) &&
    ((gameSeed >>> 0) & 1) === 1;
  const scenario = maybeSwapScenarioPlayers(
    SCENARIOS[scenarioName],
    swapPlayerOrder,
  );
  const objectivePolicy = OBJECTIVE_WARNING_POLICIES[scenarioName];

  const map = buildSolarSystemMap();
  const rng = mulberry32(gameSeed);

  const createResult = createGame(
    scenario,
    map,
    asGameId(`sim-${scenarioName}-${gameSeed >>> 0}`),
    findBaseHex,
    rng,
    scenarioName,
  );

  if (!createResult.ok) {
    throw new Error(`Failed to create game: ${createResult.error.message}`);
  }

  let state: GameState = createResult.value;
  let lastActionableCapture: Omit<
    SimulationFailureCapture,
    'schemaVersion' | 'scenario' | 'seed' | 'gameIndex' | 'playerDifficulties'
  > | null = null;

  // Randomize starting player to cancel out first-mover bias
  // across many games. Reveals true faction/position balance.
  if (forcedStart !== null) {
    state.activePlayer = forcedStart;
  } else if (randomizeStart || RANDOMIZE_START_SCENARIOS.has(scenarioName)) {
    state.activePlayer = rng() < 0.5 ? 0 : 1;
  }

  // Handle fleet building phase (both players submit simultaneously)
  if (state.phase === 'fleetBuilding') {
    for (const p of [0, 1] as PlayerId[]) {
      const diff = p === 0 ? p0Diff : p1Diff;
      const purchases = buildAIFleetPurchases(
        state,
        p,
        diff,
        scenario.availableFleetPurchases,
      );
      const result = processFleetReady(state, p, purchases, map);
      if ('error' in result)
        throw new Error(`Fleet build error P${p}: ${result.error}`);
      state = result.state;
    }
  }

  let phaseLimit = 1000; // allow for long games traversing the system

  const recordFailure = async (
    capture: Omit<
      SimulationFailureCapture,
      'schemaVersion' | 'scenario' | 'seed' | 'gameIndex' | 'playerDifficulties'
    >,
  ): Promise<void> => {
    if (!captureFailure) return;
    await captureFailure({
      schemaVersion: 1,
      scenario: scenarioName,
      seed: gameSeed >>> 0,
      gameIndex,
      playerDifficulties: { p0: p0Diff, p1: p1Diff },
      ...capture,
      state: structuredClone(capture.state),
    });
  };

  const rejectAIAction = async (
    phase: Phase,
    playerId: PlayerId,
    difficulty: AIDifficulty,
    action: unknown,
    message: string,
  ): Promise<never> => {
    await recordFailure({
      kind: 'invalidAction',
      turnNumber: state.turnNumber,
      phase,
      activePlayer: playerId,
      difficulty,
      state,
      action,
      message,
    });
    throw new AIActionError(phase, playerId, failureCounters, message);
  };

  const recordObjectiveDrift = async (
    winner: PlayerId | null,
    reason: string | null,
  ): Promise<void> => {
    if (
      !reason ||
      winner === null ||
      !objectivePolicy ||
      matchesAnyReason(reason, objectivePolicy.objectiveReasonMatchers)
    ) {
      return;
    }

    await recordFailure({
      kind: 'objectiveDrift',
      turnNumber: lastActionableCapture?.turnNumber ?? state.turnNumber,
      phase: lastActionableCapture?.phase ?? state.phase,
      activePlayer: lastActionableCapture?.activePlayer ?? state.activePlayer,
      difficulty:
        lastActionableCapture?.difficulty ??
        (state.activePlayer === 0 ? p0Diff : p1Diff),
      state: lastActionableCapture?.state ?? state,
      action: lastActionableCapture?.action,
      ...(lastActionableCapture?.planDecision
        ? { planDecision: lastActionableCapture.planDecision }
        : {}),
      ...(lastActionableCapture?.planDecisions
        ? { planDecisions: lastActionableCapture.planDecisions }
        : {}),
      message: reason,
    });
  };
  const recordPassengerObjectiveFailure = async (
    reason: string | null,
  ): Promise<void> => {
    if (
      !reason ||
      !state.scenarioRules.targetWinRequiresPassengers ||
      !reason.startsWith('Passenger objective failed')
    ) {
      return;
    }

    await recordFailure({
      kind: 'passengerObjectiveFailure',
      turnNumber: lastActionableCapture?.turnNumber ?? state.turnNumber,
      phase: lastActionableCapture?.phase ?? state.phase,
      activePlayer: lastActionableCapture?.activePlayer ?? state.activePlayer,
      difficulty:
        lastActionableCapture?.difficulty ??
        (state.activePlayer === 0 ? p0Diff : p1Diff),
      state: lastActionableCapture?.state ?? state,
      action: lastActionableCapture?.action,
      ...(lastActionableCapture?.planDecision
        ? { planDecision: lastActionableCapture.planDecision }
        : {}),
      ...(lastActionableCapture?.planDecisions
        ? { planDecisions: lastActionableCapture.planDecisions }
        : {}),
      message: reason,
    });
  };

  while (state.phase !== 'gameOver' && phaseLimit > 0) {
    const activePlayer = state.activePlayer;
    const difficulty = activePlayer === 0 ? p0Diff : p1Diff;

    try {
      if (state.phase === 'astrogation') {
        const astrogationPlanDecisions: SimulationPlanDecisionTrace[] = [];
        const orders = aiAstrogation(
          state,
          activePlayer,
          map,
          difficulty,
          rng,
          ({ decision }) => {
            const planDecision = summarizePlanDecision(decision);

            if (planDecision) astrogationPlanDecisions.push(planDecision);
          },
        );
        const planDecisions =
          astrogationPlanDecisions.length > 0
            ? astrogationPlanDecisions
            : undefined;
        lastActionableCapture = {
          kind: 'objectiveDrift',
          turnNumber: state.turnNumber,
          phase: state.phase,
          activePlayer,
          difficulty,
          state,
          action: { type: 'astrogation', orders },
          ...(planDecisions ? { planDecisions } : {}),
        };
        const stalledShipIds = findFuelStallShipIds(
          state,
          activePlayer,
          orders,
        );
        failureCounters.fuelStalls += stalledShipIds.length;
        if (stalledShipIds.length > 0) {
          await recordFailure({
            kind: 'fuelStall',
            turnNumber: state.turnNumber,
            phase: state.phase,
            activePlayer,
            difficulty,
            state,
            action: { type: 'astrogation', orders },
            ...(planDecisions ? { planDecisions } : {}),
            stalledShipIds,
          });
        }
        const result = processAstrogation(
          state,
          activePlayer,
          orders,
          map,
          rng,
        );
        if ('error' in result) {
          await rejectAIAction(
            state.phase,
            activePlayer,
            difficulty,
            { type: 'astrogation', orders },
            result.error.message,
          );
        } else {
          state = result.state;
        }
      } else if (state.phase === 'ordnance') {
        const ordnancePlanDecisions: SimulationPlanDecisionTrace[] = [];
        const launches = aiOrdnance(
          state,
          activePlayer,
          map,
          difficulty,
          rng,
          ({ decision }) => {
            const planDecision = summarizePlanDecision(decision);

            if (planDecision) ordnancePlanDecisions.push(planDecision);
          },
        );
        lastActionableCapture = {
          kind: 'objectiveDrift',
          turnNumber: state.turnNumber,
          phase: state.phase,
          activePlayer,
          difficulty,
          state,
          action:
            launches.length > 0
              ? { type: 'ordnance', launches }
              : { type: 'skipOrdnance' },
          ...(ordnancePlanDecisions.length > 0
            ? { planDecisions: ordnancePlanDecisions }
            : {}),
        };

        if (launches.length > 0) {
          const result = processOrdnance(
            state,
            activePlayer,
            launches,
            map,
            rng,
          );
          if ('error' in result) {
            await rejectAIAction(
              state.phase,
              activePlayer,
              difficulty,
              { type: 'ordnance', launches },
              result.error.message,
            );
          } else {
            state = result.state;
          }
        } else {
          const result = skipOrdnance(state, activePlayer, map, rng);
          if ('error' in result) {
            await rejectAIAction(
              state.phase,
              activePlayer,
              difficulty,
              { type: 'skipOrdnance' },
              result.error.message,
            );
          } else {
            state = result.state;
          }
        }
      } else if (state.phase === 'logistics') {
        const transfers = aiLogistics(state, activePlayer, map, difficulty);
        lastActionableCapture = {
          kind: 'objectiveDrift',
          turnNumber: state.turnNumber,
          phase: state.phase,
          activePlayer,
          difficulty,
          state,
          action:
            transfers.length > 0
              ? { type: 'logistics', transfers }
              : { type: 'skipLogistics' },
        };
        const passengerTransferMistakes = findPassengerTransferMistakes(
          state,
          activePlayer,
          transfers,
          map,
        );
        failureCounters.passengerTransferMistakes +=
          passengerTransferMistakes.length;
        if (passengerTransferMistakes.length > 0) {
          await recordFailure({
            kind: 'passengerTransferMistake',
            turnNumber: state.turnNumber,
            phase: state.phase,
            activePlayer,
            difficulty,
            state,
            action: { type: 'logistics', transfers },
            passengerTransferMistakes,
            message: passengerTransferMistakes
              .map((mistake) => mistake.reason)
              .join('; '),
          });
        }
        const result =
          transfers.length > 0
            ? processLogistics(state, activePlayer, transfers, map)
            : skipLogistics(state, activePlayer, map);
        if ('error' in result) {
          await rejectAIAction(
            state.phase,
            activePlayer,
            difficulty,
            transfers.length > 0
              ? { type: 'logistics', transfers }
              : { type: 'skipLogistics' },
            result.error.message,
          );
        } else {
          state = result.state;
        }
      } else if (state.phase === 'combat') {
        // Evaluate pre-combat (asteroid hazards)
        const preResult = beginCombatPhase(state, activePlayer, map, rng);
        if ('error' in preResult) {
          await rejectAIAction(
            state.phase,
            activePlayer,
            difficulty,
            { type: 'beginCombat' },
            preResult.error.message,
          );
        } else {
          state = preResult.state;
        }

        if (state.phase === 'combat') {
          const detectedEnemyShips = state.ships.filter(
            (ship) =>
              ship.owner !== activePlayer &&
              ship.lifecycle !== 'destroyed' &&
              ship.detected,
          );
          const passengerCombatPlan = choosePassengerCombatPlan(
            state,
            activePlayer,
            map,
            detectedEnemyShips,
            undefined,
            buildAIDoctrineContext(state, activePlayer, map, detectedEnemyShips)
              .passenger,
          );
          const combatPlanDecisions: SimulationPlanDecisionTrace[] = [];
          const attacks = aiCombat(
            state,
            activePlayer,
            map,
            difficulty,
            ({ decision }) => {
              const planDecision = summarizePlanDecision(decision);

              if (planDecision) combatPlanDecisions.push(planDecision);
            },
          );
          const passengerPlanDecision =
            summarizePlanDecision(passengerCombatPlan);
          const planDecisions = [
            ...(passengerPlanDecision ? [passengerPlanDecision] : []),
            ...combatPlanDecisions,
          ];
          lastActionableCapture = {
            kind: 'objectiveDrift',
            turnNumber: state.turnNumber,
            phase: state.phase,
            activePlayer,
            difficulty,
            state,
            action:
              attacks.length > 0
                ? { type: 'combat', attacks }
                : { type: 'skipCombat' },
            ...(passengerPlanDecision
              ? { planDecision: passengerPlanDecision }
              : {}),
            ...(planDecisions.length > 0 ? { planDecisions } : {}),
          };

          if (attacks.length > 0) {
            const result = processCombat(
              state,
              activePlayer,
              attacks,
              map,
              rng,
            );
            if ('error' in result) {
              await rejectAIAction(
                state.phase,
                activePlayer,
                difficulty,
                { type: 'combat', attacks },
                result.error.message,
              );
            } else {
              state = result.state;
            }
          } else {
            const result = skipCombat(state, activePlayer, map, rng);
            if ('error' in result) {
              await rejectAIAction(
                state.phase,
                activePlayer,
                difficulty,
                { type: 'skipCombat' },
                result.error.message,
              );
            } else {
              state = result.state;
            }
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof AIActionError)) {
        console.error(
          `Simulation crashed on turn ${state.turnNumber}, phase ${state.phase}. Error:`,
          err,
        );
      }
      throw err;
    }

    phaseLimit--;
  }

  if (phaseLimit <= 0) {
    const timeoutResolution = resolveCheckpointRaceTimeout(state, map);
    await recordObjectiveDrift(
      timeoutResolution.winner,
      timeoutResolution.reason,
    );
    return {
      winner: timeoutResolution.winner,
      turns: state.turnNumber,
      reason: timeoutResolution.reason,
      failureCounters,
    };
  }

  await recordPassengerObjectiveFailure(state.outcome?.reason ?? null);
  await recordObjectiveDrift(
    state.outcome?.winner ?? null,
    state.outcome?.reason ?? null,
  );

  return {
    winner: state.outcome?.winner ?? null,
    turns: state.turnNumber,
    reason: state.outcome?.reason ?? null,
    failureCounters,
  };
};

export const runSimulation = async (
  scenarioName: ScenarioKey,
  iterations: number,
  options: SimulationOptions,
) => {
  const quiet = options.quiet === true;

  if (!quiet) {
    console.log(
      `\n=== Starting Simulation: ${scenarioName} (${iterations} iterations, ` +
        `P0=${options.p0Diff}, P1=${options.p1Diff}, seed=${options.baseSeed}` +
        `${options.forcedStart !== null ? `, forcedStart=${options.forcedStart}` : ''}` +
        `${options.randomizeStart ? ', randomizeStart=true' : ''}) ===\n`,
    );
  }

  const metrics: SimulationMetrics = {
    scenario: scenarioName,
    totalGames: 0,
    player0Wins: 0,
    player1Wins: 0,
    draws: 0,
    totalTurns: 0,
    crashes: 0,
    crashSeeds: [],
    aiInvalidActions: 0,
    invalidActionSeeds: [],
    failureCounters: emptyFailureCounters(),
    reasons: {},
    scorecard: buildScenarioScorecard({
      scenario: scenarioName,
      totalGames: 0,
      player0Wins: 0,
      player1Wins: 0,
      draws: 0,
      totalTurns: 0,
      crashes: 0,
      crashSeeds: [],
      aiInvalidActions: 0,
      invalidActionSeeds: [],
      failureCounters: emptyFailureCounters(),
      reasons: {},
    }),
  };

  const startTime = Date.now();
  let capturedFailureCount = 0;
  const captureFailuresDir = options.captureFailuresDir ?? null;
  const captureFailuresLimit = options.captureFailuresLimit ?? 5;
  const captureFailureKinds = options.captureFailureKinds ?? null;
  const capturedFailureEntries: SimulationFailureCaptureManifestEntry[] = [];
  const captureFailure: SimulationFailureRecorder | undefined =
    captureFailuresDir === null
      ? undefined
      : async (capture) => {
          if (!shouldCaptureFailureKind(capture.kind, captureFailureKinds)) {
            return;
          }
          if (capturedFailureCount >= captureFailuresLimit) return;
          capturedFailureCount++;
          const entry = await writeFailureCapture(
            captureFailuresDir,
            capturedFailureCount,
            capture,
          );
          capturedFailureEntries.push(entry);
        };

  for (let i = 0; i < iterations; i++) {
    const gameSeed = deriveGameSeed(options.baseSeed, i);

    try {
      const result = await runSingleGame(
        scenarioName,
        options.p0Diff,
        options.p1Diff,
        {
          randomizeStart: options.randomizeStart,
          forcedStart: options.forcedStart,
          gameSeed,
          gameIndex: i,
          captureFailure,
        },
      );
      metrics.totalGames++;
      metrics.totalTurns += result.turns;
      mergeFailureCounters(metrics.failureCounters, result.failureCounters);

      if (result.winner === 0) metrics.player0Wins++;
      else if (result.winner === 1) metrics.player1Wins++;
      else metrics.draws++;

      const reason = result.reason || 'unknown';
      metrics.reasons[reason] = (metrics.reasons[reason] || 0) + 1;

      // Print progress
      if (!quiet && (i + 1) % Math.max(1, Math.floor(iterations / 10)) === 0) {
        process.stdout.write('.');
      }
    } catch (err) {
      if (err instanceof AIActionError) {
        metrics.aiInvalidActions++;
        mergeFailureCounters(metrics.failureCounters, err.failureCounters);
        metrics.failureCounters.invalidActions++;
        metrics.failureCounters.invalidActionPhases[err.phase] =
          (metrics.failureCounters.invalidActionPhases[err.phase] ?? 0) + 1;
        if (metrics.invalidActionSeeds.length < 5) {
          metrics.invalidActionSeeds.push(gameSeed >>> 0);
        }
      } else {
        metrics.crashes++;
        if (metrics.crashSeeds.length < 5) {
          metrics.crashSeeds.push(gameSeed >>> 0);
        }
      }
    }
  }

  metrics.scorecard = buildScenarioScorecard(metrics);
  if (captureFailuresDir !== null) {
    await writeFailureCaptureManifest(captureFailuresDir, {
      schemaVersion: 1,
      scenario: scenarioName,
      captureLimit: captureFailuresLimit,
      captureKinds: captureFailureKinds,
      captured: capturedFailureEntries.length,
      entries: capturedFailureEntries,
    });
  }

  const duration = Date.now() - startTime;

  if (!quiet) {
    console.log(`\n\n=== Simulation Complete in ${duration}ms ===`);
    console.log(`Total Games: ${metrics.totalGames}`);
    console.log(
      `Player 0 Wins: ${metrics.player0Wins} (${((metrics.player0Wins / metrics.totalGames) * 100).toFixed(1)}%)`,
    );
    console.log(
      `Player 1 Wins: ${metrics.player1Wins} (${((metrics.player1Wins / metrics.totalGames) * 100).toFixed(1)}%)`,
    );
    console.log(
      `Draws/Timeouts: ${metrics.draws} (${((metrics.draws / metrics.totalGames) * 100).toFixed(1)}%)`,
    );
    console.log(
      `Average Turns: ${(metrics.totalTurns / metrics.totalGames).toFixed(1)}`,
    );
    console.log(`Engine Crashes: ${metrics.crashes}`);
    if (metrics.crashSeeds.length > 0) {
      console.log(`Crash Seeds: ${metrics.crashSeeds.join(', ')}`);
    }
    console.log(`AI Invalid Actions: ${metrics.aiInvalidActions}`);
    if (metrics.invalidActionSeeds.length > 0) {
      console.log(
        `Invalid Action Seeds: ${metrics.invalidActionSeeds.join(', ')}`,
      );
    }
    if (captureFailuresDir !== null) {
      console.log(
        `Failure Captures: ${capturedFailureCount} written to ${captureFailuresDir}`,
      );
      console.log(
        `Failure Capture Manifest: ${path.join(captureFailuresDir, 'capture-manifest.json')}`,
      );
    }

    console.log(`\nWin Reasons:`);
    for (const [reason, count] of Object.entries(metrics.reasons)) {
      console.log(`  - ${reason}: ${count}`);
    }
    console.log(`\nScenario Scorecard:`);
    console.log(
      `  - Objective Share: ${(metrics.scorecard.objectiveShare * 100).toFixed(1)}%`,
    );
    console.log(
      `  - Fleet Elimination Share: ${(metrics.scorecard.fleetEliminationShare * 100).toFixed(1)}%`,
    );
    console.log(
      `  - Timeout Share: ${(metrics.scorecard.timeoutShare * 100).toFixed(1)}%`,
    );
    if (metrics.scorecard.player0DecidedRate != null) {
      console.log(
        `  - P0 Decided Rate: ${(metrics.scorecard.player0DecidedRate * 100).toFixed(1)}%`,
      );
    }
    if (metrics.scorecard.passengerDeliveries > 0) {
      console.log(
        `  - Passenger Delivery Share: ${(metrics.scorecard.passengerDeliveryShare * 100).toFixed(1)}%`,
      );
    }
    if (metrics.scorecard.grandTourCompletions > 0) {
      console.log(
        `  - Grand Tour Completion Share: ${(metrics.scorecard.grandTourCompletionShare * 100).toFixed(1)}%`,
      );
    }
    if (metrics.scorecard.invalidActions > 0) {
      console.log(
        `  - Invalid AI Actions: ${metrics.scorecard.invalidActions}`,
      );
    }
    if (metrics.scorecard.fuelStalls > 0) {
      console.log(
        `  - Fuel Stalls/Game: ${metrics.scorecard.fuelStallsPerGame.toFixed(2)}`,
      );
    }
    if (metrics.scorecard.passengerTransferMistakes > 0) {
      console.log(
        `  - Passenger Transfer Mistakes/Game: ${metrics.scorecard.passengerTransferMistakesPerGame.toFixed(2)}`,
      );
    }
  }

  return metrics;
};

const main = async () => {
  const args = process.argv.slice(2);
  let isCiMode = false;
  const options: SimulationOptions = {
    p0Diff: 'hard',
    p1Diff: 'hard',
    randomizeStart: false,
    forcedStart: null,
    baseSeed: Date.now() | 0,
    json: false,
    captureFailuresDir: null,
    captureFailuresLimit: 5,
    captureFailureKinds: null,
    quiet: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--ci':
        isCiMode = true;
        break;
      case '--randomize-start':
        options.randomizeStart = true;
        break;
      case '--p0':
        options.p0Diff = parseDifficulty(args[++i] ?? '');
        break;
      case '--p1':
        options.p1Diff = parseDifficulty(args[++i] ?? '');
        break;
      case '--seed':
        options.baseSeed = Number.parseInt(args[++i] ?? '', 10) | 0;
        break;
      case '--forced-start': {
        const value = args[++i];

        if (value !== '0' && value !== '1') {
          throw new Error(`Invalid forced start "${value}" (expected 0 or 1)`);
        }
        options.forcedStart = Number.parseInt(value, 10) as PlayerId;
        break;
      }
      case '--json':
        options.json = true;
        break;
      case '--capture-failures':
        options.captureFailuresDir = args[++i] ?? '';
        if (options.captureFailuresDir.length === 0) {
          throw new Error('--capture-failures requires an output directory');
        }
        break;
      case '--capture-failures-limit':
        options.captureFailuresLimit = Math.max(
          0,
          Number.parseInt(args[++i] ?? '', 10) || 0,
        );
        break;
      case '--capture-failure-kind': {
        const raw = args[++i] ?? '';
        const kinds = raw
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .map(parseFailureKind);

        if (kinds.length === 0) {
          throw new Error('--capture-failure-kind requires at least one kind');
        }
        options.captureFailureKinds = [
          ...(options.captureFailureKinds ?? []),
          ...kinds,
        ];
        break;
      }
      case '--quiet':
        options.quiet = true;
        break;
      default:
        positionals.push(arg);
        break;
    }
  }

  const scenarioArg = positionals[0] || 'biplanetary';
  const iterations = parseInt(positionals[1] || '100', 10);

  const allMetrics: SimulationMetrics[] = [];

  if (scenarioArg === 'all') {
    for (const key of Object.keys(SCENARIOS)) {
      if (!isValidScenario(key)) continue;
      allMetrics.push(await runSimulation(key, iterations, options));
    }
  } else if (isValidScenario(scenarioArg)) {
    allMetrics.push(await runSimulation(scenarioArg, iterations, options));
  } else {
    console.error(`Unknown scenario: ${scenarioArg}`);
    process.exit(1);
  }

  // Evaluate strict constraints if running in CI format
  if (isCiMode) {
    const policyEvaluation = evaluateSimulationPolicies(allMetrics);

    for (const metrics of allMetrics) {
      if (metrics.crashes > 0) {
        console.error(
          `❌ CI FAILURE: ${metrics.scenario} — Engine crashed ${metrics.crashes} times.`,
        );
      }
      if (metrics.aiInvalidActions > 0) {
        console.error(
          `❌ CI FAILURE: ${metrics.scenario} — AI submitted ${metrics.aiInvalidActions} invalid actions.`,
        );
      }
    }

    for (const warning of policyEvaluation.warnings) {
      console.warn(`⚠️  ${warning.scenario}: ${warning.message}`);
    }

    if (policyEvaluation.failed) {
      console.error('\n🚨 CI Constraints Failed. Exiting with code 1.');
      process.exit(1);
    } else if (policyEvaluation.warnings.length > 0) {
      console.log(
        '\n✅ CI stability checks passed. Balance/objective warnings above are non-fatal.',
      );
    } else {
      console.log('\n✅ CI Constraints Passed. Engine is stable and balanced.');
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          scenario: scenarioArg,
          iterations,
          options,
          metrics: allMetrics,
        },
        null,
        2,
      ),
    );
  }
};

const shouldRunCli = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
};

if (shouldRunCli()) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
