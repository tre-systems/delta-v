import process from 'node:process';

type ToolName =
  | 'delta_v_quick_match_connect'
  | 'delta_v_wait_for_turn'
  | 'delta_v_send_action'
  | 'delta_v_send_chat'
  | 'delta_v_get_state'
  | 'delta_v_close_session';

interface QuickMatchConnectArgs {
  serverUrl: string;
  scenario: string;
  username: string;
  playerKey?: string;
}

interface WaitForTurnArgs {
  sessionId: string;
  timeoutMs?: number;
  includeSummary?: boolean;
  includeLegalActionInfo?: boolean;
  includeTactical?: boolean;
  includeSpatialGrid?: boolean;
  includeCandidateLabels?: boolean;
}

interface SendActionArgs {
  sessionId: string;
  action: { type: string; [k: string]: unknown };
  waitForResult?: boolean;
  waitTimeoutMs?: number;
  includeNextObservation?: boolean;
  includeSummary?: boolean;
  includeLegalActionInfo?: boolean;
  includeTactical?: boolean;
  includeSpatialGrid?: boolean;
  includeCandidateLabels?: boolean;
}

const DEFAULT_MCP_URL = process.env.MCP_URL ?? 'http://127.0.0.1:3939/';
const SERVER_URL = process.env.SERVER_URL ?? 'https://delta-v.tre.systems';
const SCENARIO = process.env.SCENARIO ?? 'duel';
const USERNAME_PREFIX = process.env.USERNAME_PREFIX ?? 'HarnessBot';
const AGENTS = Number(process.env.AGENTS ?? 6);
const MAX_ASTRO_TURNS = Number(process.env.MAX_ASTRO_TURNS ?? 4);
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 30_000);

type RiskTag = 'low' | 'medium' | 'high';
type CandidateAction = { type: string; [k: string]: unknown };

type Phase = string;

interface AstrogationOrder {
  shipId: string;
  burn: number | null;
  overload: number | null;
}

interface AstrogationAction extends CandidateAction {
  type: 'astrogation';
  orders: AstrogationOrder[];
}

interface LabeledCandidate {
  index: number;
  action: CandidateAction;
  label: string;
  reasoning: string;
  risk: RiskTag;
}

interface LegalActionInfo {
  phase: Phase;
  allowedTypes: string[];
  ownShips: unknown[];
  enemies: unknown[];
}

interface WaitForTurnResponse {
  playerId?: 0 | 1;
  candidates?: CandidateAction[];
  labeledCandidates?: LabeledCandidate[];
  recommendedIndex?: number;
  summary?: string;
  legalActionInfo?: Partial<LegalActionInfo>;
  state?: {
    phase?: Phase;
    turnNumber?: number;
    activePlayer?: 0 | 1;
  };
}

interface QuickMatchConnectResponse {
  sessionId: string;
  code: string;
}

interface SendActionResponse {
  accepted: boolean | null;
  pending?: boolean;
  reason?: string;
  message?: string;
}

interface GetStateResponse {
  state?: {
    outcome?: unknown;
  } | null;
}

const fetchJson = async <T>(
  tool: ToolName,
  arguments_: Record<string, unknown>,
): Promise<T> => {
  const res = await fetch(DEFAULT_MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, arguments: arguments_ }),
  });
  const body = (await res.text()).trim();
  if (!res.ok) {
    throw new Error(`MCP ${tool} failed: HTTP ${res.status} ${body}`);
  }
  return JSON.parse(body) as T;
};

const parseTurnFromSummary = (summary: string | undefined): number | null => {
  if (!summary) return null;
  // Example: "Turn 2, Phase: astrogation"
  const m = summary.match(/Turn\s+(\d+),\s*Phase:/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const asArray = <T>(v: unknown): T[] => {
  if (!Array.isArray(v)) return [];
  return v as T[];
};

const pickSkipAction = (
  candidates: CandidateAction[],
  skipType: string,
): CandidateAction => {
  return (
    candidates.find((c) => c.type === skipType) ??
    candidates[0] ?? { type: skipType }
  );
};

const chooseAstrogationCandidateIndex = (
  observation: WaitForTurnResponse,
  agentIndex: number,
): number => {
  const candidates = asArray<CandidateAction>(observation.candidates);
  const labeled = asArray<LabeledCandidate>(observation.labeledCandidates);
  const rawRecommendedIndex = observation.recommendedIndex;
  const recommendedIndex =
    typeof rawRecommendedIndex === 'number' &&
    Number.isInteger(rawRecommendedIndex)
      ? rawRecommendedIndex
      : 0;

  const astros = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === 'astrogation');
  if (astros.length === 0) {
    return Math.max(0, Math.min(recommendedIndex, candidates.length - 1));
  }

  // Diversity: some agents prefer alternatives when risk-tag says "low".
  const labeledByIndex = new Map<number, LabeledCandidate>();
  for (const item of labeled) labeledByIndex.set(item.index, item);

  const ranked = astros
    .map(({ c, i }) => {
      const label = labeledByIndex.get(i);
      const risk = label?.risk ?? 'medium';

      const ast = c as AstrogationAction;
      const orders = Array.isArray(ast.orders) ? ast.orders : [];

      // Small heuristic: prefer at least one burn (not pure coasting).
      const hasBurn = orders.some((o) => o.burn !== null);
      const overloadCount = orders.filter((o) => o.overload !== null).length;

      return {
        i,
        risk,
        hasBurn,
        overloadCount,
      };
    })
    .sort((a, b) => {
      const riskWeight = (r: RiskTag) =>
        r === 'low' ? 0 : r === 'medium' ? 1 : 2;
      // Lower risk first; then burn presence; then fewer overloads; then recommendedIndex tie-break.
      const dw = riskWeight(a.risk) - riskWeight(b.risk);
      if (dw !== 0) return dw;
      if (a.hasBurn !== b.hasBurn) return a.hasBurn ? -1 : 1;
      if (a.overloadCount !== b.overloadCount)
        return a.overloadCount - b.overloadCount;
      return a.i === recommendedIndex
        ? -1
        : b.i === recommendedIndex
          ? 1
          : a.i - b.i;
    });

  if (agentIndex % 3 === 0) return ranked[0].i;

  // Others: pick second-best if it's also low risk; otherwise recommended.
  const second = ranked[1] ?? null;
  const riskWeight = (r: RiskTag) => (r === 'low' ? 0 : r === 'medium' ? 1 : 2);
  if (second && riskWeight(second.risk) === 0) return second.i;
  return Math.max(0, Math.min(recommendedIndex, candidates.length - 1));
};

const coerceWinner = (outcome: unknown): 0 | 1 | null => {
  if (outcome === 0 || outcome === 1) return outcome;
  if (typeof outcome !== 'object' || outcome === null) return null;
  const winner = (outcome as { winner?: unknown }).winner;
  if (winner === 0 || winner === 1) return winner;
  return null;
};

const coerceOutcomeReason = (outcome: unknown): string | null => {
  if (typeof outcome !== 'object' || outcome === null) return null;
  const outcomeObj = outcome as {
    reason?: unknown;
    reasonText?: unknown;
    details?: unknown;
  };
  const r =
    outcomeObj.reason ?? outcomeObj.reasonText ?? outcomeObj.details ?? null;
  return typeof r === 'string' ? r : null;
};

const runOneSession = async (
  sessionIndex: number,
): Promise<{
  sessionId: string;
  code: string;
  winner: 0 | 1 | null;
  seatPlayerId: 0 | 1 | null;
  won: boolean | null;
  endedReason: string;
  outcomeReason: string | null;
  maxAstroTurnSeen: number;
  issues: string[];
}> => {
  const username = `${USERNAME_PREFIX}-${String(sessionIndex).padStart(2, '0')}`;
  const issues: string[] = [];

  const connectArgs: QuickMatchConnectArgs = {
    serverUrl: SERVER_URL,
    scenario: SCENARIO,
    username,
  };

  const connect = await fetchJson<QuickMatchConnectResponse>(
    'delta_v_quick_match_connect',
    connectArgs as unknown as Record<string, unknown>,
  );
  const sessionId = String(connect.sessionId);
  const code = String(connect.code);

  // Keep the test deterministic-ish: no chat.

  let endedReason = 'max turns';
  let astroTurns = 0;
  let finalWinner: 0 | 1 | null = null;
  let finalState: GetStateResponse | null = null;
  let seatPlayerId: 0 | 1 | null = null;
  let outcomeReason: string | null = null;

  try {
    while (astroTurns < MAX_ASTRO_TURNS) {
      const obs = await fetchJson<WaitForTurnResponse>(
        'delta_v_wait_for_turn',
        {
          sessionId,
          timeoutMs: TURN_TIMEOUT_MS,
          includeSummary: true,
          includeLegalActionInfo: true,
          includeTactical: false,
          includeSpatialGrid: false,
          includeCandidateLabels: true,
        } satisfies WaitForTurnArgs,
      );

      const legalPhase =
        typeof obs.legalActionInfo?.phase === 'string'
          ? obs.legalActionInfo.phase.toLowerCase()
          : '';
      const summary = typeof obs.summary === 'string' ? obs.summary : '';
      const turn = parseTurnFromSummary(summary);
      if (seatPlayerId === null && (obs.playerId === 0 || obs.playerId === 1)) {
        seatPlayerId = obs.playerId;
      }
      if (legalPhase === 'astrogation' && turn != null)
        astroTurns = Math.max(astroTurns, turn);

      if (!legalPhase || legalPhase === 'waiting') {
        // Safety: if for some reason we receive non-actionable state, stop.
        issues.push(
          `Unexpected phase from wait_for_turn: "${legalPhase}" (summary: ${summary.slice(0, 80)}...)`,
        );
        break;
      }

      const candidates = asArray<CandidateAction>(obs.candidates);
      const rawRecommendedIndex = obs.recommendedIndex;
      const recommendedIndex =
        typeof rawRecommendedIndex === 'number' &&
        Number.isInteger(rawRecommendedIndex)
          ? rawRecommendedIndex
          : 0;
      const allowedTypes = asArray<string>(obs.legalActionInfo?.allowedTypes);

      let action: CandidateAction | null = null;
      if (legalPhase === 'fleetbuilding') {
        action =
          candidates.find((c) => c.type === 'fleetReady') ??
          candidates[recommendedIndex] ??
          null;
        if (!action) issues.push('No fleetReady candidate found');
      } else if (legalPhase === 'astrogation') {
        const chosenIndex = chooseAstrogationCandidateIndex(obs, sessionIndex);
        action =
          candidates[chosenIndex] ?? candidates[recommendedIndex] ?? null;
        if (!action || action.type !== 'astrogation') {
          issues.push(
            `Astrogation action mismatch: chosen action type = ${action?.type}`,
          );
        }
      } else if (legalPhase === 'ordnance') {
        action =
          candidates[recommendedIndex] ??
          pickSkipAction(candidates, 'skipOrdnance');
      } else if (legalPhase === 'combat') {
        action =
          candidates[recommendedIndex] ??
          pickSkipAction(candidates, 'skipCombat');
      } else if (legalPhase === 'logistics') {
        action =
          candidates[recommendedIndex] ??
          pickSkipAction(candidates, 'skipLogistics');
      } else {
        issues.push(
          `Unhandled legal phase: ${legalPhase} (summary: ${summary.slice(
            0,
            100,
          )}...)`,
        );
        break;
      }

      if (!action) {
        issues.push(`No action selected for phase=${legalPhase}`);
        break;
      }

      if (allowedTypes.length > 0 && !allowedTypes.includes(action.type)) {
        issues.push(
          `Chosen action not in allowedTypes for phase=${legalPhase}: actionType=${action.type} allowed=${allowedTypes.join(
            ',',
          )}`,
        );
      }

      const send = await fetchJson<SendActionResponse>('delta_v_send_action', {
        sessionId,
        action,
        waitForResult: true,
        waitTimeoutMs: 10_000,
        includeNextObservation: false,
      } satisfies SendActionArgs);

      if (send.accepted === false) {
        issues.push(
          `Action rejected: ${action.type} (reason: ${send.reason ?? 'unknown'})`,
        );
        // Retry once using recommendedIndex candidate if possible.
        if (legalPhase === 'astrogation') {
          const retryAction = candidates[recommendedIndex];
          if (retryAction && retryAction.type === 'astrogation') {
            await fetchJson<SendActionResponse>('delta_v_send_action', {
              sessionId,
              action: retryAction,
              waitForResult: true,
              waitTimeoutMs: 10_000,
            } satisfies SendActionArgs);
          }
        }
      } else if (send.accepted === null && send.pending) {
        // Pending is fine in simultaneous phases; we keep looping.
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('reached gameOver before becoming actionable')) {
      endedReason = 'gameOver';
    } else {
      endedReason = `exception: ${msg}`;
      issues.push(endedReason);
    }
  } finally {
    try {
      // Read state before closing so delta_v_get_state can still resolve.
      if (finalState === null) {
        try {
          finalState = await fetchJson<GetStateResponse>('delta_v_get_state', {
            sessionId,
          });
        } catch (e) {
          const emsg = e instanceof Error ? e.message : String(e);
          issues.push(`get_state failed (before close): ${emsg}`);
        }
      }
      const outcome =
        finalState?.state && typeof finalState.state === 'object'
          ? (finalState.state as { outcome?: unknown }).outcome
          : undefined;
      finalWinner = coerceWinner(outcome);
      outcomeReason = coerceOutcomeReason(outcome);

      await fetchJson('delta_v_close_session', { sessionId });
    } catch {
      // ignore
    }
  }

  const won = seatPlayerId === null ? null : seatPlayerId === finalWinner;

  return {
    sessionId,
    code,
    winner: finalWinner,
    seatPlayerId,
    won,
    endedReason,
    outcomeReason,
    maxAstroTurnSeen: astroTurns,
    issues,
  };
};

const main = async () => {
  const agentCount = Math.max(2, AGENTS);

  const sessions = await Promise.all(
    Array.from({ length: agentCount }).map((_, i) =>
      runOneSession(i).catch((e) => ({
        sessionId: 'unknown',
        code: 'unknown',
        winner: null,
        seatPlayerId: null,
        won: null,
        endedReason: `runOneSession failed: ${e?.message ?? String(e)}`,
        outcomeReason: null,
        maxAstroTurnSeen: 0,
        issues: [`runOneSession failed: ${e?.message ?? String(e)}`],
      })),
    ),
  );

  const issues: string[] = [];
  for (const s of sessions) {
    issues.push(...s.issues.map((x) => `[${s.sessionId}] ${x}`));
  }

  // Print a concise harness summary for the agent conversation to parse.
  const wins = sessions.map((s) => s.winner).filter((w) => w !== null);
  const winCount = sessions.filter((s) => s.won === true).length;
  const decidedCount = sessions.filter((s) => s.won !== null).length;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        agents: sessions.length,
        sampleWinners: wins.slice(0, 6),
        decidedAgents: decidedCount,
        winCount,
        totalIssues: issues.length,
        issues,
        sessions: sessions.map((s) => ({
          code: s.code,
          sessionId: s.sessionId,
          playerId: s.seatPlayerId ?? null,
          won: s.won,
          winner: s.winner,
          endedReason: s.endedReason,
          outcomeReason: s.outcomeReason,
          maxAstroTurnSeen: s.maxAstroTurnSeen,
          issues: s.issues,
        })),
      },
      null,
      2,
    ),
  );
};

void main();
