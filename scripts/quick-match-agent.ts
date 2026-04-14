import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

import {
  type QuickMatchResult,
  queueForMatch as sharedQueueForMatch,
} from '../src/shared/agent';
import { hexDistance } from '../src/shared/hex';
import type { ReplayTimeline } from '../src/shared/replay';
import type { GameState, PlayerId, Ship } from '../src/shared/types/domain';

const DEFAULT_SERVER_URL =
  process.env.SERVER_URL || 'https://delta-v.tre.systems';
const DEFAULT_SCENARIO = 'duel';
const DEFAULT_PROFILE = 'queue-bot';
const DEFAULT_USERNAME = 'QueueBot';

interface Config {
  serverUrl: string;
  scenario: string;
  username: string;
  profile: string;
  playerKey: string;
  turnAgentCommand: string;
  reportAgentCommand: string | null;
  thinkMs: number;
  decisionTimeoutMs: number;
  reportTimeoutMs: number;
  pollMs: number;
  postGamePauseMs: number;
  maxGames: number;
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
  recentChats?: string[];
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

type QueueMatch = QuickMatchResult;

interface PlayerRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  playerId: PlayerId | null;
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

const redactTokenInLine = (line: string): string =>
  line
    .replace(/playerToken=([A-Za-z0-9\-_]+)/g, 'playerToken=****')
    .replace(
      /(--player-token\s+)([A-Za-z0-9\-_]+)/g,
      (_match, prefix: string) => `${prefix}****`,
    )
    .replace(
      /(reconnect token available \(use with --player-token\):\s+)([A-Za-z0-9\-_]+)/g,
      (_match, prefix: string) => `${prefix}****`,
    );

const parseArgs = (argv: string[]): Config => {
  const args = [...argv];
  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  if (args.includes('--help')) {
    console.log(`Quick-match queue bot

Examples:
  npm run quickmatch:agent
  npm run quickmatch:agent -- --username "OrbitHost" --profile orbit-host
  npm run quickmatch:agent -- --server-url https://delta-v.tre.systems --max-games 3

Flags:
  --server-url             Worker base URL (default: ${DEFAULT_SERVER_URL})
  --scenario               Quick-match scenario (default: ${DEFAULT_SCENARIO})
  --username               Public username shown in lobby (default: ${DEFAULT_USERNAME})
  --profile                Memory/report profile (default: ${DEFAULT_PROFILE})
  --player-key             Stable quick-match player key; must start with "agent_"
  --agent-command          Alias for --turn-agent-command
  --turn-agent-command     Command used for live per-turn decisions (default: llm:agent:claude)
  --report-agent-command   Command used for post-game report/memory updates (default: llm:agent:coach)
  --no-report              Disable post-game report command
  --think-ms               Delay before each move (default: 200)
  --decision-timeout-ms    Per-turn decision timeout (default: 30000)
  --report-timeout-ms      Post-game report timeout (default: 15000)
  --poll-ms                Quick-match/replay poll interval (default: 1000)
  --post-game-pause-ms     Pause before re-queueing (default: 1000)
  --max-games              Stop after N games; 0 = run forever (default: 0)
`);
    process.exit(0);
  }

  const profile = (getFlag('--profile') ?? DEFAULT_PROFILE).toLowerCase();
  const defaultTurnAgentCommand = 'npm run llm:agent:claude --silent';
  const defaultReportAgentCommand = `npm run llm:agent:coach --silent -- --profile ${profile}`;
  const turnAgentCommand =
    getFlag('--turn-agent-command') ??
    getFlag('--agent-command') ??
    defaultTurnAgentCommand;
  const reportAgentCommand = args.includes('--no-report')
    ? null
    : (getFlag('--report-agent-command') ?? defaultReportAgentCommand);

  if (
    turnAgentCommand === defaultTurnAgentCommand &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for live model turns. Set the key or override --turn-agent-command.',
    );
  }

  const providedPlayerKey = getFlag('--player-key');
  const fallbackPlayerKey = `agent_${profile}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const playerKey = providedPlayerKey ?? fallbackPlayerKey;
  if (!playerKey.startsWith('agent_')) {
    throw new Error('--player-key must start with "agent_"');
  }

  return {
    serverUrl: getFlag('--server-url') ?? DEFAULT_SERVER_URL,
    scenario: getFlag('--scenario') ?? DEFAULT_SCENARIO,
    username: (getFlag('--username') ?? DEFAULT_USERNAME).slice(0, 20),
    profile,
    playerKey,
    turnAgentCommand,
    reportAgentCommand,
    thinkMs: Math.max(0, parseIntegerFlag(getFlag('--think-ms'), 200)),
    decisionTimeoutMs: Math.max(
      1_000,
      parseIntegerFlag(getFlag('--decision-timeout-ms'), 30_000),
    ),
    reportTimeoutMs: Math.max(
      1_000,
      parseIntegerFlag(getFlag('--report-timeout-ms'), 15_000),
    ),
    pollMs: Math.max(200, parseIntegerFlag(getFlag('--poll-ms'), 1_000)),
    postGamePauseMs: Math.max(
      0,
      parseIntegerFlag(getFlag('--post-game-pause-ms'), 1_000),
    ),
    maxGames: Math.max(0, parseIntegerFlag(getFlag('--max-games'), 0)),
  };
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw || 'request failed'}`);
  }
  return JSON.parse(raw) as T;
};

const queueForMatch = async (config: Config): Promise<QueueMatch> =>
  sharedQueueForMatch({
    serverUrl: config.serverUrl,
    scenario: config.scenario,
    username: config.username,
    playerKey: config.playerKey,
    pollMs: config.pollMs,
    // Effectively unbounded queue wait; the server's ticket TTL still bounds us.
    timeoutMs: 60 * 60 * 1000,
  });

const runPlayer = async (
  config: Config,
  match: QueueMatch,
): Promise<PlayerRunResult> =>
  await new Promise<PlayerRunResult>((resolve, reject) => {
    const child = spawn(
      'npm',
      [
        'run',
        '--silent',
        'llm:player',
        '--',
        '--server-url',
        config.serverUrl,
        '--mode',
        'join',
        '--code',
        match.code,
        '--player-token',
        match.playerToken,
        '--agent',
        'command',
        '--agent-command',
        config.turnAgentCommand,
        '--think-ms',
        String(config.thinkMs),
        '--decision-timeout-ms',
        String(config.decisionTimeoutMs),
        '--verbose',
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let playerId: PlayerId | null = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const handleLine = (stream: 'stdout' | 'stderr', rawLine: string): void => {
      const line = rawLine.trim();
      if (!line) return;
      console.log(`[llm-player ${stream}] ${redactTokenInLine(line)}`);
      const seatMatch =
        /^seat assigned: player ([01]), code ([A-Z0-9]{5})$/.exec(line);
      if (seatMatch) {
        playerId = Number.parseInt(seatMatch[1], 10) as PlayerId;
      }
    };

    const flushBuffer = (
      stream: 'stdout' | 'stderr',
      combined: string,
    ): string => {
      const lines = combined.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      for (const line of lines) handleLine(stream, line);
      return remainder;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer = flushBuffer(
        'stdout',
        `${stdoutBuffer}${chunk.toString()}`,
      );
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer = flushBuffer(
        'stderr',
        `${stderrBuffer}${chunk.toString()}`,
      );
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (stdoutBuffer.trim()) handleLine('stdout', stdoutBuffer);
      if (stderrBuffer.trim()) handleLine('stderr', stderrBuffer);
      resolve({ code, signal, playerId });
    });
  });

const parseJsonFromOutput = <T>(raw: string): T => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('output was empty');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lines = trimmed.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]) as T;
      } catch {
        // keep scanning
      }
    }
  }
  throw new Error('output did not contain valid JSON');
};

const runJsonCommand = async <T>(
  command: string,
  payload: unknown,
  timeoutMs: number,
): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    const child = spawn('zsh', ['-lc', command], {
      cwd: process.cwd(),
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
        reject(new Error(`command timed out after ${timeoutMs}ms`));
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
              `command exited with code ${code}. stderr: ${stderr.trim() || '(none)'}`,
            ),
          );
          return;
        }
        try {
          resolve(parseJsonFromOutput<T>(stdout));
        } catch (error) {
          reject(
            new Error(
              `failed to parse command JSON: ${
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

const waitForReplay = async (
  config: Config,
  code: string,
  playerToken: string,
): Promise<ReplayTimeline> => {
  const url = `${config.serverUrl}/replay/${code}?playerToken=${encodeURIComponent(playerToken)}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const timeline = await fetchJson<ReplayTimeline>(url);
    const finalState = timeline.entries.at(-1)?.message.state;
    if (finalState?.outcome) return timeline;
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
    if (ship.lifecycle === 'destroyed') continue;
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
    if (!snapshots.has(key)) order.push(key);
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

const printReport = (report: AgentReportResponse): void => {
  console.log(`Coach: ${report.summary}`);
  if (report.recentChats && report.recentChats.length > 0) {
    console.log(`Recent chat: ${report.recentChats.join(' | ')}`);
  }
  if (report.lessons.length > 0) {
    console.log(`Top lessons: ${report.lessons.join(' / ')}`);
  }
  console.log(
    `Record: ${report.record.wins}-${report.record.losses}-${report.record.draws} (${report.record.winRate}% over ${report.record.gamesPlayed} games)`,
  );
};

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2));
  console.log(
    `Queue bot ready on ${config.serverUrl} (scenario=${config.scenario}, user=${config.username}, profile=${config.profile})`,
  );
  console.log(`Turn agent command: ${config.turnAgentCommand}`);
  console.log(
    `Report agent command: ${config.reportAgentCommand ?? '(disabled)'}`,
  );

  let gamesPlayed = 0;
  while (config.maxGames === 0 || gamesPlayed < config.maxGames) {
    const nextIndex = gamesPlayed + 1;
    console.log('');
    console.log(`=== Queue cycle ${nextIndex} ===`);
    console.log(`Queueing with playerKey=${config.playerKey}`);

    const match = await queueForMatch(config);
    console.log(
      `Matched! code=${match.code} (watch: ${config.serverUrl}/game/${match.code})`,
    );

    const playerRun = await runPlayer(config, match);
    const acceptableExit =
      playerRun.code === 0 ||
      playerRun.code === 143 ||
      playerRun.code === 137 ||
      playerRun.signal === 'SIGTERM' ||
      playerRun.signal === 'SIGKILL';
    if (!acceptableExit) {
      throw new Error(
        `llm-player exited unexpectedly (code=${playerRun.code} signal=${playerRun.signal})`,
      );
    }
    if (playerRun.playerId === null) {
      throw new Error('could not determine playerId from llm-player logs');
    }

    const timeline = await waitForReplay(config, match.code, match.playerToken);
    const replaySummary = buildReplaySummary(timeline);
    const finalState = timeline.entries.at(-1)?.message.state;
    if (!finalState) throw new Error('replay missing final state');

    if (config.reportAgentCommand) {
      const report = await runJsonCommand<AgentReportResponse>(
        config.reportAgentCommand,
        {
          kind: 'report',
          version: 1,
          gameCode: match.code,
          playerId: playerRun.playerId,
          replaySummary,
          turnSummaries: buildTurnSummaries(timeline, playerRun.playerId),
          finalState,
          timeline,
        } satisfies AgentReportInput,
        config.reportTimeoutMs,
      );
      printReport(report);
    }

    gamesPlayed += 1;
    if (config.maxGames === 0 || gamesPlayed < config.maxGames) {
      await delay(config.postGamePauseMs);
    }
  }

  console.log(`Finished ${gamesPlayed} game(s).`);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
