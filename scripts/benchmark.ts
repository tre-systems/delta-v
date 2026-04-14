// Agent benchmark CLI — runs an external command agent against the
// built-in AI in-process (no WebSocket server, no Durable Object) for
// reproducible cross-agent evaluation.
//
// Usage:
//   npm run benchmark -- \
//       --agent-command 'npm run llm:agent:claude' \
//       --opponent hard \
//       --scenario duel \
//       --games 20
//
// Output: progress to stderr, final structured JSON summary to stdout (or
// to --output FILE). The harness spawns the agent once per turn (same
// protocol as scripts/llm-player.ts --agent command) and falls back to
// recommendedIndex on timeout / non-zero exit / unparsable output, so a
// flaky agent still produces a measurable run.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import {
  type AgentTurnInput,
  type AgentTurnResponse,
  applyAgentAction,
  buildObservation,
} from '../src/shared/agent';
import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIFleetPurchases,
} from '../src/shared/ai';
import {
  beginCombatPhase,
  createGame,
  processFleetReady,
} from '../src/shared/engine/game-engine';
import { asGameId } from '../src/shared/ids';
import type { ScenarioKey } from '../src/shared/map-data';
import {
  buildSolarSystemMap,
  findBaseHex,
  isValidScenario,
  SCENARIOS,
} from '../src/shared/map-data';
import { mulberry32 } from '../src/shared/prng';
import type { GameState, PlayerId, SolarSystemMap } from '../src/shared/types';
import type { C2S } from '../src/shared/types/protocol';

type SeatMode = 0 | 1 | 'alt';

interface BenchmarkOptions {
  agentCommand: string;
  opponents: AIDifficulty[];
  scenarios: ScenarioKey[];
  games: number;
  baseSeed: number;
  timeoutMs: number;
  seat: SeatMode;
  verbose: boolean;
  output: string | null;
  includeSummary: boolean;
  includeLegalActionInfo: boolean;
  includeTactical: boolean;
  includeSpatialGrid: boolean;
  includeCandidateLabels: boolean;
}

interface GameResult {
  scenario: ScenarioKey;
  opponent: AIDifficulty;
  agentSeat: PlayerId;
  winner: PlayerId | null;
  turns: number;
  reason: string | null;
  agentTurns: number;
  agentAccepted: number;
  agentFallbacks: number;
  agentTimeouts: number;
  agentParseErrors: number;
  agentDecisionMs: number;
  crashed: boolean;
  crashMessage?: string;
}

interface MatchupMetrics {
  scenario: ScenarioKey;
  opponent: AIDifficulty;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  meanTurns: number;
  meanDecisionMs: number;
  actionValidityRate: number; // accepted / total decisions
  timeoutRate: number;
  parseErrorRate: number;
  crashes: number;
  winRate: number;
  elo: number; // estimate vs this opponent difficulty
}

// Simple logistic Elo-from-winrate estimate anchored to each baseline
// difficulty. Easy AI sits at 1000, normal at 1200, hard at 1400 — the
// exact anchors don't matter as long as they're stable so agent runs are
// comparable across versions.
const OPPONENT_ANCHOR_ELO: Record<AIDifficulty, number> = {
  easy: 1000,
  normal: 1200,
  hard: 1400,
};

// Clamp win-rate away from 0/1 so log1ratio doesn't explode when a small
// run happens to go 100%.
const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

const eloFromWinRate = (winRate: number, opponent: AIDifficulty): number => {
  const p = clamp(winRate, 0.01, 0.99);
  const delta = -400 * Math.log10(1 / p - 1);
  return Math.round(OPPONENT_ANCHOR_ELO[opponent] + delta);
};

const parseList = <T extends string>(
  raw: string,
  validator: (s: string) => s is T,
  label: string,
): T[] => {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!validator(p)) throw new Error(`Invalid ${label}: "${p}"`);
  }
  return parts as T[];
};

const isDifficulty = (s: string): s is AIDifficulty =>
  s === 'easy' || s === 'normal' || s === 'hard';

const parseArgs = (argv: string[]): BenchmarkOptions => {
  const opts: BenchmarkOptions = {
    agentCommand: '',
    opponents: ['hard'],
    scenarios: ['duel'],
    games: 20,
    baseSeed: Date.now() | 0,
    timeoutMs: 15_000,
    seat: 'alt',
    verbose: false,
    output: null,
    includeSummary: true,
    includeLegalActionInfo: true,
    includeTactical: false,
    includeSpatialGrid: false,
    includeCandidateLabels: false,
  };

  const getFlag = (i: number): string => {
    const v = argv[i + 1];
    if (!v) throw new Error(`Missing value for ${argv[i]}`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--agent-command':
        opts.agentCommand = getFlag(i);
        i++;
        break;
      case '--opponent': {
        const raw = getFlag(i);
        i++;
        opts.opponents =
          raw === 'all'
            ? ['easy', 'normal', 'hard']
            : parseList(raw, isDifficulty, 'opponent');
        break;
      }
      case '--scenario': {
        const raw = getFlag(i);
        i++;
        const parts = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const s of parts) {
          if (!isValidScenario(s)) throw new Error(`Unknown scenario: ${s}`);
        }
        opts.scenarios = parts as ScenarioKey[];
        break;
      }
      case '--games':
        opts.games = Math.max(1, Number.parseInt(getFlag(i), 10));
        i++;
        break;
      case '--seed':
        opts.baseSeed = Number.parseInt(getFlag(i), 10) | 0;
        i++;
        break;
      case '--timeout-ms':
        opts.timeoutMs = Math.max(250, Number.parseInt(getFlag(i), 10));
        i++;
        break;
      case '--seat': {
        const raw = getFlag(i);
        i++;
        if (raw === '0') opts.seat = 0;
        else if (raw === '1') opts.seat = 1;
        else if (raw === 'alt') opts.seat = 'alt';
        else
          throw new Error(`Invalid --seat: "${raw}" (expected 0, 1, or alt)`);
        break;
      }
      case '--output':
        opts.output = getFlag(i);
        i++;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--compact':
        opts.includeSummary = false;
        opts.includeLegalActionInfo = false;
        break;
      case '--v2':
        opts.includeTactical = true;
        opts.includeSpatialGrid = true;
        opts.includeCandidateLabels = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  if (!opts.agentCommand) {
    printHelp();
    throw new Error('--agent-command is required');
  }
  return opts;
};

const printHelp = (): void => {
  process.stdout.write(
    `delta-v benchmark — pit an external agent against the built-in AI.

Required:
  --agent-command <cmd>    Shell command spawned each turn. Receives
                           AgentTurnInput on stdin, must emit
                           AgentTurnResponse JSON on stdout (same protocol
                           as scripts/llm-player.ts --agent command).

Optional:
  --opponent  <easy|normal|hard|all|csv>   Default: hard
  --scenario  <name|csv>                   Default: duel
  --games     <N>                          Default: 20
  --seat      <0|1|alt>                    Default: alt (balance seat bias)
  --timeout-ms <N>                         Default: 15000 per turn
  --seed      <N>                          Default: Date.now()
  --compact                                Omit summary + legalActionInfo
  --v2                                     Include tactical/spatial/labeled
  --output    <path>                       Write JSON summary to file
  --verbose                                Stream per-turn progress
  -h / --help                              This message.

Example:
  npm run benchmark -- \\
      --agent-command 'npm run llm:agent:claude' \\
      --opponent all --scenario duel,biplanetary --games 20
`,
  );
};

interface CommandAgentStats {
  response: AgentTurnResponse;
  decisionMs: number;
  timedOut: boolean;
  parseError: boolean;
  exitError: boolean;
}

// Single subprocess invocation of the agent. Mirrors the contract in
// scripts/llm-player.ts:runCommandAgent so an agent that runs through the
// bridge also runs through the benchmark unchanged.
const runCommandAgent = (
  command: string,
  payload: AgentTurnInput,
  timeoutMs: number,
): Promise<CommandAgentStats> =>
  new Promise<CommandAgentStats>((resolve) => {
    const started = Date.now();
    const child = spawn('zsh', ['-lc', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let settled = false;

    const settle = (stats: CommandAgentStats) => {
      if (settled) return;
      settled = true;
      resolve(stats);
    };

    const fallback = (
      reason: Partial<CommandAgentStats> = {},
    ): CommandAgentStats => ({
      response: { candidateIndex: payload.recommendedIndex },
      decisionMs: Date.now() - started,
      timedOut: false,
      parseError: false,
      exitError: false,
      ...reason,
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(fallback({ timedOut: true }));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      settle(fallback({ exitError: true }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        settle(fallback({ exitError: true }));
        return;
      }
      try {
        const parsed = extractJson(stdout) as AgentTurnResponse;
        settle({
          response: parsed,
          decisionMs: Date.now() - started,
          timedOut: false,
          parseError: false,
          exitError: false,
        });
      } catch {
        settle(fallback({ parseError: true }));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

// Pull the first JSON object/array out of the agent's stdout, ignoring
// any surrounding log lines. Matches llm-player's parseJsonFromOutput
// but kept local to avoid importing a private helper.
const extractJson = <T = unknown>(raw: string): T => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('empty stdout');
  const firstBrace = trimmed.search(/[{[]/);
  if (firstBrace < 0) throw new Error('no JSON found');
  const slice = trimmed.slice(firstBrace);
  return JSON.parse(slice) as T;
};

// Resolve the agent's response to a concrete C2S action. Fallbacks
// (candidateIndex missing, out of range, invalid action shape) all return
// the recommended candidate so a misbehaving agent still advances the
// game.
const resolveAgentAction = (
  response: AgentTurnResponse,
  candidates: readonly C2S[],
): { action: C2S; usedFallback: boolean } => {
  const recommended = candidates[0];
  if (response.action && typeof response.action === 'object') {
    return { action: response.action, usedFallback: false };
  }
  const idx = response.candidateIndex;
  if (
    typeof idx === 'number' &&
    Number.isInteger(idx) &&
    idx >= 0 &&
    idx < candidates.length
  ) {
    return { action: candidates[idx], usedFallback: false };
  }
  return { action: recommended, usedFallback: true };
};

// Run the built-in AI's turn using the same helpers as simulate-ai.ts.
// This is the opponent half of the benchmark.
const runBuiltinTurn = (
  state: GameState,
  playerId: PlayerId,
  difficulty: AIDifficulty,
  map: SolarSystemMap,
  rng: () => number,
): { ok: true; state: GameState } | { ok: false; message: string } => {
  switch (state.phase) {
    case 'astrogation': {
      const orders = aiAstrogation(state, playerId, map, difficulty, rng);
      return applyOr(
        applyAgentAction(
          state,
          playerId,
          { type: 'astrogation', orders },
          map,
          rng,
        ),
      );
    }
    case 'ordnance': {
      const launches = aiOrdnance(state, playerId, map, difficulty, rng);
      const action: C2S =
        launches.length > 0
          ? { type: 'ordnance', launches }
          : { type: 'skipOrdnance' };
      return applyOr(applyAgentAction(state, playerId, action, map, rng));
    }
    case 'combat': {
      const pre = beginCombatPhase(state, playerId, map, rng);
      if ('error' in pre) return { ok: false, message: pre.error.message };
      let next = pre.state;
      if (next.phase === 'combat') {
        const attacks = aiCombat(next, playerId, map, difficulty);
        const action: C2S =
          attacks.length > 0
            ? { type: 'combat', attacks }
            : { type: 'skipCombat' };
        const res = applyAgentAction(next, playerId, action, map, rng);
        if (!res.ok) return { ok: false, message: res.error.message };
        next = res.state;
      }
      return { ok: true, state: next };
    }
    case 'logistics': {
      const transfers = aiLogistics(state, playerId, map, difficulty);
      const action: C2S =
        transfers.length > 0
          ? { type: 'logistics', transfers }
          : { type: 'skipLogistics' };
      return applyOr(applyAgentAction(state, playerId, action, map, rng));
    }
    case 'fleetBuilding':
    case 'waiting':
    case 'gameOver':
      return { ok: false, message: `Unexpected phase ${state.phase}` };
    default: {
      const _exhaustive: never = state.phase;
      return { ok: false, message: `Unknown phase ${_exhaustive}` };
    }
  }
};

const applyOr = (
  result:
    | { ok: true; state: GameState }
    | { ok: false; error: { message: string } },
): { ok: true; state: GameState } | { ok: false; message: string } =>
  result.ok ? result : { ok: false, message: result.error.message };

// Single game: agent vs. baseline at the given difficulty. Returns
// rich per-game stats so the caller can aggregate matchup metrics.
const runBenchmarkGame = async (
  opts: BenchmarkOptions,
  scenario: ScenarioKey,
  opponent: AIDifficulty,
  agentSeat: PlayerId,
  gameSeed: number,
): Promise<GameResult> => {
  const stats: GameResult = {
    scenario,
    opponent,
    agentSeat,
    winner: null,
    turns: 0,
    reason: null,
    agentTurns: 0,
    agentAccepted: 0,
    agentFallbacks: 0,
    agentTimeouts: 0,
    agentParseErrors: 0,
    agentDecisionMs: 0,
    crashed: false,
  };

  const map = buildSolarSystemMap();
  const rng = mulberry32(gameSeed);
  const createResult = createGame(
    SCENARIOS[scenario],
    map,
    asGameId(`bench-${scenario}-${gameSeed >>> 0}`),
    findBaseHex,
    rng,
    scenario,
  );
  if (!createResult.ok) {
    stats.crashed = true;
    stats.crashMessage = createResult.error.message;
    return stats;
  }
  let state: GameState = createResult.value;

  // Fleet building (both seats).
  if (state.phase === 'fleetBuilding') {
    for (const seat of [0, 1] as PlayerId[]) {
      const difficulty: AIDifficulty = seat === agentSeat ? 'hard' : opponent;
      const purchases = buildAIFleetPurchases(
        state,
        seat,
        difficulty,
        SCENARIOS[scenario].availableFleetPurchases,
      );
      const result = processFleetReady(state, seat, purchases, map);
      if ('error' in result) {
        stats.crashed = true;
        stats.crashMessage = `fleetReady P${seat}: ${result.error.message}`;
        return stats;
      }
      state = result.state;
    }
  }

  // Main loop — guard against runaway games with a generous step cap.
  let stepLimit = 2000;
  const opponentSeat: PlayerId = agentSeat === 0 ? 1 : 0;

  try {
    while (state.phase !== 'gameOver' && stepLimit > 0) {
      stepLimit--;
      const active = state.activePlayer;

      if (active === agentSeat) {
        const payload = buildObservation(state, agentSeat, {
          gameCode: 'BENCH',
          map,
          includeSummary: opts.includeSummary,
          includeLegalActionInfo: opts.includeLegalActionInfo,
          includeTactical: opts.includeTactical,
          includeSpatialGrid: opts.includeSpatialGrid,
          includeCandidateLabels: opts.includeCandidateLabels,
        });
        if (payload.candidates.length === 0) {
          // No candidates: advance with an engine skip if possible.
          // In practice this only happens on waiting/gameOver; treat as
          // terminal.
          break;
        }

        stats.agentTurns++;
        const invocation = await runCommandAgent(
          opts.agentCommand,
          payload,
          opts.timeoutMs,
        );
        stats.agentDecisionMs += invocation.decisionMs;
        if (invocation.timedOut) stats.agentTimeouts++;
        if (invocation.parseError) stats.agentParseErrors++;

        const { action, usedFallback } = resolveAgentAction(
          invocation.response,
          payload.candidates,
        );
        if (usedFallback) stats.agentFallbacks++;
        const apply = applyAgentAction(state, agentSeat, action, map, rng);
        if (!apply.ok) {
          // Invalid action — fall back to recommended and try once more.
          stats.agentFallbacks++;
          const retry = applyAgentAction(
            state,
            agentSeat,
            payload.candidates[0],
            map,
            rng,
          );
          if (!retry.ok) {
            stats.crashed = true;
            stats.crashMessage = `Recommended action failed: ${retry.error.message}`;
            break;
          }
          state = retry.state;
        } else {
          stats.agentAccepted++;
          state = apply.state;
        }
      } else {
        const r = runBuiltinTurn(state, opponentSeat, opponent, map, rng);
        if (!r.ok) {
          stats.crashed = true;
          stats.crashMessage = r.message;
          break;
        }
        state = r.state;
      }
    }
  } catch (err) {
    stats.crashed = true;
    stats.crashMessage = err instanceof Error ? err.message : String(err);
  }

  if (stepLimit <= 0 && state.phase !== 'gameOver') {
    stats.reason = 'stepLimit';
  } else {
    stats.reason = state.outcome?.reason ?? null;
  }
  stats.turns = state.turnNumber;
  stats.winner = state.outcome?.winner ?? null;
  return stats;
};

const summarize = (results: GameResult[]): MatchupMetrics[] => {
  const groups = new Map<string, GameResult[]>();
  for (const r of results) {
    const key = `${r.scenario}|${r.opponent}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: MatchupMetrics[] = [];
  for (const [, rows] of groups) {
    const scenario = rows[0].scenario;
    const opponent = rows[0].opponent;
    const games = rows.length;
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let turnSum = 0;
    let decisionSum = 0;
    let decisionCount = 0;
    let accepted = 0;
    let total = 0;
    let timeouts = 0;
    let parseErrors = 0;
    let crashes = 0;

    for (const r of rows) {
      if (r.crashed) crashes++;
      if (r.winner === r.agentSeat) wins++;
      else if (r.winner === null) draws++;
      else losses++;
      turnSum += r.turns;
      decisionSum += r.agentDecisionMs;
      decisionCount += r.agentTurns;
      accepted += r.agentAccepted;
      total += r.agentTurns;
      timeouts += r.agentTimeouts;
      parseErrors += r.agentParseErrors;
    }
    const winRate = games > 0 ? wins / games : 0;
    out.push({
      scenario,
      opponent,
      games,
      wins,
      losses,
      draws,
      meanTurns: games > 0 ? turnSum / games : 0,
      meanDecisionMs: decisionCount > 0 ? decisionSum / decisionCount : 0,
      actionValidityRate: total > 0 ? accepted / total : 0,
      timeoutRate: total > 0 ? timeouts / total : 0,
      parseErrorRate: total > 0 ? parseErrors / total : 0,
      crashes,
      winRate,
      elo: eloFromWinRate(winRate, opponent),
    });
  }
  return out;
};

const deriveSeed = (base: number, idx: number): number =>
  (base + Math.imul(idx + 1, 0x9e3779b9)) | 0;

const main = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2));

  process.stderr.write(
    `=== delta-v benchmark ===\n` +
      `agent: ${opts.agentCommand}\n` +
      `scenarios: ${opts.scenarios.join(', ')}\n` +
      `opponents: ${opts.opponents.join(', ')}\n` +
      `games per matchup: ${opts.games}  seat: ${opts.seat}  seed: ${opts.baseSeed}\n\n`,
  );

  const all: GameResult[] = [];
  const start = Date.now();
  let idx = 0;
  const totalMatches =
    opts.scenarios.length * opts.opponents.length * opts.games;

  for (const scenario of opts.scenarios) {
    for (const opponent of opts.opponents) {
      for (let i = 0; i < opts.games; i++) {
        const agentSeat: PlayerId =
          opts.seat === 'alt' ? ((i % 2) as PlayerId) : opts.seat;
        const seed = deriveSeed(opts.baseSeed, idx);
        idx++;
        const g = await runBenchmarkGame(
          opts,
          scenario,
          opponent,
          agentSeat,
          seed,
        );
        all.push(g);
        if (opts.verbose) {
          const tag = g.crashed
            ? `CRASH(${g.crashMessage ?? 'unknown'})`
            : g.winner === agentSeat
              ? 'W'
              : g.winner === null
                ? 'D'
                : 'L';
          process.stderr.write(
            `[${idx}/${totalMatches}] ${scenario} vs ${opponent} seat=${agentSeat}: ${tag} (turns=${g.turns}, agent=${g.agentTurns}, accept=${g.agentAccepted}, fb=${g.agentFallbacks}, to=${g.agentTimeouts})\n`,
          );
        } else {
          process.stderr.write('.');
        }
      }
      if (!opts.verbose) process.stderr.write('\n');
    }
  }

  const duration = Date.now() - start;
  const matchups = summarize(all);

  process.stderr.write(`\n=== summary (${duration}ms) ===\n`);
  for (const m of matchups) {
    process.stderr.write(
      `${m.scenario} vs ${m.opponent}: ${m.wins}-${m.losses}-${m.draws} ` +
        `winRate=${(m.winRate * 100).toFixed(1)}% Elo≈${m.elo} ` +
        `turns=${m.meanTurns.toFixed(1)} ` +
        `decisionMs=${m.meanDecisionMs.toFixed(0)} ` +
        `validity=${(m.actionValidityRate * 100).toFixed(1)}% ` +
        `timeout=${(m.timeoutRate * 100).toFixed(1)}% ` +
        `crashes=${m.crashes}\n`,
    );
  }

  const summary = {
    agentCommand: opts.agentCommand,
    options: {
      opponents: opts.opponents,
      scenarios: opts.scenarios,
      games: opts.games,
      baseSeed: opts.baseSeed,
      seat: opts.seat,
      timeoutMs: opts.timeoutMs,
    },
    durationMs: duration,
    matchups,
    games: all,
  };

  const json = JSON.stringify(summary, null, 2);
  if (opts.output) {
    writeFileSync(opts.output, json);
    process.stderr.write(`\nWrote ${opts.output}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
};

main().catch((err: unknown) => {
  process.stderr.write(
    `benchmark failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
