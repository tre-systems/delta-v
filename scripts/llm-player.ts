import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  type AgentTurnInput,
  type AgentTurnResponse,
  allowedActionTypesForPhase,
  buildActionForDifficulty,
  buildObservation,
  describeCandidate,
} from '../src/shared/agent';
import type { AIDifficulty } from '../src/shared/ai';
import { hexDistance } from '../src/shared/hex';
import { buildSolarSystemMap, SCENARIOS } from '../src/shared/map-data';
import type { GameState, PlayerId } from '../src/shared/types/domain';
import type { C2S, S2C } from '../src/shared/types/protocol';
import {
  parseJsonFromOutput,
  runJsonCommand,
} from './agent-tooling/run-json-command';

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
  exitAfterGameOver: boolean;
  autoChatReplies: boolean;
  verbose: boolean;
}

interface CreateGameResponse {
  code: string;
  playerToken: string;
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
    exitAfterGameOver: !args.includes('--stay-connected-after-gameover'),
    autoChatReplies: !args.includes('--no-auto-chat-replies'),
    verbose: args.includes('--verbose'),
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
  --stay-connected-after-gameover  Keep socket open after game over
  --no-auto-chat-replies  Disable automatic reply messages on incoming chat
  --verbose               Print detailed turn/action logs
  --help                  Show this help
`);
};

const runCommandAgent = async (
  command: string,
  payload: AgentTurnInput,
  timeoutMs: number,
): Promise<AgentTurnResponse> => {
  return await runJsonCommand<AgentTurnResponse>(command, payload, timeoutMs);
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
  reasoning: string;
}

const sanitizeChat = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : undefined;
};

const countOperationalShips = (state: GameState, owner: PlayerId): number =>
  state.ships.filter(
    (ship) => ship.owner === owner && ship.lifecycle !== 'destroyed',
  ).length;

const summarizeAction = (action: C2S): string => {
  switch (action.type) {
    case 'astrogation':
      return `astrogation (${action.orders.length} orders)`;
    case 'ordnance':
      return `ordnance (${action.launches.length} launches)`;
    case 'combat':
      return `combat (${action.attacks.length} attacks)`;
    case 'logistics':
      return `logistics (${action.transfers.length} transfers)`;
    case 'fleetReady':
      return `fleetReady (${action.purchases.length} purchases)`;
    default:
      return action.type;
  }
};

const stateActionKey = (state: GameState, playerId: PlayerId): string =>
  [state.gameId, state.turnNumber, state.phase, playerId].join(':');

const redactToken = (token: string | null): string => {
  if (!token) return '(none)';
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
};

const maskWsUrlToken = (url: string): string =>
  url.replace(/playerToken=([^&]+)/, (_match, token: string) => {
    try {
      return `playerToken=${encodeURIComponent(redactToken(decodeURIComponent(token)))}`;
    } catch {
      return `playerToken=${redactToken(token)}`;
    }
  });

const totalFuel = (state: GameState, owner: PlayerId): number =>
  state.ships
    .filter((ship) => ship.owner === owner && ship.lifecycle !== 'destroyed')
    .reduce((sum, ship) => sum + ship.fuel, 0);

const nearestEnemyDistanceForPlayer = (
  state: GameState,
  playerId: PlayerId,
): number | null => {
  const ownShips = state.ships.filter(
    (ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed',
  );
  const enemyShips = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  );
  let nearest: number | null = null;
  for (const own of ownShips) {
    for (const enemy of enemyShips) {
      const distance = hexDistance(own.position, enemy.position);
      nearest = nearest === null ? distance : Math.min(nearest, distance);
    }
  }
  return nearest;
};

const summarizeTactics = (
  state: GameState,
  playerId: PlayerId,
  action: C2S,
): string => {
  const enemyId: PlayerId = playerId === 0 ? 1 : 0;
  const ownShips = countOperationalShips(state, playerId);
  const enemyShips = countOperationalShips(state, enemyId);
  const ownFuel = totalFuel(state, playerId);
  const enemyFuel = totalFuel(state, enemyId);
  const nearest = nearestEnemyDistanceForPlayer(state, playerId);

  const posture: string[] = [];
  if (ownShips > enemyShips) posture.push('material advantage');
  else if (ownShips < enemyShips) posture.push('material deficit');
  else posture.push('material parity');

  if (ownFuel > enemyFuel + 2) posture.push('fuel edge');
  else if (ownFuel + 2 < enemyFuel) posture.push('fuel deficit');
  else posture.push('fuel parity');

  if (nearest !== null) {
    if (nearest <= 2) posture.push('close engagement range');
    else if (nearest <= 5) posture.push('mid-range geometry');
    else posture.push('long-range approach');
  }

  let intent = 'maintain tempo';
  switch (action.type) {
    case 'astrogation':
      intent = 'shape intercept geometry and future firing lanes';
      break;
    case 'ordnance':
      intent = 'project threat and force opponent pathing';
      break;
    case 'combat':
      intent = 'convert positional pressure into direct damage';
      break;
    case 'logistics':
      intent = 'stabilize fleet endurance and sustain pressure';
      break;
    case 'skipCombat':
      intent = 'avoid a low-value exchange this phase';
      break;
    case 'skipOrdnance':
      intent = 'hold ammunition for a better setup';
      break;
    case 'skipLogistics':
      intent = 'preserve initiative without transfer overhead';
      break;
    case 'fleetReady':
      intent = 'commit opening fleet composition';
      break;
  }

  return `${posture.join(', ')}; intent: ${intent}.`;
};

const buildChatReply = (
  incoming: string,
  _state: GameState | null,
  _playerId: PlayerId,
): string => {
  const normalized = incoming.trim().toLowerCase();
  // Avoid low-signal "copy" ping-pong loops between autonomous agents.
  if (
    normalized === 'copy' ||
    normalized.startsWith('copy.') ||
    normalized.startsWith('copy,')
  ) {
    return '';
  }
  if (normalized.includes('gg')) return 'gg, well played.';
  if (normalized.includes('hello') || normalized.includes('hi'))
    return 'o7 commander.';
  if (normalized.includes('hey')) return 'hey, good luck out there.';
  if (normalized.includes('gl')) return 'gl hf.';
  // Keep autonomous logs readable: tactical messages don't need reflexive
  // acknowledgements from both agents each turn.
  return '';
};

const pickAction = async (
  config: Config,
  gameCode: string,
  playerId: PlayerId,
  state: GameState,
): Promise<PickActionResult> => {
  const map = buildSolarSystemMap();
  const payload: AgentTurnInput = buildObservation(state, playerId, {
    gameCode,
    map,
  });
  const candidates = payload.candidates;
  if (candidates.length === 0) {
    throw new Error(`No candidate actions available for phase ${state.phase}`);
  }
  const recommended = candidates[0];
  if (config.agentMode === 'builtin') {
    const chat = buildBuiltinChat(state, playerId, recommended);
    return {
      action: recommended,
      chat,
      reasoning: `builtin policy selected recommended candidate: ${describeCandidate(recommended, 0)}`,
    };
  }

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
    const selectedAction = candidates[result.candidateIndex];
    const reasoning =
      result.candidateIndex === 0
        ? `agent selected recommended candidate: ${describeCandidate(selectedAction, result.candidateIndex)}`
        : `agent overrode recommendation (0) and selected candidate ${result.candidateIndex}: ${describeCandidate(selectedAction, result.candidateIndex)}`;
    return { action: selectedAction, chat, reasoning };
  }

  if (result.action) {
    return {
      action: result.action,
      chat,
      reasoning: `agent returned custom action: ${summarizeAction(result.action)}`,
    };
  }

  return {
    action: recommended,
    chat,
    reasoning:
      'agent response omitted a valid action; fallback to recommended candidate 0',
  };
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
  let latestState: GameState | null = null;
  let lastAutoReplyAt = 0;
  let lastAutoReplySignature: string | null = null;
  let shutdownRequested = false;
  let shutdownForceTimer: NodeJS.Timeout | null = null;

  const requestShutdown = (): void => {
    if (shutdownRequested || !config.exitAfterGameOver) return;
    shutdownRequested = true;
    setTimeout(() => {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, 'game-over');
      }
    }, 150).unref();
    shutdownForceTimer = setTimeout(() => {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.CLOSING
      ) {
        socket.terminate();
      }
    }, 2_000);
    shutdownForceTimer.unref();
  };

  const send = (message: C2S) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (config.verbose) {
      console.log(`-> ${summarizeAction(message)}`);
    }
    socket.send(JSON.stringify(message));
  };

  const sendForState = (message: C2S, basisState: GameState): boolean => {
    const current = latestState;
    if (!current) return false;
    const isSimultaneousPhase = current.phase === 'fleetBuilding';
    if (!isSimultaneousPhase && current.activePlayer !== playerId) {
      if (config.verbose) {
        console.log(
          `turn ${basisState.turnNumber} ${basisState.phase}: skipped send, no longer our turn`,
        );
      }
      return false;
    }
    if (
      current.phase !== basisState.phase ||
      current.turnNumber !== basisState.turnNumber
    ) {
      if (config.verbose) {
        console.log(
          `turn ${basisState.turnNumber} ${basisState.phase}: skipped send, state advanced to turn ${current.turnNumber} ${current.phase}`,
        );
      }
      return false;
    }

    const allowedTypes = allowedActionTypesForPhase(current.phase);
    if (!allowedTypes.has(message.type)) {
      if (config.verbose) {
        console.log(
          `turn ${basisState.turnNumber} ${basisState.phase}: skipped send, action ${message.type} no longer valid for ${current.phase}`,
        );
      }
      return false;
    }

    // Stamp ActionGuards so the server can reject with a clear reason if the
    // decision raced a phase advance. idempotencyKey is cleared server-side
    // on every state change, so reusing a turn+phase+uuid is safe.
    const guarded: C2S = {
      ...message,
      guards: {
        expectedTurn: current.turnNumber,
        expectedPhase: current.phase,
        idempotencyKey: `t${current.turnNumber}-${current.phase}-${randomUUID()}`,
      },
    };
    send(guarded);
    return true;
  };

  const tryAgentDecisionForState = async (
    basis: GameState,
    reason: string,
  ): Promise<boolean> => {
    if (playerId === -1) return false;
    const actorId: PlayerId = playerId;
    if (basis.phase === 'gameOver') return false;
    const isSimultaneousPhase = basis.phase === 'fleetBuilding';
    if (!isSimultaneousPhase && basis.activePlayer !== actorId) return false;

    const { action, chat, reasoning } = await pickAction(
      config,
      gameCode,
      actorId,
      basis,
    );
    if (config.verbose) {
      console.log(
        `turn ${basis.turnNumber} ${basis.phase}: re-deciding after ${reason}, selected ${summarizeAction(action)}`,
      );
      console.log(
        `turn ${basis.turnNumber} ${basis.phase}: re-decide reasoning ${reasoning}`,
      );
    }
    if (chat) {
      console.log(`chat sent: "${chat}"`);
      send({ type: 'chat', text: chat });
      await delay(100);
    }
    return sendForState(action, basis);
  };

  const scheduleAction = async (state: GameState): Promise<void> => {
    if (playerId === -1) return;
    if (state.phase === 'gameOver') return;
    if (actionInFlight) return;
    const isSimultaneousPhase = state.phase === 'fleetBuilding';
    if (!isSimultaneousPhase && state.activePlayer !== playerId) return;

    const actionKey = stateActionKey(state, playerId);
    if (actionKeys.has(actionKey)) return;
    actionKeys.add(actionKey);

    actionInFlight = true;
    try {
      if (state.turnNumber === 1 && state.phase === 'astrogation') {
        // Let the opening phase settle so we don't race an immediate
        // astrogation->ordnance transition and submit stale first actions.
        await delay(120);
        const settled = latestState;
        if (
          settled &&
          (settled.turnNumber !== state.turnNumber ||
            settled.phase !== state.phase)
        ) {
          if (config.verbose) {
            console.log(
              `turn ${state.turnNumber} ${state.phase}: phase settled to turn ${settled.turnNumber} ${settled.phase}, skipping opening action`,
            );
          }
          return;
        }
      }
      await delay(config.thinkMs);
      const latestKey =
        latestState === null
          ? actionKey
          : stateActionKey(latestState, playerId);
      if (latestKey !== actionKey) {
        if (config.verbose) {
          console.log(
            `turn ${state.turnNumber} ${state.phase}: skipping stale decision (latest=${latestKey})`,
          );
        }
        return;
      }
      const { action, chat, reasoning } = await pickAction(
        config,
        gameCode,
        playerId,
        state,
      );
      if (config.verbose) {
        console.log(
          `turn ${state.turnNumber} ${state.phase}: selected ${summarizeAction(action)}`,
        );
        console.log(
          `turn ${state.turnNumber} ${state.phase}: reasoning ${reasoning}`,
        );
        console.log(
          `turn ${state.turnNumber} ${state.phase}: tactics ${summarizeTactics(state, playerId, action)}`,
        );
      }
      if (chat) {
        console.log(`chat sent: "${chat}"`);
        send({ type: 'chat', text: chat });
        await delay(100);
      }
      if (!sendForState(action, state)) {
        console.warn(
          `agent action "${action.type}" was stale or invalid for current phase, falling back`,
        );
        const basis = latestState ?? state;
        let recovered = false;
        if (
          basis.turnNumber !== state.turnNumber ||
          basis.phase !== state.phase
        ) {
          try {
            recovered = await tryAgentDecisionForState(basis, 'state advance');
          } catch (recoveryError) {
            console.warn(
              'agent re-decision failed after state advance:',
              recoveryError,
            );
          }
        }
        if (recovered) return;
        const fallback = buildActionForDifficulty(
          basis,
          playerId,
          config.difficulty,
        );
        if (fallback) {
          void sendForState(fallback, basis);
        }
      }
    } catch (error) {
      console.warn(
        `agent decision failed, falling back to ${config.difficulty} policy:`,
        error,
      );
      const basis = latestState ?? state;
      const fallback = buildActionForDifficulty(
        basis,
        playerId,
        config.difficulty,
      );
      if (fallback) void sendForState(fallback, basis);
    } finally {
      actionInFlight = false;
      if (
        latestState &&
        stateActionKey(latestState, playerId) !== actionKey &&
        latestState.phase !== 'gameOver'
      ) {
        void scheduleAction(latestState);
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      console.log(`connected to ${maskWsUrlToken(wsUrl)}`);
    });

    socket.once('error', (error) => {
      reject(error);
    });

    socket.on('close', (code, reason) => {
      if (shutdownForceTimer) {
        clearTimeout(shutdownForceTimer);
        shutdownForceTimer = null;
      }
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
              `reconnect token available (use with --player-token): ${redactToken(token)}`,
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
        case 'stateUpdate': {
          latestState = message.state;
          if (config.verbose && playerId !== -1) {
            const own = countOperationalShips(message.state, playerId);
            const enemy = countOperationalShips(
              message.state,
              playerId === 0 ? 1 : 0,
            );
            console.log(
              `<- ${message.type}: turn=${message.state.turnNumber} phase=${message.state.phase} active=${message.state.activePlayer} ships you=${own} enemy=${enemy}`,
            );
          }
          void scheduleAction(message.state);
          if (message.state.phase === 'gameOver') {
            const winner = message.state.outcome?.winner;
            const reason = message.state.outcome?.reason ?? 'unknown';
            console.log(
              `game over: winner=${winner ?? 'draw'} reason=${reason}`,
            );
            if (playerId !== -1) {
              const outcomeLabel =
                winner === null || winner === undefined
                  ? 'DRAW'
                  : winner === playerId
                    ? 'WIN'
                    : 'LOSS';
              console.log(
                `result: ${outcomeLabel} (you are player ${playerId})`,
              );
            }
            requestShutdown();
          }
          return;
        }
        case 'gameOver':
          console.log(`game over (message): winner=${message.winner}`);
          if (playerId !== -1) {
            const outcomeLabel = message.winner === playerId ? 'WIN' : 'LOSS';
            console.log(`result: ${outcomeLabel} (you are player ${playerId})`);
          }
          requestShutdown();
          return;
        case 'error':
          console.error(
            `server error${message.code ? ` (${message.code})` : ''}: ${message.message}`,
          );
          return;
        case 'actionRejected': {
          console.warn(
            `action rejected (${message.reason}): ${message.message}`,
          );
          // The server sends its fresh state with the rejection so we can
          // re-decide without another round-trip. Refresh latestState,
          // discard the stale action-key for this seat, and re-schedule.
          latestState = message.state;
          actionKeys.clear();
          void scheduleAction(message.state);
          return;
        }
        case 'chat':
          console.log(`chat received p${message.playerId}: "${message.text}"`);
          if (
            config.autoChatReplies &&
            playerId !== -1 &&
            message.playerId !== playerId
          ) {
            const now = Date.now();
            const signature = `${message.playerId}:${message.text.trim().toLowerCase()}`;
            const shouldReply =
              signature !== lastAutoReplySignature ||
              now - lastAutoReplyAt > 8_000;
            if (shouldReply) {
              const reply = buildChatReply(message.text, latestState, playerId);
              if (reply.trim().length > 0) {
                console.log(`chat sent: "${reply}"`);
                send({ type: 'chat', text: reply.slice(0, 200) });
                lastAutoReplyAt = now;
                lastAutoReplySignature = signature;
              }
            }
          }
          return;
        case 'rematchPending':
          if (config.verbose) {
            console.log('<- rematch pending');
          }
          return;
        case 'pong':
          if (config.verbose) {
            console.log('<- pong');
          }
          return;
        case 'opponentStatus':
          if (config.verbose) {
            console.log(`<- opponent ${message.status}`);
          }
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
