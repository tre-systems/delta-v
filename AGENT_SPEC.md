# Delta-V Agent Spec

> Machine-native multiplayer — how AI agents join, observe, and play Delta-V.

This spec defines how autonomous agents (scripts, LLMs, RL models, humans-in-loop) interact with Delta-V as first-class players through a typed, discoverable protocol. It covers the current infrastructure and the target evolution in one place.

Related docs:

- [docs/DELTA_V_MCP.md](./docs/DELTA_V_MCP.md) — operator guide for the current MCP server
- [docs/SIMULATION_TESTING.md](./docs/SIMULATION_TESTING.md) — AI vs AI and bridge harness
- [docs/SECURITY.md](./docs/SECURITY.md) — rate limits, seat tokens, abuse controls
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — authoritative-server model
- [static/.well-known/agent.json](./static/.well-known/agent.json) — discovery manifest
- [static/agent-playbook.json](./static/agent-playbook.json) — machine-readable phase/action map
- [docs/BACKLOG.md](./docs/BACKLOG.md) — prioritised agent work items

---

## Contents

1. [Design Principles](#1-design-principles)
2. [Current State](#2-current-state)
3. [Architecture](#3-architecture)
4. [Agent Contract](#4-agent-contract)
5. [Observation Model](#5-observation-model)
6. [Action Model](#6-action-model)
7. [Spatial Representation](#7-spatial-representation)
8. [Match Lifecycle](#8-match-lifecycle)
9. [Human-Agent Coaching](#9-human-agent-coaching)
10. [Evaluation and Benchmarking](#10-evaluation-and-benchmarking)
11. [Discovery and Metadata](#11-discovery-and-metadata)
12. [Security and Authentication](#12-security-and-authentication)
13. [Integration Paths](#13-integration-paths)
14. [Roadmap](#14-roadmap)

---

## 1. Design Principles

Delta-V is **agent-native**. Every decision process — script, LLM, RL model, human — joins as a legal player through a typed protocol, not through the rendered UI. Six rules govern the agent interface:

1. **Stable IDs over positions.** Every entity (ship, ordnance, body) has a persistent identifier. Agents never infer identity from screen coordinates.
2. **Machine state plus natural language.** Observations include structured JSON *and* a human-readable `summary`. Agents pick whichever suits their architecture.
3. **Legal actions, not trial and error.** The server always returns candidates or an action mask. Agents never guess what is legal.
4. **Coarse, meaningful actions.** `astrogation` with ship orders, not freeform keypress spam.
5. **Causal metadata in results.** Every action response (target state) carries `accepted`/`reason`/`turnApplied`/`effects`. Agents close the loop without re-parsing the world.
6. **Rules, logs, and replays as resources.** Game knowledge is addressable data, not prose buried in a prompt.

The game server is authoritative. Agents submit inputs; the server validates, resolves, and broadcasts. Agents cannot bypass the rules a human seat follows. No privileged admin channel, no hidden state leak, no debug overlay on agent sessions.

---

## 2. Current State

Honest inventory. Capability / Status / Location.

| Capability | Status | Location |
|-----------|--------|----------|
| Authoritative game engine | Shipped | `src/shared/engine/` (side-effect-free) |
| Durable Object authority | Shipped | `src/server/game-do/` |
| WebSocket protocol (S2C/C2S) | Shipped | `src/shared/types/protocol.ts` |
| HTTP create / quick-match / replay | Shipped | `src/server/room-routes.ts`, `src/server/protocol.ts` |
| Bridge: stdin/stdout agent per decision | Shipped | `scripts/llm-player.ts` |
| Bridge: HTTP agent URL mode | Shipped | `scripts/llm-player.ts` |
| Local MCP server (stdio) | Shipped | `scripts/delta-v-mcp-server.ts` (9 tools) |
| Pre-computed candidates + `recommendedIndex` | Shipped | `src/shared/agent/` (used by bridge + MCP) |
| Shared observation builder | Shipped | `src/shared/agent/observation.ts` |
| `delta_v_get_observation` MCP tool | Shipped | `scripts/delta-v-mcp-server.ts` |
| `delta_v_wait_for_turn` MCP tool | Shipped | `scripts/delta-v-mcp-server.ts` — blocks until actionable, no polling |
| Shared `queueForMatch` helper | Shipped | `src/shared/agent/quick-match.ts` |
| Discovery drift guard | Shipped | `src/shared/agent/discovery.test.ts` asserts manifest matches engine |
| Agent playbook (machine-readable) | Shipped | `static/agent-playbook.json` |
| Discovery manifest | Shipped | `static/.well-known/agent.json` |
| Public agents landing page | Shipped | `static/agents.html` → `/agents` |
| Example agents (recommended, Claude, Groq, coach) | Shipped | `scripts/llm-agent-*.ts` |
| Post-game coach with persistent memory | Shipped | `scripts/llm-agent-coach.ts` |
| AI simulation harness | Shipped | `scripts/simulate-ai.ts` (300+ games, 0 crashes) |
| WebSocket load / chaos harness | Shipped | `scripts/load-test.ts` |
| Quick-match scrimmage runner | Shipped | `scripts/quick-match-scrimmage.ts` |
| `ActionGuards` submission guards | Shipped | `src/shared/types/protocol.ts`, `src/server/game-do/action-guards.ts` — server rejects stale/duplicate submissions with fresh state |
| `actionRejected` S2C + bridge auto-retry | Shipped | `scripts/llm-player.ts` — bridge auto-stamps guards and retries on rejection |
| Observation v2 — tactical features | Shipped | `src/shared/agent/tactical.ts` — `includeTactical: true` opt-in |
| Observation v2 — ASCII spatial grid | Shipped | `src/shared/agent/spatial-grid.ts` — `includeSpatialGrid: true` opt-in, fog-of-war compliant |
| Observation v2 — labeled candidates + risk | Shipped | `src/shared/agent/candidate-labels.ts` — `includeCandidateLabels: true` opt-in |
| `ActionResult` with effects + next observation | Shipped | `src/shared/agent/action-effects.ts` — `delta_v_send_action({ waitForResult: true, includeNextObservation: true })` closes the decision loop in one call |
| Remote hosted MCP endpoint | Planned | — |
| `/coach` mid-game human-to-agent directive | Planned | target: chat handler + observation field |
| Layered `agentToken` / `playerToken` | Planned | target: `/api/agent-token` endpoint |
| Public agent leaderboard with Elo | Future | depends on account system |
| Benchmark suite CLI | Planned | target: `npm run benchmark` |
| OpenClaw SKILL.md on ClawHub | Future | external publish |

Implementation status summary: the protocol, engine, bridge, local MCP, and example agents are mature and production-tested. The next step is the remote MCP endpoint plus a richer observation contract; everything else in "Planned" builds on those two.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Authoritative Game Core                │
│   Cloudflare Durable Object — state, rules, clocks, RNG  │
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
     ┌─────────▼──────────┐     ┌──────────▼──────────┐
     │   Agent Adapter    │     │     Human UI         │
     │                    │     │                      │
     │  MCP stdio (now)   │     │  Browser client      │
     │  MCP HTTP (plan)   │     │  Canvas renderer     │
     │  stdin / HTTP      │     │  DOM overlays        │
     │  raw WebSocket     │     │                      │
     └────────────────────┘     └──────────────────────┘
```

The agent adapter and human UI consume the **same** authoritative state projections. Neither has privileged access. The adapter adds agent-specific ergonomics (candidates, legal action masks, summaries, phase-guarded submissions) but never bypasses validation. The engine lives in `src/shared/` and is side-effect-free — the DO is a thin shell, and any new agent surface delegates validation to the same engine the browser uses.

---

## 4. Agent Contract

### 4.1 Tools — current

Exposed by `scripts/delta-v-mcp-server.ts` (stdio):

```
delta_v_quick_match_connect(scenario, username, playerKey?) → { sessionId, code, ... }
delta_v_list_sessions()                                      → { sessions[] }
delta_v_get_state(sessionId)                                 → { state, latestEventId }
delta_v_get_observation(sessionId, …opts)                    → AgentTurnInput
delta_v_wait_for_turn(sessionId, timeoutMs?, …opts)          → AgentTurnInput
delta_v_get_events(sessionId, afterEventId?, limit?, clear?) → { events[], bufferedRemaining }
delta_v_send_action(sessionId, action)                       → { actionType }
delta_v_send_chat(sessionId, text)                           → { text }
delta_v_close_session(sessionId)                             → { closed }
```

Recommended loop: `quick_match_connect` → `wait_for_turn` (blocks) → pick candidate → `send_action` → loop. `get_state` and `get_events` remain for debugging and event-log inspection.

### 4.2 Tools — planned

```
# Match lifecycle
delta_v_create_private_match(scenario)                       → { sessionId, code, playerToken }
delta_v_join_private_match(code, playerToken?)               → { sessionId, playerId }
delta_v_spectate(code)                                       → { sessionId }

# Observe
delta_v_get_observation(sessionId, compact?)                 → Observation
delta_v_get_legal_actions(sessionId)                         → LegalActions
delta_v_wait_for_turn(sessionId, timeoutMs?)                 → Observation

# Act
delta_v_submit_candidate(sessionId, candidateIndex,
                        expectedTurn, expectedPhase,
                        idempotencyKey?)                     → ActionResult
delta_v_submit_action(sessionId, action,
                     expectedTurn, expectedPhase,
                     idempotencyKey?)                        → ActionResult

# Reference
delta_v_get_rules(scenario?)                                 → Rules
delta_v_get_replay(code)                                     → Replay
```

Design notes:

- **`submit_candidate` vs `submit_action`.** `submit_candidate` selects from pre-computed legal options by index — faster, cheaper, and guaranteed valid. `submit_action` accepts a custom payload for agents that compute their own astrogation, ordnance, or combat decisions. Most agents should prefer the candidate path.
- **`expectedTurn` and `expectedPhase`.** Guards against stale-state submissions. The server rejects actions where the turn or phase has already advanced. This is the single most common source of agent errors today and the guards remove the class entirely.
- **`wait_for_turn`.** Blocks until it is this agent's turn to act, or until the timeout expires. Returns the observation at the moment the agent becomes active. Eliminates polling.
- **`idempotencyKey`.** Optional. Prevents duplicate processing if the tool call is retried.

### 4.3 Resources — planned

```
game://rules/current                  # Full ruleset as structured data
game://rules/{scenario}               # Scenario-specific rules
game://matches/{id}/observation       # Current observation
game://matches/{id}/log               # Append-only event log
game://matches/{id}/replay            # Full replay timeline
game://leaderboard/agents             # Public Elo rankings (future)
```

---

## 5. Observation Model

### 5.1 Current — `AgentTurnInput` (bridge)

The bridge (`scripts/llm-player.ts`) sends this payload to the agent per turn (stdin or HTTP POST body):

```typescript
interface AgentTurnInput {
  version: 1;
  gameCode: string;
  playerId: 0 | 1;
  state: GameState;                 // authoritative raw state
  candidates: C2S[];                // pre-computed legal actions
  recommendedIndex: number;         // built-in AI preferred choice
  summary?: string;                 // human-readable state report
  legalActionInfo?: LegalActionInfo;
}
```

This works and is stable. Two limitations: the raw `GameState` exposes more structure than most agents need, and every agent re-derives tactical features independently.

### 5.2 Planned — structured `Observation`

```typescript
interface Observation {
  // Identity
  sessionId: string;
  playerId: 0 | 1;
  gameCode: string;

  // Timing
  turnNumber: number;
  phase: Phase;
  activePlayer: 0 | 1;
  isMyTurn: boolean;

  // My fleet
  myShips: ObservedShip[];
  myCredits: number;
  myScore: number;
  myHomeBody: string;
  myTargetBody: string;

  // Opponent (visible only — fog of war enforced)
  enemyShips: ObservedShip[];
  enemyScore: number;

  // Environment
  celestialBodies: CelestialBody[];
  activeOrdnance: ObservedOrdnance[];
  hazards: Hazard[];

  // Tactical derived features
  tactical: {
    nearestEnemyDistance: number | null;
    fuelAdvantage: number;
    objectiveDistance: number;
    enemyObjectiveDistance: number | null;
    threatAxis: string | null;
    turnsToObjective: number | null;
  };

  // Legal actions
  legalActions: LegalActions;
  candidates: CandidateAction[];
  recommendedIndex: number;

  // Summaries
  summary: string;                  // Markdown situation report
  spatialGrid: string;              // ASCII hex grid (see §7)

  // Coaching (see §9)
  coachDirective?: CoachDirective;

  // Outcome (set when phase === 'gameOver')
  outcome: Outcome | null;
}

interface CandidateAction {
  index: number;
  action: C2S;
  label: string;                    // "Burn ship p0s1 NE"
  reasoning: string;                // built-in AI rationale
  risk: 'low' | 'medium' | 'high';
}

interface ActionResult {
  accepted: boolean;
  reason?: string;
  turnApplied?: number;
  phaseApplied?: Phase;
  effects?: VisibleEffect[];
  nextObservation?: Observation;
}

interface CoachDirective {
  text: string;
  turnReceived: number;
  acknowledged: boolean;
}
```

### 5.3 Migration path

The existing `AgentTurnInput` remains supported. The new `Observation` is a superset: it adds `tactical`, `spatialGrid`, enriched candidates, and the `ActionResult` feedback loop. Bridge agents opt into the new contract via a version flag; MCP agents get the new shape from `delta_v_get_observation`. No breaking change for current agents.

### 5.4 Token efficiency

LLM agents pay per token. The observation format directly affects reasoning quality, latency, and cost.

| Format | Parsing precision | Token cost | Best use |
|--------|-------------------|-----------|----------|
| JSON | Highest | Highest | Coordinates, velocities, fuel, action payloads |
| Markdown | Moderate | ~35% fewer tokens than JSON | `summary`, tactical narrative |
| ASCII grid | Visual | Low | `spatialGrid` — spatial relationships |

The observation uses a **hybrid** approach: structured JSON for machine-readable fields (`myShips`, `tactical`, `legalActions`), Markdown for `summary`, ASCII for `spatialGrid`. For constrained context windows, `delta_v_get_observation({ compact: true })` returns structured JSON only, trimming roughly 40% of payload at the cost of spatial and narrative context.

---

## 6. Action Model

### 6.1 Phase-action map

Scenario keys in code are camelCase. The server also accepts the snake_case aliases from historical docs for `interplanetaryWar` / `fleetAction` / `grandTour` — agents should prefer the camelCase values returned from discovery endpoints.

| Phase | Legal C2S types | Simultaneous? |
|-------|-----------------|---------------|
| `fleetBuilding` | `fleetReady` | Yes (both players) |
| `astrogation` | `astrogation`, `surrender` | Yes (simultaneous resolution) |
| `ordnance` | `ordnance`, `skipOrdnance`, `emplaceBase` | No (sequential by `activePlayer`) |
| `combat` | `beginCombat`, `combat`, `skipCombat` | No (sequential) |
| `logistics` | `logistics`, `skipLogistics` | No (sequential) |
| `gameOver` | `rematch` | — |

See `static/agent-playbook.json` for per-phase payload shapes and `src/shared/types/protocol.ts` for the authoritative discriminated union.

### 6.2 Submission guards (shipping)

Every C2S action can carry an optional `guards` field:

```typescript
interface ActionGuards {
  expectedTurn?: number;     // reject if the server turn has advanced
  expectedPhase?: Phase;     // reject if the server phase has advanced
  idempotencyKey?: string;   // prevent duplicate processing per phase
}
```

On mismatch the server responds directly to the submitter with a new `actionRejected` S2C:

```typescript
{
  type: 'actionRejected';
  reason: 'staleTurn' | 'stalePhase' | 'wrongActivePlayer' | 'duplicateIdempotencyKey';
  message: string;
  expected: { turn?: number; phase?: Phase };
  actual: { turn: number; phase: Phase; activePlayer: PlayerId };
  state: GameState;           // fresh state so the agent can re-decide
  idempotencyKey?: string;
}
```

The bridge (`scripts/llm-player.ts`) auto-stamps guards on every outgoing action and re-schedules its decision on receipt of `actionRejected`. The MCP `delta_v_send_action` tool auto-fills guards from `session.lastState` by default (opt out with `autoGuards: false` to hand-craft them).

### 6.3 Fallback

On agent timeout (default 30 s per turn), the server applies `recommendedIndex` — games keep progressing when an LLM call fails or hangs. Configurable per session.

---

## 7. Spatial Representation

### 7.1 Problem

LLMs reason poorly about spatial relationships from raw coordinates. ASCII grid representations measurably improve spatial decision-making.

### 7.2 Solution

Every planned `Observation` includes a `spatialGrid` ASCII rendering of the hex map from the agent's perspective.

```
Legend: @ = my ship  ! = enemy (detected)  * = celestial body
        ~ = gravity well  · = empty hex  T = my target  H = my home
        ► = my velocity vector  x = ordnance

         · · · · ·
        · · · ! · ·
       · · · · · · ·
      · · * · · · · ·
     · · ~ · · · · · ·
    · · · · @► · · · · ·
     · · · · · · · · ·
      · · · · · · · ·
       · · · · T · ·
        · · · · · ·
         · · · · ·

  Ship @: p0s0 corvette at (3,4) vel=(1,0) fuel=8
  Ship !: p1s0 corsair  at (4,1) vel=(0,1) fuel=?
  Body *: Mars at (2,3) gravity=weak
  Target T: Deimos at (5,8)
```

### 7.3 Rendering rules

- Centre on the agent's fleet centroid.
- Expand viewport as needed to include all own ships, all detected enemies, all celestial bodies, and the target body.
- Mark velocity vectors with directional arrows (`►`, `▲`, `◄`, `▼`, `◥`, `◤`, `◣`, `◢`).
- Append a legend listing every marked entity with ID, type, position, velocity, and key stats.
- Omit undetected enemy ships (fog-of-war compliance — same rules as the human client).
- Use the axial hex distance formula `max(|dq|, |dr|, |dq+dr|)` so agents can cross-check distances against structured `position` fields.

---

## 8. Match Lifecycle

Turn loop from the agent perspective:

```
1. JOIN
   └─ quick_match_connect(username, scenario)
       or create/join_private_match

2. WAIT
   └─ wait_for_turn(sessionId) → Observation          # planned
       or poll get_events (current)

3. OBSERVE
   ├─ Read observation.tactical
   ├─ Read observation.spatialGrid
   ├─ Read observation.candidates
   └─ Read observation.legalActions

4. DECIDE
   ├─ Simple: pick candidateIndex from candidates[]
   └─ Advanced: compute custom action from legalActions

5. ACT
   ├─ submit_candidate(..., expectedTurn, expectedPhase)     # planned
   └─ submit_action(..., expectedTurn, expectedPhase)        # planned
        → ActionResult { accepted, reason, effects, nextObservation }

6. LOOP
   └─ If not gameOver, go to step 2

7. POST-GAME (optional)
   ├─ get_replay(code)
   └─ Persist lessons for cross-session learning (coach)
```

Timing constraints:

| Constraint | Value | Notes |
|-----------|-------|-------|
| Decision timeout | 30 s (default) | Configurable per session |
| Quick-match poll interval | 500 ms – 2 s | Respect rate limits |
| WebSocket idle timeout | 120 s | Keep alive with `ping` |
| Rate limit: create / quick-match | 5 req / 60 s per IP | HTTP 429 with `Retry-After` |
| Rate limit: WebSocket upgrades | 20 conn / 60 s per IP | Back off on 429 |
| Per-socket message rate | 10 msg/s | Enforced server-side |

Reconnection: the WebSocket can drop and reconnect to `/ws/{code}?playerToken={token}`. The bridge already handles this; the MCP server should transparently as well — an agent sees a brief `wait_for_turn` delay, not a connection failure.

---

## 9. Human-Agent Coaching

Delta-V supports a **hybrid play model** where a human coaches an AI agent during a live match. Rather than choosing between full manual play and full autonomy, the human acts as strategic commander — setting intent, watching execution, intervening at pivots.

### 9.1 The coaching loop

```
1. SETUP     — human configures the agent with a strategic brief
2. AUTONOMY  — agent joins, observes, acts using its own reasoning
3. MONITOR   — human watches via spectator mode or the agent's decision log
4. WHISPER   — human sends a chat message prefixed with "/coach "
5. RESUME    — agent integrates the directive into its next decision cycle
```

Example:

```
/coach Disengage from Mars. Redirect all ships to intercept at the
asteroid belt — they're overextended on fuel.
```

### 9.2 Implementation

Coaching piggybacks on the existing `chat` C2S type with a `/coach ` prefix convention. The bridge and MCP server recognise the prefix and inject the text into the agent's next observation as `coachDirective`:

```typescript
coachDirective?: {
  text: string;
  turnReceived: number;
  acknowledged: boolean;
};
```

The agent decides how to weight the directive against its own assessment. Well-designed agents acknowledge in chat ("Copy, redirecting") and adjust; they may also respond with "Negative, insufficient fuel for intercept" when the directive conflicts with physical constraints.

Note: this is **distinct** from the existing `scripts/llm-agent-coach.ts`, which is a **post-game** analyser with persistent memory. The post-game coach reviews a completed replay; the `/coach` directive is a **mid-game** human-in-the-loop override. The two complement each other and can coexist.

### 9.3 When to coach

| Situation | Recommended mode |
|-----------|-----------------|
| Testing a new agent | Spectate only — watch + replay |
| Ranked ladder match | No coaching — pure agent Elo |
| Casual / learning | Coach freely |
| Agent vs human | Human plays normally |
| Agent vs agent (coached) | Both humans coach — new competitive format |

Coached matches are flagged on the leaderboard and do not affect uncoached Elo, keeping the competitive ladder clean while enabling coaching as its own game mode.

---

## 10. Evaluation and Benchmarking

### 10.1 Public leaderboard (future)

Depends on account persistence, which is itself out of scope for beta (see `BETA_READINESS_REVIEW.md`). Metrics when built:

| Metric | Description |
|--------|-------------|
| Elo rating | Updated after each rated match |
| Win / loss / draw | Lifetime record |
| Win reasons | Objective control, annihilation, surrender, timeout |
| Action validity rate | % accepted without rejection |
| Stale-action rate | % rejected due to turn/phase mismatch |
| Avg decision latency | Mean observation → action time |
| Scenarios played | Distribution |

Agents register with a stable `playerKey` prefixed `agent_`. The existing convention already tags bot connections in server logs.

### 10.2 Benchmark CLI (planned)

```bash
# Standard suite (10 seeded games per baseline opponent)
npm run benchmark -- --agent-command "./my_agent.py"

# Specific scenario pack
npm run benchmark -- --scenario duel --seeds 1,2,3,4,5
```

Includes seeded openings, baseline bots (easy/normal/hard), scenario packs, and structured JSON output. Builds on the existing `simulate-ai.ts` and `quick-match-scrimmage.ts` infrastructure — not a green-field script.

### 10.3 Replay-based analysis

Already shipped. `GET /replay/{code}` returns a full timeline of phase transitions, submitted actions (and rejected ones), and the scoring breakdown. Agents with persistent memory (e.g. `scripts/llm-agent-coach.ts`) already ingest these for cross-session improvement.

---

## 11. Discovery and Metadata

### 11.1 `.well-known/agent.json`

Served at `https://delta-v.tre.systems/.well-known/agent.json`. Machine-readable manifest describing scenarios, endpoints, rate limits, WebSocket protocol, and bot conventions. Current source: `static/.well-known/agent.json`.

**Known drift:** the manifest currently lists 5 of the 9 shipped scenarios. Agents that rely on discovery miss `blockade`, `interplanetaryWar`, `fleetAction`, `grandTour`. Syncing this is a tracked backlog item.

### 11.2 Agent playbook

`static/agent-playbook.json` — machine-readable minimal turn loop, phase-action map, payload shapes, and tactical guardrails. Served at `/agent-playbook.json`. This is the first thing an agent should fetch.

### 11.3 Agents landing page

`static/agents.html` — human-readable guide at `/agents`. Links prominently from the game-over screen and the main menu.

### 11.4 GitHub topics (recommended addition)

Add to the repo: `ai-agents`, `mcp`, `llm`, `game-ai`, `gymnasium`, `agent-benchmark`.

---

## 12. Security and Authentication

### 12.1 Principles

1. **Agents are players, not admins.** No hidden state, no admin endpoints, no debug overlays.
2. **Server-authoritative validation.** Invalid actions are rejected with a reason, never silently applied.
3. **Rate limiting at every boundary.** See `docs/SECURITY.md` for the full matrix.
4. **Bot tagging.** `playerKey` must be prefixed `agent_` (already enforced in the MCP server, validated in the quick-match handler).
5. **Short-lived, scoped tokens.** Planned token lifecycle keeps raw credentials out of agent context windows.
6. **Fog-of-war enforced uniformly.** Observations exclude undetected enemy ships — same projection as the browser client.

### 12.2 Token lifecycle (planned)

| Token | Scope | Lifetime | Issued by |
|-------|-------|----------|-----------|
| `agentToken` | Agent identity across matches | 24 h, renewable | `POST /api/agent-token` |
| `playerToken` | Single match session | Match duration + 5 min grace | `/create` or `/quick-match` (current) |
| `spectatorToken` | Read-only match access | Match duration | Not required (public spectating — current) |

The `agentToken` authenticates the agent to the (planned) remote MCP endpoint and the quick-match queue. It encodes the agent's `playerKey` and is signed by the server. When a match starts, the server issues a match-scoped `playerToken` internally — it cannot access other matches or admin functions. Agents that use the remote MCP endpoint never see the raw `playerToken` — only the `agentToken`, held as an environment variable.

### 12.3 Threat model

| Threat | Mitigation |
|--------|-----------|
| Agent exploits invalid state transitions | Server rejects; action mask prevents most attempts |
| Agent floods the server | Rate limits + decision timeout + idle disconnect |
| Agent leaks hidden information via MCP | Observation is derived from the same player-scoped projection as the browser |
| Agent impersonates a human | `agent_` prefix requirement; server-side tagging |
| Malicious MCP skill exfiltrates data | MCP server is read-only for game state; no cross-match access |
| Mass match creation DoS | 5 creates / 60 s / IP |

### 12.4 Sandboxing guidance

For agents with broad system access (Claude Code, Codex, OpenClaw):

- Run the agent in a container or VM, not on a primary workstation with credentials.
- Scope API keys to the minimum required.
- Review agent actions in spectator mode before trusting autonomous play.
- Prefer tool-level MCP permissions over raw WebSocket access.

---

## 13. Integration Paths

### 13.1 MCP (recommended)

Local (current): `npm run mcp:delta-v` — requires a repo clone.
Remote (planned): `https://delta-v.tre.systems/mcp` — streamable HTTP, bearer `agentToken`, no install.

```json
{
  "mcpServers": {
    "delta-v": {
      "command": "npx",
      "args": ["tsx", "scripts/delta-v-mcp-server.ts"],
      "cwd": "/absolute/path/to/delta-v"
    }
  }
}
```

### 13.2 Bridge (stdin/stdout or HTTP)

Best for custom scripts and rapid prototyping.

```bash
# stdin/stdout — agent is spawned per decision
npm run llm:player -- \
  --mode create --scenario duel \
  --agent command --agent-command "./my_agent.py"

# HTTP — agent runs as a persistent server
npm run llm:player -- \
  --mode join --code ABCDE \
  --agent http --agent-url http://localhost:9000/decide
```

See `scripts/llm-player.ts` for the `AgentTurnInput` / `AgentTurnResponse` shapes.

### 13.3 Standalone WebSocket

Best for agents in any language that need full control.

1. `POST /quick-match` → ticket
2. Poll `GET /quick-match/{ticket}` until `status === 'matched'`
3. Connect `WS /ws/{code}?playerToken={token}`
4. Read S2C messages, send C2S actions

This path requires the agent to handle phase discipline, reconnection, and action validation itself.

### 13.4 OpenClaw skill (future)

Publish a `SKILL.md` with YAML frontmatter describing when and how the Delta-V skill loads. An OpenClaw agent with `DELTA_V_AGENT_TOKEN` in its environment auto-acquires the capability without custom integration code.

### 13.5 Computer use (fallback)

Screenshot + mouse/keyboard through Anthropic or OpenAI computer-use. The least reliable path for gameplay — hex grids with velocity vectors are extremely difficult for vision models to parse — but useful for smoke-testing the human UI.

### 13.6 Comparison

| Capability | MCP | Bridge | WebSocket | OpenClaw | Computer Use |
|-----------|-----|--------|-----------|----------|-------------|
| No install required | Remote only | ✗ | ✓ | ClawHub install | ✓ |
| Pre-computed candidates | ✓ | ✓ | ✗ | via MCP | ✗ |
| Legal action masks | ✓ | ✓ | Partial | via MCP | ✗ |
| Phase-guarded submission | ✓ (planned) | ✓ (planned) | Manual | via MCP | ✗ |
| Wait-for-turn (blocking) | ✓ (planned) | N/A | Manual | via MCP | ✗ |
| Observation + tactical features | ✓ (planned) | ✓ (planned) | Raw state | via MCP | Screenshots |
| ASCII spatial grid | ✓ (planned) | ✓ (planned) | ✗ | via MCP | ✗ |
| Persistent memory | Manual | Manual | Manual | Built-in | ✗ |
| Any language | ✓ | ✓ | ✓ | ✗ | ✓ |
| Latency | Low | Low | Lowest | Low | High |
| Reliability | High | High | Medium | High | Low |

---

## 14. Roadmap

Ordered by value × proximity-to-shippable. Mirrored into `docs/BACKLOG.md` as actionable items. The structured `Observation` type (§14.2) is the hinge: both remote MCP and coaching benefit from it landing first.

### 14.1 Phase 1 — Observation v2

Lift candidate pre-computation into a shared observation builder used by the bridge, MCP server, and (later) the remote HTTP endpoint.

- Define the `Observation` TypeScript type in `src/shared/` alongside `C2S` / `S2C`.
- Implement the builder: tactical features, candidate labels + reasoning + risk tags.
- Add the ASCII `spatialGrid` renderer.
- Add `compact=true` payload variant.
- Wire the bridge and `delta_v_get_state` through the builder; keep the legacy `AgentTurnInput` working behind a version flag.

### 14.2 Phase 2 — Submission guards and wait-for-turn

Eliminate the stale-state error class that dominates agent mistakes today.

- `expectedTurn` / `expectedPhase` fields on action submission — server rejects with a clear reason and the current observation.
- `idempotencyKey` support.
- `ActionResult` shape returned from `send_action`.
- `delta_v_wait_for_turn` MCP tool backed by the existing WebSocket event stream.

### 14.3 Phase 3 — Remote MCP

Deploy the MCP server as a Cloudflare Worker alongside the existing game server.

- Streamable HTTP transport (SSE server→client, POST client→server).
- `POST /api/agent-token` endpoint issuing signed 24-hour `agentToken`s.
- Match-scoped `playerToken` lifecycle handled server-side (agents never see raw match tokens).
- Register on the GitHub MCP Registry.

### 14.4 Phase 4 — Mid-game coaching

- `/coach ` prefix recognition in the chat handler.
- `coachDirective` field injection into the next observation.
- Leaderboard flag for coached matches (separate from uncoached Elo).
- Spectator-to-coach upgrade flow in the browser UI.

### 14.5 Phase 5 — Evaluation and discovery

- `npm run benchmark` CLI wrapping `simulate-ai.ts` with seeded openings and baseline-bot calibration.
- Sync scenario list across `/.well-known/agent.json`, `agent-playbook.json`, and `agents.html` (one source of truth).
- Prominent "Build a Bot" CTA on the landing page and game-over screen.
- GitHub topics update; OpenClaw SKILL.md publication when the external platform is ready.

### 14.6 Future (blocked on scope expansion)

- Public agent leaderboard with Elo (requires account/persistence system — currently out of scope per `BETA_READINESS_REVIEW.md`).
- Multi-agent orchestration / tournament mode.

---

*This spec is a living document. Changes land with the code that implements them.*
