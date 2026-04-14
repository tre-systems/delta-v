# Delta-V Backlog

Active work items are listed below in one global priority order.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

---

## Active work

### Observation v2 — add tactical features, spatial grid, candidate labels

**Trigger:** the shared observation builder ships the v1 `AgentTurnInput` shape
but not the richer `Observation` from [AGENT_SPEC.md §5.2](../AGENT_SPEC.md#5-observation-model).

Extend `src/shared/agent/observation.ts` to optionally emit:

- `tactical` derived features (`nearestEnemyDistance`, `fuelAdvantage`, `objectiveDistance`, `enemyObjectiveDistance`, `threatAxis`, `turnsToObjective`)
- `candidates[*].label` / `.reasoning` / `.risk` (the hard AI already produces a natural label; reasoning comes from the underlying `ai/scoring` trace when exposed)
- `spatialGrid: string` — ASCII hex map centred on fleet centroid; directional arrows for velocity; fog-of-war compliant

Add a version flag on the observation so existing bridge agents keep the v1 payload and opt-in to v2.

**Files:** `src/shared/agent/observation.ts`, new `src/shared/agent/spatial-grid.ts`, expose toggle through `delta_v_get_observation` / `delta_v_wait_for_turn`

### `ActionResult` with `effects` and `nextObservation`

**Trigger:** close the agent decision loop without re-fetching the world after every action.

Change `delta_v_send_action` and the bridge reply shape to return `{ accepted, reason?, turnApplied?, phaseApplied?, effects?, nextObservation? }`. `effects` is a short list of visible deltas (ship destroyed, ordnance launched, landing resolved) drawn from the resolution pipeline.

**Files:** `scripts/delta-v-mcp-server.ts`, `scripts/llm-player.ts`, new effects builder in `src/shared/agent/`

### Remote hosted MCP endpoint

**Trigger:** no-clone, no-install agent onboarding from any MCP host.

Deploy a streamable-HTTP MCP server alongside the existing game Worker (SSE server→client, POST client→server). Reuse the observation builder, submission guards, and `wait_for_turn` implementation. The endpoint is a thin adapter over the Durable Object — no duplicated state.

**Files:** `src/server/mcp/` (new), `wrangler.toml` route binding, `src/server/index.ts`

### Layered `agentToken` / `playerToken` lifecycle

**Trigger:** keeps raw match credentials out of agent context windows for the remote MCP path.

Add `POST /api/agent-token` issuing signed 24-hour agent identities. The remote MCP server exchanges the `agentToken` for internal match-scoped `playerToken`s without exposing them. Existing `/create` and `/quick-match` flows stay unchanged for bridge users.

**Files:** `src/server/auth/` (new), MCP endpoint, `docs/SECURITY.md`

### Mid-game `/coach` directive

**Trigger:** hybrid human-in-the-loop play format (see [AGENT_SPEC.md §9](../AGENT_SPEC.md#9-human-agent-coaching)).

Recognise the `/coach ` prefix in the chat handler; inject the text into the target agent's next observation as `coachDirective = { text, turnReceived, acknowledged }`. Agent decides whether to follow. Flag coached matches in future leaderboard metrics so uncoached Elo stays clean.

**Files:** `src/server/game-do/`, observation builder, agents page docs, `scripts/delta-v-mcp-server.ts`

### Benchmark CLI

**Trigger:** reproducible agent evaluation for cross-agent comparison.

Add `npm run benchmark -- --agent-command "..."` wrapping `scripts/simulate-ai.ts` with seeded openings and baseline-bot (easy/normal/hard) calibration opponents. Output structured JSON: win rate, mean turns to victory, fuel efficiency, action validity rate, Elo estimate.

**Files:** `scripts/benchmark.ts` (new), `package.json`

### Agent landing-page CTA

**Trigger:** agent support is invisible from the main game UI.

Link prominently to `/agents` from the main landing page and the game-over screen. Add the GitHub topics (`ai-agents`, `mcp`, `llm`, `game-ai`, `gymnasium`, `agent-benchmark`) for external discovery.

**Files:** `static/index.html`, game-over component in `src/client/`, repo settings

---

## Future features (not currently planned)

These items are potential future work that depend on product decisions or external triggers. They are not in the active queue.

### Public matchmaking with longer room identifiers

**Trigger:** product moves beyond shared short codes.

Implement longer opaque room IDs or signed invites and update the join/share UX accordingly.

**Files:** `src/server/protocol.ts`, lobby and join UI, share-link format

### Trusted HTML sanitizer for user-controlled markup

**Trigger:** chat, player names, or modded scenarios render as HTML.

Add a single sanitizer boundary (e.g. DOMPurify inside `dom.ts`) and route all user-controlled markup through it. The trusted HTML boundary (`setTrustedHTML`) already exists for internal strings.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### WAF or Cloudflare rate limits for join/replay probes

**Trigger:** distributed scans wake durable objects or cost too much.

Baseline per-isolate rate limiting is already shipped (100 combined GET /join + /replay per 60s per IP). Add WAF or `[[ratelimits]]` only if the baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Public agent leaderboard with Elo

**Trigger:** account / persistent-identity system exists.

Depends on accounts (out of scope for beta per `BETA_READINESS_REVIEW.md`). When unblocked, expose Elo, win/loss by reason, action-validity and latency metrics per agent `playerKey`. Flag coached matches separately.

**Files:** `src/server/leaderboard/` (new), new `/leaderboard` route, D1 schema additions

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
