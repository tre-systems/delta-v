import { spawn } from 'node:child_process';
import WebSocket from 'ws';

import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIFleetPurchases,
} from '../src/shared/ai';
import { SHIP_STATS } from '../src/shared/constants';
import type { HexCoord, HexVec } from '../src/shared/hex';
import { hexDistance } from '../src/shared/hex';
import { buildSolarSystemMap, SCENARIOS } from '../src/shared/map-data';
import type {
  AstrogationOrder,
  CelestialBody,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../src/shared/types/domain';
import type { C2S, S2C } from '../src/shared/types/protocol';

const DEFAULT_SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8787';
const DEFAULT_SCENARIO = 'duel';

type AgentMode = 'builtin' | 'command' | 'http';
type SessionMode = 'create' | 'join';

interface Config {
  serverUrl: string;
  sessionMode: SessionMode;
  scenario: string;
  code?: string;
  playerToken?: string;
  agentMode: AgentMode;
  agentCommand?: string;
  agentUrl?: string;
  difficulty: AIDifficulty;
  thinkMs: number;
  decisionTimeoutMs: number;
}

interface CreateGameResponse {
  code: string;
  playerToken: string;
}

interface LegalActionShipInfo {
  id: string;
  type: string;
  position: { q: number; r: number };
  velocity: { dq: number; dr: number };
  fuel: number;
  lifecycle: string;
  canBurn: boolean;
  canOverload: boolean;
  canAttack: boolean;
  canLaunchOrdnance: boolean;
  cargoUsed: number;
  cargoCapacity: number;
  disabledTurns: number;
}

interface LegalActionEnemyInfo {
  id: string;
  type: string;
  position: { q: number; r: number };
  velocity: { dq: number; dr: number };
  lifecycle: string;
  detected: boolean;
}

interface LegalActionInfo {
  phase: string;
  allowedTypes: string[];
  burnDirections: string[];
  ownShips: LegalActionShipInfo[];
  enemies: LegalActionEnemyInfo[];
}

interface AgentTurnInput {
  version: 1;
  gameCode: string;
  playerId: PlayerId;
  state: GameState;
  candidates: C2S[];
  recommendedIndex: number;
  summary?: string;
  legalActionInfo?: LegalActionInfo;
}

interface AgentTurnResponse {
  candidateIndex?: number;
  action?: C2S;
  chat?: string;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const parseIntegerFlag = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseArgs = (argv: string[]): Config => {
  const args = [...argv];
  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;

    return args[index + 1];
  };

  if (args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const sessionModeRaw = getFlag('--mode') ?? 'create';
  if (sessionModeRaw !== 'create' && sessionModeRaw !== 'join') {
    throw new Error(`Unknown --mode value: ${sessionModeRaw}`);
  }

  const scenario = getFlag('--scenario') ?? DEFAULT_SCENARIO;
  if (!(scenario in SCENARIOS)) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  const agentModeRaw = getFlag('--agent') ?? 'builtin';
  if (
    agentModeRaw !== 'builtin' &&
    agentModeRaw !== 'command' &&
    agentModeRaw !== 'http'
  ) {
    throw new Error(`Unknown --agent value: ${agentModeRaw}`);
  }

  const difficultyRaw = getFlag('--difficulty') ?? 'hard';
  if (
    difficultyRaw !== 'easy' &&
    difficultyRaw !== 'normal' &&
    difficultyRaw !== 'hard'
  ) {
    throw new Error(`Unknown difficulty: ${difficultyRaw}`);
  }

  const code = getFlag('--code');
  if (sessionModeRaw === 'join' && !code) {
    throw new Error('--code is required when --mode join');
  }

  const agentCommand = getFlag('--agent-command');
  if (agentModeRaw === 'command' && !agentCommand) {
    throw new Error('--agent-command is required when --agent command');
  }

  const agentUrl = getFlag('--agent-url');
  if (agentModeRaw === 'http' && !agentUrl) {
    throw new Error('--agent-url is required when --agent http');
  }

  return {
    serverUrl: getFlag('--server-url') ?? DEFAULT_SERVER_URL,
    sessionMode: sessionModeRaw,
    scenario,
    code: code ?? undefined,
    playerToken: getFlag('--player-token') ?? undefined,
    agentMode: agentModeRaw,
    agentCommand: agentCommand ?? undefined,
    agentUrl: agentUrl ?? undefined,
    difficulty: difficultyRaw,
    thinkMs: Math.max(0, parseIntegerFlag(getFlag('--think-ms'), 200)),
    decisionTimeoutMs: Math.max(
      1_000,
      parseIntegerFlag(getFlag('--decision-timeout-ms'), 30_000),
    ),
  };
};

const printUsage = (): void => {
  console.log(`Delta-V LLM player bridge

Examples:
  # LLM/agent hosts game; browser joins with printed code
  npm run llm:player -- --mode create --scenario duel --agent command --agent-command "python ./tools/my_agent.py"

  # LLM/agent joins an existing room
  npm run llm:player -- --mode join --code ABCDE --agent http --agent-url http://127.0.0.1:8080/turn

  # Built-in baseline strategy (no external model)
  npm run llm:player -- --mode create --scenario biplanetary --agent builtin

Agent I/O contract:
  Input (stdin or HTTP POST body): JSON { version, gameCode, playerId, state, candidates, recommendedIndex }
  Output: JSON { candidateIndex } OR { action }

Flags:
  --server-url            Worker base URL (default: ${DEFAULT_SERVER_URL})
  --mode                  create | join (default: create)
  --scenario              Scenario key for create mode (default: ${DEFAULT_SCENARIO})
  --code                  Join code for join mode
  --player-token          Optional reconnect token for join mode
  --agent                 builtin | command | http (default: builtin)
  --agent-command         Shell command used in command mode
  --agent-url             URL used in http mode
  --difficulty            easy | normal | hard fallback policy (default: hard)
  --think-ms              Delay before acting (default: 200)
  --decision-timeout-ms   Agent timeout per turn (default: 30000)
  --help                  Show this help
`);
};

const buildIdleAstrogationOrders = (
  state: GameState,
  playerId: PlayerId,
): AstrogationOrder[] =>
  state.ships
    .filter((ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed')
    .map((ship) => ({
      shipId: ship.id,
      burn: null,
      overload: null,
    }));

const hasOwnedPendingAsteroidHazards = (
  state: GameState,
  playerId: PlayerId,
): boolean =>
  state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );
    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });

const buildActionForDifficulty = (
  state: GameState,
  playerId: PlayerId,
  difficulty: AIDifficulty,
): C2S | null => {
  const map = buildSolarSystemMap();
  switch (state.phase) {
    case 'waiting':
      return null;
    case 'fleetBuilding':
      return {
        type: 'fleetReady',
        purchases: buildAIFleetPurchases(state, playerId, difficulty),
      };
    case 'astrogation': {
      const orders = aiAstrogation(state, playerId, map, difficulty);
      return {
        type: 'astrogation',
        orders:
          orders.length > 0
            ? orders
            : buildIdleAstrogationOrders(state, playerId),
      };
    }
    case 'ordnance': {
      const launches = aiOrdnance(state, playerId, map, difficulty);
      if (launches.length > 0) return { type: 'ordnance', launches };

      return { type: 'skipOrdnance' };
    }
    case 'combat': {
      if (hasOwnedPendingAsteroidHazards(state, playerId)) {
        return { type: 'beginCombat' };
      }
      const attacks = aiCombat(state, playerId, map, difficulty);
      if (attacks.length > 0) return { type: 'combat', attacks };

      return { type: 'skipCombat' };
    }
    case 'logistics': {
      const transfers = aiLogistics(state, playerId, map, difficulty);
      if (transfers.length > 0) return { type: 'logistics', transfers };

      return { type: 'skipLogistics' };
    }
    case 'gameOver':
      return null;
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`Unhandled phase: ${_exhaustive}`);
    }
  }
};

const allowedActionTypesForPhase = (
  phase: GameState['phase'],
): Set<C2S['type']> => {
  switch (phase) {
    case 'waiting':
      return new Set();
    case 'fleetBuilding':
      return new Set(['fleetReady']);
    case 'astrogation':
      return new Set(['astrogation', 'surrender']);
    case 'ordnance':
      return new Set(['ordnance', 'skipOrdnance', 'emplaceBase']);
    case 'combat':
      return new Set(['beginCombat', 'combat', 'skipCombat']);
    case 'logistics':
      return new Set(['logistics', 'skipLogistics']);
    case 'gameOver':
      return new Set(['rematch']);
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled phase: ${_exhaustive}`);
    }
  }
};

const dedupeCandidates = (candidates: C2S[]): C2S[] => {
  const seen = new Set<string>();
  const result: C2S[] = [];
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
};

const buildCandidates = (state: GameState, playerId: PlayerId): C2S[] => {
  const seedCandidates: C2S[] = [];
  for (const difficulty of ['hard', 'normal', 'easy'] as const) {
    const action = buildActionForDifficulty(state, playerId, difficulty);
    if (action) seedCandidates.push(action);
  }

  if (state.phase === 'ordnance') seedCandidates.push({ type: 'skipOrdnance' });
  if (state.phase === 'combat') seedCandidates.push({ type: 'skipCombat' });
  if (state.phase === 'logistics')
    seedCandidates.push({ type: 'skipLogistics' });

  return dedupeCandidates(seedCandidates);
};

const parseJsonFromOutput = <T>(content: string): T => {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('empty output');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lines = trimmed.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const candidate = lines[i].trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // keep scanning for a valid JSON line
      }
    }
    throw new Error('output did not contain valid JSON');
  }
};

const runCommandAgent = async (
  command: string,
  payload: AgentTurnInput,
  timeoutMs: number,
): Promise<AgentTurnResponse> => {
  return await new Promise<AgentTurnResponse>((resolve, reject) => {
    const child = spawn('zsh', ['-lc', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timeout = setTimeout(() => {
      settle(() => {
        child.kill('SIGKILL');
        reject(new Error(`agent command timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      settle(() => reject(error));
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      settle(() => {
        if (code !== 0) {
          reject(
            new Error(
              `agent command exited with code ${code}. stderr: ${stderr.trim() || '(none)'}`,
            ),
          );
          return;
        }

        try {
          resolve(parseJsonFromOutput<AgentTurnResponse>(stdout));
        } catch (error) {
          reject(
            new Error(
              `failed to parse agent response JSON: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
};

const runHttpAgent = async (
  url: string,
  payload: AgentTurnInput,
  timeoutMs: number,
): Promise<AgentTurnResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawBody = await response.text();
    return parseJsonFromOutput<AgentTurnResponse>(rawBody);
  } finally {
    clearTimeout(timeout);
  }
};

const DIRECTION_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const;

const nearestBody = (
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

const describePosition = (pos: HexCoord, bodies: CelestialBody[]): string => {
  const closest = nearestBody(pos, bodies);
  if (closest.distance === 0) return `on ${closest.name}`;
  if (closest.distance <= 3)
    return `${closest.distance} hex from ${closest.name}`;
  return `at (${pos.q},${pos.r}), ${closest.distance} hex from ${closest.name}`;
};

const describeVelocity = (vel: HexVec): string => {
  const speed = Math.max(
    Math.abs(vel.dq),
    Math.abs(vel.dr),
    Math.abs(vel.dq + vel.dr),
  );
  return speed === 0 ? 'stationary' : `speed ${speed}`;
};

const describeShip = (ship: Ship, bodies: CelestialBody[]): string => {
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

const describeCandidate = (action: C2S, index: number): string => {
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

const buildStateSummary = (
  state: GameState,
  playerId: PlayerId,
  candidates: C2S[],
  map: SolarSystemMap,
): string => {
  const lines: string[] = [];
  const bodies = map.bodies;
  const player = state.players[playerId];
  const opponentId = playerId === 0 ? 1 : 0;

  lines.push(`Turn ${state.turnNumber}, Phase: ${state.phase}`);
  lines.push(
    `Active player: ${state.activePlayer === playerId ? 'YOU' : 'opponent'}`,
  );
  lines.push(`Objective: target=${player.targetBody}, home=${player.homeBody}`);

  lines.push('');
  lines.push('YOUR SHIPS:');
  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    lines.push(`  ${describeShip(ship, bodies)}`);
  }

  lines.push('');
  lines.push('ENEMY SHIPS:');
  for (const ship of state.ships) {
    if (ship.owner !== opponentId) continue;
    const visibility = ship.detected ? '' : ' (undetected)';
    lines.push(`  ${describeShip(ship, bodies)}${visibility}`);
  }

  if (state.ordnance.length > 0) {
    lines.push('');
    lines.push('ORDNANCE:');
    for (const ord of state.ordnance) {
      if (ord.lifecycle === 'destroyed') continue;
      const owner = ord.owner === playerId ? 'yours' : 'enemy';
      lines.push(
        `  ${ord.type} (${owner}), ${describePosition(ord.position, bodies)}, ${ord.turnsRemaining}T left`,
      );
    }
  }

  lines.push('');
  lines.push('CANDIDATES:');
  for (let i = 0; i < candidates.length; i++) {
    lines.push(`  ${describeCandidate(candidates[i], i)}`);
  }

  return lines.join('\n');
};

const buildLegalActionInfo = (
  state: GameState,
  playerId: PlayerId,
): LegalActionInfo => {
  const opponentId = playerId === 0 ? 1 : 0;
  const allowedTypes = [...allowedActionTypesForPhase(state.phase)];

  const ownShips: LegalActionShipInfo[] = state.ships
    .filter((s) => s.owner === playerId && s.lifecycle !== 'destroyed')
    .map((s) => {
      const stats = SHIP_STATS[s.type];
      const isActive = s.lifecycle === 'active';
      const isOperational =
        s.damage.disabledTurns === 0 ||
        stats.operatesAtD1 ||
        stats.operatesWhileDisabled;
      return {
        id: s.id,
        type: s.type,
        position: { q: s.position.q, r: s.position.r },
        velocity: { dq: s.velocity.dq, dr: s.velocity.dr },
        fuel: s.fuel,
        lifecycle: s.lifecycle,
        canBurn: isActive && s.fuel > 0,
        canOverload:
          isActive && stats.canOverload && !s.overloadUsed && s.fuel >= 2,
        canAttack:
          isActive &&
          isOperational &&
          !stats.defensiveOnly &&
          !s.resuppliedThisTurn,
        canLaunchOrdnance:
          isActive &&
          isOperational &&
          !s.resuppliedThisTurn &&
          s.cargoUsed < stats.cargo,
        cargoUsed: s.cargoUsed,
        cargoCapacity: stats.cargo === Infinity ? -1 : stats.cargo,
        disabledTurns: s.damage.disabledTurns,
      };
    });

  const enemies: LegalActionEnemyInfo[] = state.ships
    .filter((s) => s.owner === opponentId && s.lifecycle !== 'destroyed')
    .map((s) => ({
      id: s.id,
      type: s.type,
      position: { q: s.position.q, r: s.position.r },
      velocity: { dq: s.velocity.dq, dr: s.velocity.dr },
      lifecycle: s.lifecycle,
      detected: s.detected,
    }));

  return {
    phase: state.phase,
    allowedTypes,
    burnDirections: [...DIRECTION_NAMES],
    ownShips,
    enemies,
  };
};

const pickRandom = <T>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const maybeChat = (probability: number, lines: string[]): string | undefined =>
  Math.random() < probability ? pickRandom(lines) : undefined;

const buildBuiltinChat = (
  _state: GameState,
  _playerId: PlayerId,
  action: C2S,
): string | undefined => {
  switch (action.type) {
    case 'combat':
      return maybeChat(0.4, [
        'Engaging hostiles!',
        'Weapons free!',
        'Opening fire!',
        'Locked on target!',
      ]);
    case 'ordnance': {
      const ordType = action.launches[0]?.ordnanceType;
      if (ordType === 'torpedo')
        return maybeChat(0.4, ['Torpedo away!', 'Fox one!']);
      if (ordType === 'nuke')
        return maybeChat(0.4, ['Deploying nuke!', 'Going nuclear!']);
      if (ordType === 'mine')
        return maybeChat(0.4, ['Mine deployed.', 'Surprise package.']);
      return undefined;
    }
    case 'astrogation': {
      const hasOverload = action.orders.some((o) => o.overload !== null);
      if (hasOverload)
        return maybeChat(0.4, ['Full power!', 'Pushing the engines!']);
      return maybeChat(0.15, [
        "You can't outrun me.",
        'Closing the distance.',
        'I have you now.',
      ]);
    }
    case 'skipCombat':
    case 'skipOrdnance':
    case 'skipLogistics':
      return maybeChat(0.1, ['Holding fire.', 'Standing by.']);
    default:
      return undefined;
  }
};

interface PickActionResult {
  action: C2S;
  chat?: string;
}

const sanitizeChat = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : undefined;
};

const pickAction = async (
  config: Config,
  gameCode: string,
  playerId: PlayerId,
  state: GameState,
): Promise<PickActionResult> => {
  const map = buildSolarSystemMap();
  const candidates = buildCandidates(state, playerId);
  if (candidates.length === 0) {
    throw new Error(`No candidate actions available for phase ${state.phase}`);
  }
  const recommended = candidates[0];
  if (config.agentMode === 'builtin') {
    const chat = buildBuiltinChat(state, playerId, recommended);
    return { action: recommended, chat };
  }

  const payload: AgentTurnInput = {
    version: 1,
    gameCode,
    playerId,
    state,
    candidates,
    recommendedIndex: 0,
    summary: buildStateSummary(state, playerId, candidates, map),
    legalActionInfo: buildLegalActionInfo(state, playerId),
  };

  let result: AgentTurnResponse;
  if (config.agentMode === 'command') {
    result = await runCommandAgent(
      config.agentCommand as string,
      payload,
      config.decisionTimeoutMs,
    );
  } else {
    result = await runHttpAgent(
      config.agentUrl as string,
      payload,
      config.decisionTimeoutMs,
    );
  }

  const chat = sanitizeChat(result.chat);

  if (
    typeof result.candidateIndex === 'number' &&
    Number.isInteger(result.candidateIndex) &&
    result.candidateIndex >= 0 &&
    result.candidateIndex < candidates.length
  ) {
    return { action: candidates[result.candidateIndex], chat };
  }

  if (result.action) {
    return { action: result.action, chat };
  }

  return { action: recommended, chat };
};

const createGame = async (config: Config): Promise<CreateGameResponse> => {
  const response = await fetch(`${config.serverUrl}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: config.scenario }),
  });
  if (!response.ok) {
    throw new Error(`create failed: HTTP ${response.status}`);
  }

  return (await response.json()) as CreateGameResponse;
};

const run = async (config: Config): Promise<void> => {
  let gameCode = config.code ?? '';
  let token = config.playerToken ?? null;
  if (config.sessionMode === 'create') {
    const created = await createGame(config);
    gameCode = created.code;
    token = created.playerToken;
    console.log(`created game code: ${gameCode}`);
    console.log(
      `share this URL with opponent: ${config.serverUrl}/?code=${gameCode}`,
    );
  }

  if (!gameCode) {
    throw new Error('Missing game code');
  }

  const tokenQuery = token ? `?playerToken=${encodeURIComponent(token)}` : '';
  const wsUrl = `${config.serverUrl.replace(/^http/, 'ws')}/ws/${gameCode}${tokenQuery}`;
  const socket = new WebSocket(wsUrl);

  let playerId: PlayerId | -1 = -1;
  const actionKeys = new Set<string>();
  let actionInFlight = false;

  const send = (message: C2S) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  const scheduleAction = async (state: GameState): Promise<void> => {
    if (playerId === -1) return;
    if (state.phase === 'gameOver') return;
    if (actionInFlight) return;
    const isSimultaneousPhase = state.phase === 'fleetBuilding';
    if (!isSimultaneousPhase && state.activePlayer !== playerId) return;

    const actionKey = [
      state.gameId,
      state.turnNumber,
      state.phase,
      playerId,
    ].join(':');
    if (actionKeys.has(actionKey)) return;
    actionKeys.add(actionKey);

    actionInFlight = true;
    try {
      await delay(config.thinkMs);
      const { action, chat } = await pickAction(
        config,
        gameCode,
        playerId,
        state,
      );
      if (chat) {
        send({ type: 'chat', text: chat });
        await delay(100);
      }
      const allowedTypes = allowedActionTypesForPhase(state.phase);
      if (!allowedTypes.has(action.type)) {
        console.warn(
          `agent returned invalid action type "${action.type}" for phase "${state.phase}", falling back`,
        );
        const fallback = buildActionForDifficulty(
          state,
          playerId,
          config.difficulty,
        );
        if (fallback && allowedTypes.has(fallback.type)) {
          send(fallback);
        }
      } else {
        send(action);
      }
    } catch (error) {
      console.warn(
        `agent decision failed, falling back to ${config.difficulty} policy:`,
        error,
      );
      const fallback = buildActionForDifficulty(
        state,
        playerId,
        config.difficulty,
      );
      if (fallback) send(fallback);
    } finally {
      actionInFlight = false;
    }
  };

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      console.log(`connected to ${wsUrl}`);
    });

    socket.once('error', (error) => {
      reject(error);
    });

    socket.on('close', (code, reason) => {
      console.log(
        `socket closed (${code}): ${reason.toString() || 'no reason'}`,
      );
      resolve();
    });

    socket.on('message', (raw) => {
      let message: S2C;
      try {
        message = JSON.parse(raw.toString()) as S2C;
      } catch (error) {
        console.error('invalid server payload:', error);
        return;
      }

      switch (message.type) {
        case 'welcome':
          playerId = message.playerId;
          token = message.playerToken;
          console.log(
            `seat assigned: player ${playerId}, code ${message.code}`,
          );
          if (token) {
            console.log(
              `reconnect token available (use with --player-token): ${token}`,
            );
          }
          return;
        case 'spectatorWelcome':
          console.log(`connected as spectator to ${message.code}`);
          return;
        case 'matchFound':
          console.log('match found');
          return;
        case 'gameStart':
        case 'movementResult':
        case 'combatResult':
        case 'stateUpdate':
          void scheduleAction(message.state);
          if (message.state.phase === 'gameOver') {
            console.log(
              `game over: winner=${message.state.outcome?.winner ?? 'draw'} reason=${message.state.outcome?.reason ?? 'unknown'}`,
            );
          }
          return;
        case 'gameOver':
          console.log(`game over (message): winner=${message.winner}`);
          return;
        case 'error':
          console.error(
            `server error${message.code ? ` (${message.code})` : ''}: ${message.message}`,
          );
          return;
        case 'chat':
        case 'rematchPending':
        case 'pong':
        case 'opponentStatus':
          return;
      }
    });
  });
};

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2));
  await run(config);
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
