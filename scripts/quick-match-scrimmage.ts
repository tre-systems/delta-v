import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  type QuickMatchResult,
  queueForMatch,
  requireMatchedQuickMatch,
} from '../src/shared/agent';
import { hexDistance } from '../src/shared/hex';
import type { ReplayTimeline } from '../src/shared/replay';
import type { GameState, PlayerId, Ship } from '../src/shared/types/domain';
import { runJsonCommand } from './agent-tooling/run-json-command';

const DEFAULT_SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8787';
const DEFAULT_SCENARIO = 'duel';
const DEFAULT_AGENT_COMMAND_BASE = 'npm run llm:agent:coach --silent --';

interface Config {
  serverUrl: string;
  scenario: string;
  agentCommandBase: string;
  thinkMs: number;
  decisionTimeoutMs: number;
  reportTimeoutMs: number;
  pollMs: number;
  shutdownGraceMs: number;
  labelA: string;
  labelB: string;
  live: boolean;
  jsonOutPath: string | null;
  /** Use `scrim_…` keys + human quick-match path instead of default `agent_…` + Bearer. */
  humanQuickMatchKeys: boolean;
}

interface QueuePlayer {
  label: string;
  profile: string;
  username: string;
  playerKey: string;
  agentCommand: string;
  ticket: string | null;
  matched: Extract<QuickMatchResult, { status: 'matched' }> | null;
  playerId: PlayerId | null;
  logs: string[];
}

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

interface PlayerRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface PlayerRunMetrics {
  chatSent: string[];
  chatReceived: string[];
  actionRejectedCount: number;
  ordnanceMix: {
    nuke: number;
    torpedo: number;
    mine: number;
  };
}

interface ScrimmageExportPlayer {
  label: string;
  profile: string;
  playerId: PlayerId;
  report: AgentReportResponse;
  metrics: PlayerRunMetrics;
}

interface ScrimmageExport {
  timestamp: string;
  serverUrl: string;
  scenario: string;
  roomCode: string;
  gameId: string;
  winner: PlayerId | null;
  reason: string | null;
  turns: number | null;
  replayEntries: number;
  phaseCounts: Record<string, number>;
  /** How many times quick-match split the two seats across rooms before a shared room succeeded (0 = first pairing matched). */
  quickMatchPairingSplitRetries: number;
  players: ScrimmageExportPlayer[];
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const parseIntegerFlag = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const SCRIMMAGE_VALUE_FLAGS = new Set([
  '--server-url',
  '--scenario',
  '--agent-command-base',
  '--think-ms',
  '--decision-timeout-ms',
  '--report-timeout-ms',
  '--poll-ms',
  '--shutdown-grace-ms',
  '--label-a',
  '--label-b',
  '--json-out',
]);

const SCRIMMAGE_BOOL_FLAGS = new Set([
  '--live',
  '--help',
  '--human-quick-match-keys',
]);

const findUnknownScrimmageFlags = (argv: string[]): string[] => {
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--')) continue;
    if (SCRIMMAGE_BOOL_FLAGS.has(token)) continue;
    if (SCRIMMAGE_VALUE_FLAGS.has(token)) {
      i++;
      continue;
    }
    unknown.push(token);
  }
  return unknown;
};

const parseArgs = (argv: string[]): Config => {
  const args = [...argv];
  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  if (args.includes('--help')) {
    console.log(`Quick-match scrimmage runner

Examples:
  npm run quickmatch:scrimmage
  npm run quickmatch:scrimmage -- --server-url https://delta-v.tre.systems

Flags:
  --server-url             Worker base URL (default: ${DEFAULT_SERVER_URL})
  --scenario               Queue scenario (default: ${DEFAULT_SCENARIO})
  --agent-command-base     Command prefix for the coach agent
  --think-ms               Delay before each move (default: 150)
  --decision-timeout-ms    Decision timeout for llm-player (default: 30000)
  --report-timeout-ms      Timeout for post-game reports (default: 15000)
  --poll-ms                Queue/replay poll interval (default: 500)
  --shutdown-grace-ms      Wait after game over before stopping clients (default: 1200)
  --label-a                Display label for player A (default: Comet)
  --label-b                Display label for player B (default: Kepler)
  --live                   Stream concise per-turn/chat/result updates
  --json-out               Write structured JSON summary to file
  --human-quick-match-keys Use scrim_* playerKeys (human queue path). Default is agent_* + /api/agent-token (production-like).
`);
    process.exit(0);
  }

  const unknownFlags = findUnknownScrimmageFlags(args);
  if (unknownFlags.length > 0) {
    console.error(
      `Unknown flag(s): ${unknownFlags.join(', ')}\nRun with --help for supported options.`,
    );
    process.exit(1);
  }

  return {
    serverUrl: getFlag('--server-url') ?? DEFAULT_SERVER_URL,
    scenario: getFlag('--scenario') ?? DEFAULT_SCENARIO,
    agentCommandBase:
      getFlag('--agent-command-base') ?? DEFAULT_AGENT_COMMAND_BASE,
    thinkMs: Math.max(0, parseIntegerFlag(getFlag('--think-ms'), 150)),
    decisionTimeoutMs: Math.max(
      1_000,
      parseIntegerFlag(getFlag('--decision-timeout-ms'), 30_000),
    ),
    reportTimeoutMs: Math.max(
      1_000,
      parseIntegerFlag(getFlag('--report-timeout-ms'), 15_000),
    ),
    pollMs: Math.max(100, parseIntegerFlag(getFlag('--poll-ms'), 500)),
    shutdownGraceMs: Math.max(
      100,
      parseIntegerFlag(getFlag('--shutdown-grace-ms'), 1_200),
    ),
    labelA: getFlag('--label-a') ?? 'Comet',
    labelB: getFlag('--label-b') ?? 'Kepler',
    live: args.includes('--live'),
    jsonOutPath: getFlag('--json-out') ?? null,
    humanQuickMatchKeys: args.includes('--human-quick-match-keys'),
  };
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pilot';

const buildAgentCommand = (base: string, profile: string): string =>
  `${base} --profile ${profile}`;

const createQueuePlayer = (
  label: string,
  agentCommandBase: string,
  humanQuickMatchKeys: boolean,
): QueuePlayer => {
  const profile = slugify(label);
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const prefix = humanQuickMatchKeys ? 'scrim' : 'agent';
  return {
    label,
    profile,
    username:
      label
        .replace(/[^A-Za-z0-9 _-]/g, ' ')
        .trim()
        .slice(0, 20) || label,
    playerKey: `${prefix}_${profile}_${suffix}`.slice(0, 64),
    agentCommand: buildAgentCommand(agentCommandBase, profile),
    ticket: null,
    matched: null,
    playerId: null,
    logs: [],
  };
};

const claimUsername = async (
  config: Config,
  player: QueuePlayer,
): Promise<void> => {
  try {
    const res = await fetch(`${config.serverUrl}/api/claim-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerKey: player.playerKey,
        username: player.username,
      }),
    });
    if (!res.ok) {
      // Don't block scrimmage on claim failure — claim is best-effort
      // for the leaderboard. Private/unranked runs still work.
      console.warn(
        `[scrimmage] claim-name failed for ${player.label}: ${res.status}`,
      );
    }
  } catch (err) {
    console.warn(`[scrimmage] claim-name error for ${player.label}:`, err);
  }
};

const resolveMatch = async (
  config: Config,
  player: QueuePlayer,
): Promise<Extract<QuickMatchResult, { status: 'matched' }>> => {
  // Pre-claim the username so the server-side rating writer has a
  // `player` row to update when this match completes. A private
  // scrimmage run without leaderboard wiring still works — the claim
  // failure path is non-fatal.
  await claimUsername(config, player);

  const match = requireMatchedQuickMatch(
    await queueForMatch({
      serverUrl: config.serverUrl,
      scenario: config.scenario,
      username: player.username,
      playerKey: player.playerKey,
      pollMs: config.pollMs,
      // Scrimmage runs want “effectively unbounded” pairing; the queue
      // helper’s default timeout is relatively small, so we override it.
      timeoutMs: 60 * 60 * 1000,
    }),
  );

  player.ticket = match.ticket;
  player.matched = match;
  return match;
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw || 'request failed'}`);
  }
  return JSON.parse(raw) as T;
};

const terminateProcess = (child: ReturnType<typeof spawn>): void => {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, 500).unref();
};

const shouldEmitLiveLine = (line: string): boolean =>
  /^seat assigned: player /.test(line) ||
  /^turn \d+ [a-z]+: selected /.test(line) ||
  /^chat sent: "/.test(line) ||
  /^chat received p[01]: "/.test(line) ||
  /^action rejected \(/.test(line) ||
  /^game over: winner=/.test(line) ||
  /^result: /.test(line);

const parseMetricsFromLogs = (logs: string[]): PlayerRunMetrics => {
  const chatSent: string[] = [];
  const chatReceived: string[] = [];
  const ordnanceMix = { nuke: 0, torpedo: 0, mine: 0 };
  let actionRejectedCount = 0;

  for (const log of logs) {
    const sentMatch = /chat sent: "([^"]+)"/.exec(log);
    if (sentMatch) chatSent.push(sentMatch[1]);

    const receivedMatch = /chat received p[01]: "([^"]+)"/.exec(log);
    if (receivedMatch) chatReceived.push(receivedMatch[1]);

    if (log.includes('action rejected (')) actionRejectedCount += 1;

    if (log.includes('launches nuke')) ordnanceMix.nuke += 1;
    if (log.includes('launches torpedo')) ordnanceMix.torpedo += 1;
    if (log.includes('launches mine')) ordnanceMix.mine += 1;
  }

  return { chatSent, chatReceived, actionRejectedCount, ordnanceMix };
};

const writeJsonSummary = async (
  filePath: string,
  summary: ScrimmageExport,
): Promise<void> => {
  const absolutePath = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });

  let existing: ScrimmageExport[] = [];
  try {
    const raw = await readFile(absolutePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      existing = parsed as ScrimmageExport[];
    }
  } catch {
    // first write or unreadable file; overwrite with fresh array
  }

  existing.push(summary);
  await writeFile(absolutePath, JSON.stringify(existing, null, 2));
};

const runPlayerClient = (
  config: Config,
  player: QueuePlayer,
  code: string,
  playerToken: string,
  onGameOver: () => void,
): {
  child: ReturnType<typeof spawn>;
  done: Promise<PlayerRunResult>;
} => {
  const child = spawn(
    'npm',
    [
      'run',
      'llm:player',
      '--',
      '--server-url',
      config.serverUrl,
      '--mode',
      'join',
      '--code',
      code,
      '--player-token',
      playerToken,
      '--agent',
      'command',
      '--agent-command',
      player.agentCommand,
      '--think-ms',
      String(config.thinkMs),
      '--decision-timeout-ms',
      String(config.decisionTimeoutMs),
      '--no-auto-chat-replies',
      ...(config.live ? ['--verbose'] : []),
    ],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let reportedGameOver = false;
  let lastLiveLine: string | null = null;

  const handleLine = (stream: 'stdout' | 'stderr', rawLine: string): void => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    player.logs.push(`[${player.label} ${stream}] ${line}`);
    if (config.live && shouldEmitLiveLine(line)) {
      if (line !== lastLiveLine) {
        console.log(`[live ${player.label}] ${line}`);
        lastLiveLine = line;
      }
    }

    const seatMatch = /^seat assigned: player ([01]), code ([A-Z0-9]{5})$/.exec(
      line,
    );
    if (seatMatch) {
      player.playerId = Number.parseInt(seatMatch[1], 10) as PlayerId;
    }

    if (!reportedGameOver && /^game over: winner=([01]|draw) /.test(line)) {
      reportedGameOver = true;
      onGameOver();
    }
  };

  const flushBuffer = (stream: 'stdout' | 'stderr', chunk: string): string => {
    const combined = chunk;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    for (const line of lines) {
      handleLine(stream, line);
    }
    return remainder;
  };

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer = flushBuffer('stdout', `${stdoutBuffer}${chunk.toString()}`);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer = flushBuffer('stderr', `${stderrBuffer}${chunk.toString()}`);
  });

  const done = new Promise<PlayerRunResult>((resolve, reject) => {
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      if (stdoutBuffer.trim()) {
        handleLine('stdout', stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        handleLine('stderr', stderrBuffer);
      }
      resolve({ code, signal });
    });
  });

  return { child, done };
};

const waitForReplay = async (
  config: Config,
  code: string,
  playerToken: string,
): Promise<ReplayTimeline> => {
  const url = `${config.serverUrl}/replay/${code}?playerToken=${encodeURIComponent(playerToken)}`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const timeline = await fetchJson<ReplayTimeline>(url);
    const finalState = timeline.entries.at(-1)?.message.state;
    if (finalState?.outcome) {
      return timeline;
    }
    await delay(config.pollMs);
  }

  throw new Error('replay did not reach a final outcome in time');
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

const buildReplaySummary = (timeline: ReplayTimeline): ReplaySummary => {
  const finalState = timeline.entries.at(-1)?.message.state ?? null;
  const phaseCounts: Record<string, number> = {};

  for (const entry of timeline.entries) {
    phaseCounts[entry.phase] = (phaseCounts[entry.phase] ?? 0) + 1;
  }

  const activeShipsByOwner: Record<string, number> = {};
  for (const ship of finalState?.ships ?? []) {
    if (ship.lifecycle === 'destroyed') {
      continue;
    }
    activeShipsByOwner[String(ship.owner)] =
      (activeShipsByOwner[String(ship.owner)] ?? 0) + 1;
  }

  return {
    gameId: timeline.gameId,
    roomCode: timeline.roomCode,
    matchNumber: timeline.matchNumber,
    scenario: timeline.scenario,
    entries: timeline.entries.length,
    finalTurn: finalState?.turnNumber ?? null,
    finalPhase: finalState?.phase ?? null,
    winner: finalState?.outcome?.winner ?? null,
    reason: finalState?.outcome?.reason ?? null,
    activeShipsByOwner,
    phaseCounts,
  };
};

const buildTurnSummaries = (
  timeline: ReplayTimeline,
  playerId: PlayerId,
): TurnSummary[] => {
  const snapshots = new Map<string, TurnSummary>();
  const order: string[] = [];

  for (const entry of timeline.entries) {
    const state = entry.message.state;
    const ownShips = getOperationalShips(state, playerId);
    const enemyShips = getOperationalShips(state, playerId === 0 ? 1 : 0);
    const key = `${state.turnNumber}:${state.phase}`;
    if (!snapshots.has(key)) {
      order.push(key);
    }
    snapshots.set(key, {
      turnNumber: state.turnNumber,
      endingPhase: state.phase,
      ownOperationalShips: ownShips.length,
      enemyOperationalShips: enemyShips.length,
      ownFuel: ownShips.reduce((sum, ship) => sum + ship.fuel, 0),
      enemyFuel: enemyShips.reduce((sum, ship) => sum + ship.fuel, 0),
      nearestEnemyDistance: getNearestEnemyDistance(state, playerId),
    });
  }

  return order
    .map((key) => snapshots.get(key))
    .filter((value): value is TurnSummary => value !== undefined);
};

const printSection = (title: string, values: string[]): void => {
  if (values.length === 0) {
    return;
  }

  console.log(`${title}:`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
};

const pairPlayersInSameRoom = async (
  config: Config,
): Promise<{
  left: QueuePlayer;
  right: QueuePlayer;
  leftMatch: Extract<QuickMatchResult, { status: 'matched' }>;
  rightMatch: Extract<QuickMatchResult, { status: 'matched' }>;
  quickMatchPairingSplitRetries: number;
}> => {
  const maxAttempts = 5;
  let lastMismatch: { leftCode: string; rightCode: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const left = createQueuePlayer(
      config.labelA,
      config.agentCommandBase,
      config.humanQuickMatchKeys,
    );
    const right = createQueuePlayer(
      config.labelB,
      config.agentCommandBase,
      config.humanQuickMatchKeys,
    );
    console.log(
      `Queueing ${left.label} and ${right.label} on ${config.serverUrl} quick match...`,
    );
    const [leftMatch, rightMatch] = await Promise.all([
      resolveMatch(config, left),
      resolveMatch(config, right),
    ]);

    if (leftMatch.code === rightMatch.code) {
      return {
        left,
        right,
        leftMatch,
        rightMatch,
        quickMatchPairingSplitRetries: attempt - 1,
      };
    }

    lastMismatch = { leftCode: leftMatch.code, rightCode: rightMatch.code };
    console.warn(
      `matchmaking split attempt ${attempt}/${maxAttempts}: ${leftMatch.code} vs ${rightMatch.code}; retrying`,
    );
    if (attempt >= 3) {
      console.warn(
        'matchmaking split retries >= 2 — consider MatchmakerDO load or queue fairness investigation',
      );
    }
    await delay(config.pollMs);
  }

  throw new Error(
    `players matched into different rooms after ${maxAttempts} attempts (${
      lastMismatch
        ? `${lastMismatch.leftCode} vs ${lastMismatch.rightCode}`
        : 'unknown'
    })`,
  );
};

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2));
  const { left, right, leftMatch, rightMatch, quickMatchPairingSplitRetries } =
    await pairPlayersInSameRoom(config);

  const code = leftMatch.code;
  console.log(`Matched in room ${code}. Launching player clients...`);

  let shutdownScheduled = false;
  const runners: Array<ReturnType<typeof runPlayerClient>> = [];
  const scheduleShutdown = (): void => {
    if (shutdownScheduled) {
      return;
    }
    shutdownScheduled = true;
    setTimeout(() => {
      for (const runner of runners) {
        terminateProcess(runner.child);
      }
    }, config.shutdownGraceMs).unref();
  };

  runners.push(
    runPlayerClient(
      config,
      left,
      code,
      leftMatch.playerToken,
      scheduleShutdown,
    ),
  );
  runners.push(
    runPlayerClient(
      config,
      right,
      code,
      rightMatch.playerToken,
      scheduleShutdown,
    ),
  );

  const results = await Promise.all(runners.map((runner) => runner.done));
  const failedRuns = results
    .map((result, index) => ({
      result,
      player: index === 0 ? left : right,
    }))
    .filter(
      ({ result }) =>
        result.code !== 0 &&
        result.code !== 143 &&
        result.code !== 137 &&
        result.signal !== 'SIGTERM' &&
        result.signal !== 'SIGKILL',
    );
  if (failedRuns.length > 0) {
    throw new Error(
      failedRuns
        .map(
          ({ player, result }) =>
            `${player.label} exited with code ${result.code ?? 'null'} signal ${result.signal ?? 'none'}\n${player.logs
              .slice(-20)
              .join('\n')}`,
        )
        .join('\n\n'),
    );
  }

  if (left.playerId === null || right.playerId === null) {
    throw new Error('failed to determine player seats from llm-player output');
  }

  const timeline = await waitForReplay(config, code, leftMatch.playerToken);
  const replaySummary = buildReplaySummary(timeline);
  const finalState = timeline.entries.at(-1)?.message.state;
  if (!finalState) {
    throw new Error('replay did not include a final state');
  }

  const leftReport = await runJsonCommand<AgentReportResponse>(
    left.agentCommand,
    {
      kind: 'report',
      version: 1,
      gameCode: code,
      playerId: left.playerId,
      replaySummary,
      turnSummaries: buildTurnSummaries(timeline, left.playerId),
      finalState,
      timeline,
    } satisfies AgentReportInput,
    config.reportTimeoutMs,
  );
  const rightReport = await runJsonCommand<AgentReportResponse>(
    right.agentCommand,
    {
      kind: 'report',
      version: 1,
      gameCode: code,
      playerId: right.playerId,
      replaySummary,
      turnSummaries: buildTurnSummaries(timeline, right.playerId),
      finalState,
      timeline,
    } satisfies AgentReportInput,
    config.reportTimeoutMs,
  );

  console.log('');
  console.log('Scrimmage report');
  console.log(`Room: ${replaySummary.roomCode}`);
  console.log(`Game: ${replaySummary.gameId}`);
  console.log(`Winner: ${replaySummary.winner ?? 'draw'}`);
  console.log(`Reason: ${replaySummary.reason ?? 'unknown'}`);
  console.log(
    `Turns: ${replaySummary.finalTurn ?? '?'} | Replay entries: ${replaySummary.entries}`,
  );
  console.log(
    `Phase counts: ${Object.entries(replaySummary.phaseCounts)
      .map(([phase, count]) => `${phase}=${count}`)
      .join(', ')}`,
  );

  for (const [player, report] of [
    [left, leftReport],
    [right, rightReport],
  ] as const) {
    console.log('');
    console.log(`${player.label} (player ${player.playerId})`);
    console.log(report.summary);
    printSection('Recent chat', report.recentChats ?? []);
    printSection('Strengths', report.strengths);
    printSection('Mistakes', report.mistakes);
    printSection('Lessons', report.lessons);
    printSection('Next focus', report.nextFocus);
    console.log(
      `Record: ${report.record.wins}-${report.record.losses}-${report.record.draws} in ${report.record.gamesPlayed} game(s), win rate ${report.record.winRate}%`,
    );
  }

  if (config.jsonOutPath) {
    const leftMetrics = parseMetricsFromLogs(left.logs);
    const rightMetrics = parseMetricsFromLogs(right.logs);
    const summary: ScrimmageExport = {
      timestamp: new Date().toISOString(),
      serverUrl: config.serverUrl,
      scenario: config.scenario,
      roomCode: replaySummary.roomCode,
      gameId: replaySummary.gameId,
      winner: replaySummary.winner,
      reason: replaySummary.reason,
      turns: replaySummary.finalTurn,
      replayEntries: replaySummary.entries,
      phaseCounts: replaySummary.phaseCounts,
      quickMatchPairingSplitRetries,
      players: [
        {
          label: left.label,
          profile: left.profile,
          playerId: left.playerId,
          report: leftReport,
          metrics: leftMetrics,
        },
        {
          label: right.label,
          profile: right.profile,
          playerId: right.playerId,
          report: rightReport,
          metrics: rightMetrics,
        },
      ],
    };
    await writeJsonSummary(config.jsonOutPath, summary);
    console.log(`JSON summary appended: ${path.resolve(config.jsonOutPath)}`);
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
