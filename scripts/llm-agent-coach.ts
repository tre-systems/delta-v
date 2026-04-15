import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { AgentTurnInput } from '../src/shared/agent';
import { hexDistance } from '../src/shared/hex';
import type { ReplayTimeline } from '../src/shared/replay';
import type {
  GameOutcome,
  GameState,
  PlayerId,
  Ship,
} from '../src/shared/types/domain';
import type { C2S } from '../src/shared/types/protocol';

interface TurnSummary {
  turnNumber: number;
  endingPhase: string;
  ownOperationalShips: number;
  enemyOperationalShips: number;
  ownFuel: number;
  enemyFuel: number;
  nearestEnemyDistance: number | null;
}

interface ReplaySummary {
  gameId: string;
  roomCode: string;
  matchNumber: number;
  scenario: string;
  entries: number;
  finalTurn: number | null;
  finalPhase: string | null;
  winner: PlayerId | null;
  reason: string | null;
  activeShipsByOwner: Record<string, number>;
  phaseCounts: Record<string, number>;
}

interface AgentReportInput {
  kind: 'report';
  version: 1;
  gameCode: string;
  playerId: PlayerId;
  replaySummary: ReplaySummary;
  turnSummaries: TurnSummary[];
  finalState: GameState;
  timeline?: ReplayTimeline;
}

interface AgentTurnResponse {
  candidateIndex: number;
  chat?: string;
}

interface AgentReportResponse {
  summary: string;
  recentChats: string[];
  strengths: string[];
  mistakes: string[];
  lessons: string[];
  nextFocus: string[];
  record: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
  };
}

interface AgentConfig {
  profile: string;
  stateDir: string;
}

interface LessonRecord {
  note: string;
  count: number;
  lastUpdatedAt: number;
}

interface StateDigest {
  turnNumber: number;
  phase: string;
  ownOperationalShips: number;
  enemyOperationalShips: number;
  ownFuel: number;
  enemyFuel: number;
  nearestEnemyDistance: number | null;
  materialEdge: number;
}

interface MatchObservation {
  turnNumber: number;
  phase: string;
  chosenActionType: string;
  materialEdge: number;
  nearestEnemyDistance: number | null;
}

interface MatchMemory {
  gameCode: string;
  playerId: PlayerId | null;
  startedAt: number;
  lastSeenAt: number;
  lastDigest: StateDigest | null;
  lastChatTurn: number | null;
  lastChatPhase: string | null;
  recentChats: string[];
  observations: MatchObservation[];
  lessons: LessonRecord[];
  finalizedAt: number | null;
}

interface AgentMemory {
  schemaVersion: 1;
  profile: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  style: {
    aggressionBias: number;
    cautionBias: number;
  };
  recurringLessons: LessonRecord[];
  matches: Record<string, MatchMemory>;
}

const DEFAULT_PROFILE = 'coach';
const DEFAULT_STATE_DIR = path.join(os.tmpdir(), 'delta-v-agent-state');
const MAX_OBSERVATIONS = 24;
const MAX_LESSONS = 8;
const MAX_RECENT_CHATS = 6;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const timestamp = (): number => Date.now();

const sanitizeProfile = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');

const parseArgs = (argv: string[]): AgentConfig => {
  const args = [...argv];
  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  return {
    profile: sanitizeProfile(getFlag('--profile') ?? DEFAULT_PROFILE),
    stateDir: getFlag('--state-dir') ?? DEFAULT_STATE_DIR,
  };
};

const createDefaultMemory = (profile: string): AgentMemory => ({
  schemaVersion: 1,
  profile,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  style: {
    aggressionBias: 0,
    cautionBias: 0,
  },
  recurringLessons: [],
  matches: {},
});

const getStatePath = (config: AgentConfig): string =>
  path.join(config.stateDir, `${config.profile}.json`);

const isLessonRecord = (value: unknown): value is LessonRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { note?: unknown }).note === 'string' &&
  typeof (value as { count?: unknown }).count === 'number' &&
  typeof (value as { lastUpdatedAt?: unknown }).lastUpdatedAt === 'number';

const normalizeMatchMemory = (value: unknown): MatchMemory | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { gameCode?: unknown }).gameCode !== 'string'
  ) {
    return null;
  }

  const raw = value as Partial<MatchMemory>;
  const gameCode = raw.gameCode as string;
  return {
    gameCode,
    playerId: raw.playerId === 0 || raw.playerId === 1 ? raw.playerId : null,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : timestamp(),
    lastSeenAt:
      typeof raw.lastSeenAt === 'number' ? raw.lastSeenAt : timestamp(),
    lastDigest:
      raw.lastDigest &&
      typeof raw.lastDigest === 'object' &&
      typeof raw.lastDigest.turnNumber === 'number' &&
      typeof raw.lastDigest.phase === 'string' &&
      typeof raw.lastDigest.ownOperationalShips === 'number' &&
      typeof raw.lastDigest.enemyOperationalShips === 'number' &&
      typeof raw.lastDigest.ownFuel === 'number' &&
      typeof raw.lastDigest.enemyFuel === 'number' &&
      typeof raw.lastDigest.materialEdge === 'number'
        ? {
            turnNumber: raw.lastDigest.turnNumber,
            phase: raw.lastDigest.phase,
            ownOperationalShips: raw.lastDigest.ownOperationalShips,
            enemyOperationalShips: raw.lastDigest.enemyOperationalShips,
            ownFuel: raw.lastDigest.ownFuel,
            enemyFuel: raw.lastDigest.enemyFuel,
            nearestEnemyDistance:
              typeof raw.lastDigest.nearestEnemyDistance === 'number'
                ? raw.lastDigest.nearestEnemyDistance
                : null,
            materialEdge: raw.lastDigest.materialEdge,
          }
        : null,
    lastChatTurn:
      typeof raw.lastChatTurn === 'number' ? raw.lastChatTurn : null,
    lastChatPhase:
      typeof raw.lastChatPhase === 'string' ? raw.lastChatPhase : null,
    recentChats: Array.isArray(raw.recentChats)
      ? raw.recentChats.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    observations: Array.isArray(raw.observations)
      ? raw.observations.filter(
          (item): item is MatchObservation =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { turnNumber?: unknown }).turnNumber === 'number' &&
            typeof (item as { phase?: unknown }).phase === 'string' &&
            typeof (item as { chosenActionType?: unknown }).chosenActionType ===
              'string' &&
            typeof (item as { materialEdge?: unknown }).materialEdge ===
              'number',
        )
      : [],
    lessons: Array.isArray(raw.lessons)
      ? raw.lessons.filter(isLessonRecord)
      : [],
    finalizedAt: typeof raw.finalizedAt === 'number' ? raw.finalizedAt : null,
  };
};

const readMemory = async (config: AgentConfig): Promise<AgentMemory> => {
  try {
    const raw = await readFile(getStatePath(config), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AgentMemory>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.profile !== 'string' ||
      typeof parsed.gamesPlayed !== 'number' ||
      typeof parsed.wins !== 'number' ||
      typeof parsed.losses !== 'number' ||
      typeof parsed.draws !== 'number' ||
      typeof parsed.style !== 'object' ||
      parsed.style === null ||
      typeof parsed.style.aggressionBias !== 'number' ||
      typeof parsed.style.cautionBias !== 'number' ||
      typeof parsed.matches !== 'object' ||
      parsed.matches === null ||
      !Array.isArray(parsed.recurringLessons)
    ) {
      return createDefaultMemory(config.profile);
    }

    return {
      schemaVersion: 1,
      profile: parsed.profile,
      gamesPlayed: parsed.gamesPlayed,
      wins: parsed.wins,
      losses: parsed.losses,
      draws: parsed.draws,
      style: {
        aggressionBias: parsed.style.aggressionBias,
        cautionBias: parsed.style.cautionBias,
      },
      recurringLessons: parsed.recurringLessons.filter(isLessonRecord),
      matches: Object.fromEntries(
        Object.entries(parsed.matches)
          .map(([gameCode, match]) => [gameCode, normalizeMatchMemory(match)])
          .filter((entry): entry is [string, MatchMemory] => entry[1] !== null),
      ) as Record<string, MatchMemory>,
    };
  } catch {
    return createDefaultMemory(config.profile);
  }
};

const writeMemory = async (
  config: AgentConfig,
  memory: AgentMemory,
): Promise<void> => {
  await mkdir(config.stateDir, { recursive: true });
  await writeFile(getStatePath(config), JSON.stringify(memory, null, 2));
};

const trimLessons = (lessons: LessonRecord[]): LessonRecord[] =>
  [...lessons]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return right.lastUpdatedAt - left.lastUpdatedAt;
    })
    .slice(0, MAX_LESSONS);

const addLesson = (
  lessons: LessonRecord[],
  note: string,
  count = 1,
): LessonRecord[] => {
  const normalized = note.trim();
  if (!normalized) {
    return lessons;
  }

  const existing = lessons.find((lesson) => lesson.note === normalized);
  if (existing) {
    existing.count += count;
    existing.lastUpdatedAt = timestamp();
    return trimLessons(lessons);
  }

  return trimLessons([
    ...lessons,
    {
      note: normalized,
      count,
      lastUpdatedAt: timestamp(),
    },
  ]);
};

const ensureMatchMemory = (
  memory: AgentMemory,
  gameCode: string,
  playerId: PlayerId,
): MatchMemory => {
  const existing = memory.matches[gameCode];
  if (existing) {
    existing.playerId = playerId;
    existing.lastSeenAt = timestamp();
    return existing;
  }

  const created: MatchMemory = {
    gameCode,
    playerId,
    startedAt: timestamp(),
    lastSeenAt: timestamp(),
    lastDigest: null,
    lastChatTurn: null,
    lastChatPhase: null,
    recentChats: [],
    observations: [],
    lessons: [],
    finalizedAt: null,
  };
  memory.matches[gameCode] = created;
  return created;
};

const getOperationalShips = (state: GameState, owner: PlayerId): Ship[] =>
  state.ships.filter(
    (ship) => ship.owner === owner && ship.lifecycle !== 'destroyed',
  );

const getNearestEnemyDistance = (
  state: GameState,
  playerId: PlayerId,
): number | null => {
  const ownShips = getOperationalShips(state, playerId);
  const enemyShips = getOperationalShips(state, playerId === 0 ? 1 : 0);
  let best: number | null = null;

  for (const ownShip of ownShips) {
    for (const enemyShip of enemyShips) {
      const distance = hexDistance(ownShip.position, enemyShip.position);
      best = best === null ? distance : Math.min(best, distance);
    }
  }

  return best;
};

const buildStateDigest = (
  state: GameState,
  playerId: PlayerId,
): StateDigest => {
  const ownShips = getOperationalShips(state, playerId);
  const enemyShips = getOperationalShips(state, playerId === 0 ? 1 : 0);

  return {
    turnNumber: state.turnNumber,
    phase: state.phase,
    ownOperationalShips: ownShips.length,
    enemyOperationalShips: enemyShips.length,
    ownFuel: ownShips.reduce((sum, ship) => sum + ship.fuel, 0),
    enemyFuel: enemyShips.reduce((sum, ship) => sum + ship.fuel, 0),
    nearestEnemyDistance: getNearestEnemyDistance(state, playerId),
    materialEdge: ownShips.length - enemyShips.length,
  };
};

const updateStyleFromTransition = (
  memory: AgentMemory,
  previousDigest: StateDigest,
  currentDigest: StateDigest,
): void => {
  if (
    currentDigest.enemyOperationalShips < previousDigest.enemyOperationalShips
  ) {
    memory.style.aggressionBias = clamp(memory.style.aggressionBias + 1, -3, 3);
  }
  if (
    currentDigest.ownOperationalShips < previousDigest.ownOperationalShips &&
    currentDigest.enemyOperationalShips === previousDigest.enemyOperationalShips
  ) {
    memory.style.cautionBias = clamp(memory.style.cautionBias + 1, -3, 3);
  }
  if (
    currentDigest.ownFuel < previousDigest.ownFuel - 1 &&
    currentDigest.materialEdge <= previousDigest.materialEdge
  ) {
    memory.style.cautionBias = clamp(memory.style.cautionBias + 1, -3, 3);
  }
  if (
    currentDigest.nearestEnemyDistance !== null &&
    previousDigest.nearestEnemyDistance !== null &&
    currentDigest.nearestEnemyDistance < previousDigest.nearestEnemyDistance &&
    currentDigest.materialEdge >= previousDigest.materialEdge
  ) {
    memory.style.aggressionBias = clamp(memory.style.aggressionBias + 1, -3, 3);
  }
};

const learnFromTransition = (
  memory: AgentMemory,
  match: MatchMemory,
  currentDigest: StateDigest,
): void => {
  const previousDigest = match.lastDigest;
  if (!previousDigest) {
    return;
  }

  if (
    currentDigest.enemyOperationalShips <
      previousDigest.enemyOperationalShips &&
    currentDigest.ownOperationalShips === previousDigest.ownOperationalShips
  ) {
    const note = 'Pressing a clean advantage can convert directly into kills.';
    match.lessons = addLesson(match.lessons, note);
    memory.recurringLessons = addLesson(memory.recurringLessons, note);
  }

  if (
    currentDigest.ownOperationalShips < previousDigest.ownOperationalShips &&
    currentDigest.enemyOperationalShips === previousDigest.enemyOperationalShips
  ) {
    const note =
      'Losing material without a return shot means the approach was too generous.';
    match.lessons = addLesson(match.lessons, note);
    memory.recurringLessons = addLesson(memory.recurringLessons, note);
  }

  if (
    currentDigest.nearestEnemyDistance !== null &&
    previousDigest.nearestEnemyDistance !== null &&
    currentDigest.nearestEnemyDistance < previousDigest.nearestEnemyDistance &&
    currentDigest.materialEdge >= previousDigest.materialEdge
  ) {
    const note = 'Closing range is worth it when we keep parity intact.';
    match.lessons = addLesson(match.lessons, note);
    memory.recurringLessons = addLesson(memory.recurringLessons, note);
  }

  if (
    currentDigest.ownFuel < previousDigest.ownFuel - 1 &&
    currentDigest.materialEdge <= previousDigest.materialEdge
  ) {
    const note = 'Fuel spending needs a tangible payoff in position or damage.';
    match.lessons = addLesson(match.lessons, note);
    memory.recurringLessons = addLesson(memory.recurringLessons, note);
  }

  updateStyleFromTransition(memory, previousDigest, currentDigest);
};

const getActionType = (action: C2S | undefined): string =>
  action?.type ?? 'unknown';

const isAggressiveAlternative = (action: C2S): boolean =>
  action.type === 'combat' ||
  action.type === 'ordnance' ||
  action.type === 'beginCombat';

const scoreCandidate = (
  input: AgentTurnInput,
  memory: AgentMemory,
  digest: StateDigest,
  candidate: C2S,
  index: number,
  recommendedIndex: number,
): number => {
  let score = index === recommendedIndex ? 1 : 0;

  switch (candidate.type) {
    case 'ordnance': {
      const hasNuke = candidate.launches.some(
        (launch) => launch.ordnanceType === 'nuke',
      );
      const hasTorpedo = candidate.launches.some(
        (launch) => launch.ordnanceType === 'torpedo',
      );
      const hasMine = candidate.launches.some(
        (launch) => launch.ordnanceType === 'mine',
      );

      if (hasNuke) {
        // Base caution: one bad nuke can lose tempo and material.
        score -= 10;

        // Strongly avoid opening-turn nukes unless there is point-blank pressure.
        if (input.state.turnNumber <= 2) score -= 12;
        if (digest.ownOperationalShips <= 1) score -= 10;
        if (digest.materialEdge <= 0) score -= 4;

        const nearest = digest.nearestEnemyDistance;
        if (nearest === null || nearest > 2) score -= 8;
        if (nearest !== null && nearest <= 1) score += 8;
        if (digest.materialEdge > 0 && nearest !== null && nearest <= 2) {
          score += 3;
        }
      }

      if (hasTorpedo) {
        const nearest = digest.nearestEnemyDistance;
        if (nearest !== null && nearest <= 3) score += 3;
        if (nearest !== null && nearest > 5) score -= 1;
      }

      if (hasMine) {
        const nearest = digest.nearestEnemyDistance;
        if (nearest !== null && nearest <= 2) score += 2;
      }

      if (memory.style.aggressionBias > memory.style.cautionBias) {
        score += 1;
      }
      break;
    }

    case 'skipOrdnance': {
      const nearest = digest.nearestEnemyDistance;
      if (nearest !== null && nearest <= 2 && digest.materialEdge >= 0)
        score -= 2;
      if (digest.ownOperationalShips <= 1 && input.state.turnNumber <= 2)
        score += 2;
      if (memory.style.cautionBias >= memory.style.aggressionBias) score += 1;
      break;
    }

    case 'combat':
      if (digest.materialEdge >= 0) score += 2;
      if (digest.materialEdge < 0) score -= 1;
      break;

    case 'skipCombat':
      if (digest.materialEdge < 0) score += 2;
      break;

    case 'astrogation': {
      const hasBurn = candidate.orders.some(
        (order) => order.burn !== null || order.overload !== null,
      );
      if (
        !hasBurn &&
        digest.nearestEnemyDistance !== null &&
        digest.nearestEnemyDistance > 4
      ) {
        score -= 1;
      }
      break;
    }

    default:
      break;
  }

  return score;
};

const chooseCandidateIndex = (
  input: AgentTurnInput,
  memory: AgentMemory,
  digest: StateDigest,
): number => {
  const recommendedIndex =
    Number.isInteger(input.recommendedIndex) &&
    input.recommendedIndex >= 0 &&
    input.recommendedIndex < input.candidates.length
      ? input.recommendedIndex
      : 0;

  let bestIndex = recommendedIndex;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < input.candidates.length; index += 1) {
    const score = scoreCandidate(
      input,
      memory,
      digest,
      input.candidates[index],
      index,
      recommendedIndex,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      continue;
    }
    if (score === bestScore && index === recommendedIndex) {
      bestIndex = index;
    }
  }

  const selectedCandidate = input.candidates[bestIndex];
  const recommendedType = getActionType(input.candidates[recommendedIndex]);
  if (
    bestIndex === recommendedIndex &&
    digest.materialEdge < 0 &&
    (recommendedType === 'skipCombat' || recommendedType === 'skipOrdnance') &&
    memory.style.aggressionBias >= memory.style.cautionBias - 1
  ) {
    const aggressiveIndex = input.candidates.findIndex((candidate) =>
      isAggressiveAlternative(candidate),
    );
    if (aggressiveIndex >= 0) return aggressiveIndex;
  }

  if (
    selectedCandidate.type === 'ordnance' &&
    selectedCandidate.launches.some(
      (launch) => launch.ordnanceType === 'nuke',
    ) &&
    input.state.turnNumber <= 2
  ) {
    const saferIndex = input.candidates.findIndex(
      (candidate) =>
        candidate.type === 'skipOrdnance' ||
        (candidate.type === 'ordnance' &&
          candidate.launches.every((launch) => launch.ordnanceType !== 'nuke')),
    );
    if (saferIndex >= 0) return saferIndex;
  }

  if (selectedCandidate.type === 'ordnance' && input.state.turnNumber <= 2) {
    const nearest = digest.nearestEnemyDistance;
    const hasNuke = selectedCandidate.launches.some(
      (launch) => launch.ordnanceType === 'nuke',
    );
    const hasTorpedo = selectedCandidate.launches.some(
      (launch) => launch.ordnanceType === 'torpedo',
    );
    const hasMine = selectedCandidate.launches.some(
      (launch) => launch.ordnanceType === 'mine',
    );

    const avoidEarlyNuke = hasNuke && (nearest === null || nearest > 1);
    const avoidLongTorpedo = hasTorpedo && (nearest === null || nearest > 4);
    const avoidLooseMine = hasMine && (nearest === null || nearest > 2);
    const avoidParityOvercommit =
      digest.ownOperationalShips <= 1 &&
      digest.materialEdge <= 0 &&
      nearest !== null &&
      nearest > 1;

    if (
      avoidEarlyNuke ||
      avoidLongTorpedo ||
      avoidLooseMine ||
      avoidParityOvercommit
    ) {
      const saferIndex = input.candidates.findIndex((candidate) => {
        if (candidate.type === 'skipOrdnance') return true;
        if (candidate.type !== 'ordnance') return false;
        // Prefer lower-risk launches in early turns: no nukes, and bounded geometry.
        const candidateHasNuke = candidate.launches.some(
          (launch) => launch.ordnanceType === 'nuke',
        );
        const candidateHasTorpedo = candidate.launches.some(
          (launch) => launch.ordnanceType === 'torpedo',
        );
        const candidateHasMine = candidate.launches.some(
          (launch) => launch.ordnanceType === 'mine',
        );
        if (candidateHasNuke) return false;
        if (candidateHasTorpedo && (nearest === null || nearest > 4))
          return false;
        if (candidateHasMine && (nearest === null || nearest > 2)) return false;
        return true;
      });
      if (saferIndex >= 0) return saferIndex;
    }
  }

  return bestIndex;
};

const buildChat = (
  input: AgentTurnInput,
  match: MatchMemory,
  digest: StateDigest,
  chosenActionType: string,
): string | undefined => {
  if (
    match.lastChatTurn === input.state.turnNumber &&
    match.lastChatPhase === input.state.phase
  ) {
    return undefined;
  }

  const lines: string[] = [];
  if (input.state.turnNumber === 1 && input.state.phase === 'fleetBuilding') {
    lines.push('Buying for tempo, not comfort.');
  }
  if (input.state.turnNumber === 1 && input.state.phase === 'astrogation') {
    lines.push('Opening burn set. Take the angle.');
  }
  if (chosenActionType === 'ordnance') {
    lines.push('Missiles away. Make them respect the lane.');
  }
  if (chosenActionType === 'combat' && digest.materialEdge >= 0) {
    lines.push('We have the edge. Finish the exchange.');
  }
  if (chosenActionType === 'combat' && digest.materialEdge < 0) {
    lines.push('We are behind. This volley has to matter.');
  }
  if (chosenActionType === 'skipCombat' && digest.materialEdge < 0) {
    lines.push('Bad trade. Reset the geometry.');
  }
  if (input.state.phase === 'astrogation' && digest.materialEdge > 0) {
    lines.push('Stay disciplined. We are already ahead.');
  }
  if (input.state.phase === 'astrogation' && digest.materialEdge < 0) {
    lines.push('No more cheap losses. Better approach this turn.');
  }
  if (
    digest.nearestEnemyDistance !== null &&
    digest.nearestEnemyDistance <= 2 &&
    chosenActionType === 'astrogation'
  ) {
    lines.push('Close burn. Keep the pressure tight.');
  }

  const chat = lines[0]?.trim().slice(0, 100);
  if (!chat) {
    return undefined;
  }

  match.lastChatTurn = input.state.turnNumber;
  match.lastChatPhase = input.state.phase;
  match.recentChats = [
    ...match.recentChats.slice(-(MAX_RECENT_CHATS - 1)),
    chat,
  ];
  return chat;
};

const buildTurnResponse = async (
  config: AgentConfig,
  input: AgentTurnInput,
): Promise<AgentTurnResponse> => {
  const memory = await readMemory(config);
  const match = ensureMatchMemory(memory, input.gameCode, input.playerId);
  const digest = buildStateDigest(input.state, input.playerId);

  learnFromTransition(memory, match, digest);

  const candidateIndex = chooseCandidateIndex(input, memory, digest);
  const chosenActionType = getActionType(input.candidates[candidateIndex]);
  match.observations = [
    ...match.observations.slice(-(MAX_OBSERVATIONS - 1)),
    {
      turnNumber: input.state.turnNumber,
      phase: input.state.phase,
      chosenActionType,
      materialEdge: digest.materialEdge,
      nearestEnemyDistance: digest.nearestEnemyDistance,
    },
  ];
  match.lastDigest = digest;
  match.lastSeenAt = timestamp();

  const response: AgentTurnResponse = {
    candidateIndex,
    chat: buildChat(input, match, digest, chosenActionType),
  };
  await writeMemory(config, memory);
  return response;
};

const findSwingTurn = (
  turnSummaries: TurnSummary[],
  playerId: PlayerId,
  winner: PlayerId | null,
): TurnSummary | null => {
  if (winner === null) {
    return null;
  }

  return (
    turnSummaries.find((summary) => {
      const edge = summary.ownOperationalShips - summary.enemyOperationalShips;
      return winner === playerId ? edge > 0 : edge < 0;
    }) ?? null
  );
};

const describeRecord = (memory: AgentMemory) => ({
  gamesPlayed: memory.gamesPlayed,
  wins: memory.wins,
  losses: memory.losses,
  draws: memory.draws,
  winRate:
    memory.gamesPlayed > 0
      ? Number(((memory.wins / memory.gamesPlayed) * 100).toFixed(1))
      : 0,
});

const finalizeMatch = (
  memory: AgentMemory,
  match: MatchMemory,
  outcome: GameOutcome | null,
  playerId: PlayerId,
): void => {
  if (match.finalizedAt !== null) {
    return;
  }

  memory.gamesPlayed += 1;
  if (!outcome) {
    memory.draws += 1;
  } else if (outcome.winner === playerId) {
    memory.wins += 1;
  } else {
    memory.losses += 1;
  }
  match.finalizedAt = timestamp();
};

const unique = (items: string[]): string[] =>
  items.filter((item, index) => items.indexOf(item) === index);

const buildReportResponse = async (
  config: AgentConfig,
  input: AgentReportInput,
): Promise<AgentReportResponse> => {
  const memory = await readMemory(config);
  const match = ensureMatchMemory(memory, input.gameCode, input.playerId);
  finalizeMatch(memory, match, input.finalState.outcome, input.playerId);

  const winner = input.replaySummary.winner;
  const won = winner === input.playerId;
  const swingTurn = findSwingTurn(input.turnSummaries, input.playerId, winner);
  const finalOwnShips = getOperationalShips(
    input.finalState,
    input.playerId,
  ).length;
  const finalEnemyShips = getOperationalShips(
    input.finalState,
    input.playerId === 0 ? 1 : 0,
  ).length;
  const finalFuelDelta =
    getOperationalShips(input.finalState, input.playerId).reduce(
      (sum, ship) => sum + ship.fuel,
      0,
    ) -
    getOperationalShips(input.finalState, input.playerId === 0 ? 1 : 0).reduce(
      (sum, ship) => sum + ship.fuel,
      0,
    );

  const strengths: string[] = [];
  const mistakes: string[] = [];
  const lessons = unique([
    ...match.lessons.map((lesson) => lesson.note),
    ...memory.recurringLessons.map((lesson) => lesson.note),
  ]).slice(0, 3);
  const nextFocus: string[] = [];

  if (won) {
    strengths.push(
      `Closed the game in ${input.replaySummary.finalTurn ?? '?'} turns with ${finalOwnShips} ship(s) still operational.`,
    );
    if (swingTurn) {
      strengths.push(
        `The decisive material edge showed up on turn ${swingTurn.turnNumber}.`,
      );
    }
    if (finalFuelDelta >= 0) {
      strengths.push('Fuel economy held up at least as well as the opponent.');
    }
    mistakes.push(
      finalEnemyShips === 0
        ? 'Still gave the opponent enough room to force a final exchange.'
        : 'The closing sequence should have denied counterplay earlier.',
    );
    nextFocus.push(
      'Keep converting early advantages without exposing even trades.',
    );
  } else {
    strengths.push(
      `Stayed coherent through ${input.replaySummary.entries} replay checkpoints without protocol failures.`,
    );
    if (swingTurn) {
      strengths.push(
        `The match stayed live until turn ${swingTurn.turnNumber}.`,
      );
    }
    mistakes.push(
      `Finished down ${Math.max(0, finalEnemyShips - finalOwnShips)} operational ship(s).`,
    );
    if (finalFuelDelta < 0) {
      mistakes.push(
        'Spent more fuel than the opponent without getting enough return.',
      );
    }
    nextFocus.push(
      'Protect material first, then force combat only when the angle is favorable.',
    );
  }

  if (lessons.length === 0) {
    lessons.push(
      won
        ? 'The aggressive line worked because it did not cost a hull.'
        : 'Stable heuristics were not enough once the geometry turned against us.',
    );
  }

  if (swingTurn) {
    nextFocus.push(
      `Review the turn-${swingTurn.turnNumber} swing and preserve the better geometry from it.`,
    );
  }

  const reason =
    input.replaySummary.reason ??
    input.finalState.outcome?.reason ??
    'No final reason recorded.';
  const summary = won
    ? `Win as player ${input.playerId} in ${input.replaySummary.finalTurn ?? '?'} turns. ${reason}`
    : `Loss as player ${input.playerId} in ${input.replaySummary.finalTurn ?? '?'} turns. ${reason}`;

  await writeMemory(config, memory);

  return {
    summary,
    recentChats: match.recentChats.slice(-MAX_RECENT_CHATS),
    strengths: strengths.slice(0, 3),
    mistakes: mistakes.slice(0, 3),
    lessons: lessons.slice(0, 3),
    nextFocus: nextFocus.slice(0, 3),
    record: describeRecord(memory),
  };
};

const isReportInput = (value: unknown): value is AgentReportInput =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'report';

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2));
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }

  const raw = chunks.join('').trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  let parsed: AgentTurnInput | AgentReportInput;
  try {
    parsed = JSON.parse(raw) as AgentTurnInput | AgentReportInput;
  } catch {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  if (isReportInput(parsed)) {
    const response = await buildReportResponse(config, parsed);
    process.stdout.write(JSON.stringify(response));
    return;
  }

  const response = await buildTurnResponse(config, parsed);
  process.stdout.write(JSON.stringify(response));
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});
