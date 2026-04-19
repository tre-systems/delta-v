# Delta-V Backlog

Outstanding tasks only — **no release log** (use `git log` for shipped work). Recurring review procedures: [REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale: [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

## Gameplay UX & matchmaking integrity

Exploratory live-session notes (2026-04-17) plus UX/a11y review (2026-04-18). Each **###** is **remaining** work only (shipped details live in `git log` and tests).

### Contrast audit (quantified)

Run WCAG contrast / readability measurements each release using [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md) § **Contrast & readability** and [A11Y.md](./A11Y.md); tune CSS from findings.

**Files:** `static/styles/*.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Stronger high-contrast modes

Spot-check remaining HUD / systems chrome if playtesters still see flat contrast. **Done for this slice:** `#scenarioSelect` / `#waiting` panels aligned with `#menu` under **prefers-contrast: more** and **forced-colors**; game-over shell, card, kicker, and replay strip use explicit Canvas/contrast-friendly panels.

**Files:** `static/styles/base.css`, `static/styles/components.css`, `static/styles/hud.css`, `static/styles/overlays.css`, `static/styles/systems.css`

### Tutorial: deepen task-first flow

Spotlight-driven steps and tighter coupling to HUD hints. **Done for this slice:** per-step **Help** opens the overlay and scrolls to the matching rules section.

**Files:** `src/client/tutorial.ts`, `src/client/ui/hud-chrome-view.ts`, `static/index.html`, `static/styles/overlays.css`

### Help overlay: active-section highlighting (optional)

Highlight the section in view on scroll, or collapse long groups with `<details>`.

**Files:** `static/index.html`, `static/styles/overlays.css`, optional small script in `src/client/ui/`

### Enforce notification channel precedence in code

Remaining audit: session UI effects / reactive wiring, telemetry-driven copy, and any logistics paths that still mirror the game log as a toast. Turn timer, local emplacement success, “no enemies” camera hint, and local-only replay now use HUD/sound or the game log instead of stacking toasts. Connection, reconnect, and session errors stay on the toast channel per policy.

**Files:** `src/client/ui/overlay-view.ts`, `src/client/game/session-ui-effects.ts`, `src/client/game/session-signals.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/game/command-router.ts`, `src/client/telemetry.ts`

### Digital-input parity for map selection and targeting

**Done (phase 1):** combat **[`]` / `[`]** cycles eligible enemy ships/nukes (same visibility rules as pointer targeting), updates planning via `cycleCombatTarget` → `setCombatPlan`, centers the camera on the new target, and shows **Target: …** on the HUD status line (desktop hint includes `[ ]`).

**Remaining:** mixed-hex attacker cycling without pointer, richer gamepad binding on the same command path, and other tactical picks still pointer-first.

**Files:** `src/client/game/keyboard.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud.ts`, `static/index.html`

### Burn-arrow tap targets (verification)

Revisit burn/overload hit targets only if playtesting reports misses at very small `hexSize` (picks resolve by neighboring hex cell, not only the painted disk — `resolveBurnToggle` / `resolveOverloadToggle` in `input.ts`).

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/game/input.ts`, `src/client/input-interaction.ts`

---

## AI behavior & rules conformance

Further AI ordnance work vs the [2018 Triplanetary rulebook](../Triplanetary2018.pdf) (pp. 5–6): simulation-backed thresholds, EV refinement, and deeper regression fixtures.

### `recommendedIndex` over-suggests consecutive ordnance launches

Tune candidate thresholds with simulation outcomes (especially scenario-specific target velocities / gravity lanes).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/agent/observation.ts`, `src/shared/agent/candidates.ts`, `src/shared/agent/candidate-labels.ts`

### Tighten Hard-difficulty nuke gates with cost and intercept probability

**Done for this slice:** raised hard `nukeMinReachProbability` and the nuke score floor when a torpedo is also viable so marginal lanes prefer the cheaper weapon; duel-sweep remains the harness for follow-up EV tuning.

**Remaining:** expected-damage refinement beyond current gates, and **`simulate:duel-sweep`**-driven threshold tables tied to measurement runs (rulebook: nuke **300 MCr** vs torpedo **20 MCr**, **2:1** anti-nuke table, detonation on lane contacts).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/engine/combat.ts`

### Add ordnance AI regression fixtures for impossible-shot launches

**Done for this slice:** `evaluateOrdnanceLaunchIntercept` wired to the same open-map drift geometry as the existing impossible-shot ordnance fixtures.

**Remaining:** same-stack edge cases beyond launch-hex stacking, deeper gravity-edge assertions (beyond open-map determinism smoke), optional `game-engine.test.ts` integration seeds.

**Files:** `src/shared/ai.test.ts`, `src/shared/test-helpers.ts`, `src/shared/test-helpers.test.ts`, optional `src/shared/engine/game-engine.test.ts`

---

## Agent & MCP ergonomics

Gaps in local vs hosted MCP parity, first-class resources, and structured rejection surfaces for autonomous play.

### Parallel MCP stdio: host tool pipelining + quick-match pairing

First-class “pair these two tickets” dev hook for automated two-seat stdio without lobby URLs.

**Files:** `scripts/delta-v-mcp-server.ts`, `src/shared/mcp-stdio-serialized-send.ts`, `src/shared/agent/quick-match.ts`, `docs/DELTA_V_MCP.md`

### Unify local and hosted MCP tool surfaces

Hosted MCP: add `delta_v_list_sessions` / `delta_v_get_events` / `delta_v_close_session` parity with local; server-side event buffering for flaky networks.

**Files:** `scripts/delta-v-mcp-server.ts`, `packages/mcp-adapter/src/handlers.ts`, `docs/DELTA_V_MCP.md`, `AGENT_SPEC.md`

### Ship MCP resources: rules, match log, replay

[AGENT_SPEC.md lines 91–96](../AGENT_SPEC.md) now has `game://rules/current` and `game://rules/{scenario}` shipped. Remaining resource work is `game://matches/{id}/observation`, `game://matches/{id}/log`, `game://matches/{id}/replay`, and `game://leaderboard/agents` so agents can fetch live match state, append-only logs, and rankings as first-class resources instead of bespoke tool/HTTP calls.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/delta-v-mcp-server.ts`, `static/.well-known/agent.json`, `src/shared/agent/`

### Structured action-rejection reasons

**Done for this slice:** submitter-only `actionAccepted` now carries `guardStatus: inSync | stalePhaseForgiven` so local MCP, hosted MCP, browser clients, and agent scripts can distinguish forgiven phase drift from fully in-sync submissions without overloading `actionRejected`.

**Remaining:** richer discrimination for engine-level invalidations that still surface as generic `error` today.

**Files:** `src/server/game-do/action-guards.ts`, `src/shared/types/protocol.ts`, `src/shared/protocol.ts`, `scripts/delta-v-mcp-server.ts`, `src/client/game/client-message-plans.ts`

### Live-play friction from 2026-04-18 MCP-vs-browser verification

Four papercuts hit while pairing a local MCP agent against a human browser seat (duel, production server):

- **Misleading `nextPhase` in `send_action` response.** After `skipOrdnance` the close-loop response reported `nextPhase: combat, nextActivePlayer: 1`, but the combat phase auto-resolved (no attackers in range) and the opponent's astrogation slipped in before the agent's follow-up `skipCombat` arrived, producing a `wrongActivePlayer` rejection. Consider flagging likely auto-skip phases in the response (`autoSkipLikely: true`) or surfacing the post-auto-resolution phase so agents can `wait_for_turn` instead of firing a doomed skip.
- **Thin candidate set.** Turn-1 astrogation labelled candidates only offered NE / NE+overload / coast; other directions and fuel-vs-overload trade-offs were invisible without hand-rolling actions. Widen `labeledCandidates` coverage for opening turns.
- **Verbose observations by default.** Local MCP returns the full state blob unless `compactState: true` is passed; flipping the default (or surfacing recommended defaults in the skill) would cut tokens across a full game.

**Files:** `scripts/delta-v-mcp-server.ts`, `packages/mcp-adapter/src/handlers.ts`, `src/shared/agent/`, `src/shared/types/protocol.ts`, `.claude/skills/play/SKILL.md`

### Liveness endpoint payload is unpopulated

`/healthz`, `/health`, `/status` all return 200 with `{"ok":true,"sha":null,"bootedAt":"1970-01-01T00:00:00.000Z"}`. The endpoint shape is right but neither field is populated — `sha` is hard-coded `null` and `bootedAt` is the Unix epoch. Uptime probes that only check `ok:true` will pass; release gates that compare deployed `sha` against the pipeline build will silently always pass. Wire in the actual deploy SHA (`CF_PAGES_COMMIT_SHA` / a build-time env var injected by `esbuild.client.mjs` or the Worker bundler) and stamp `bootedAt` in the Worker module-scope at first import. Bonus: alias decision — three URLs (`/healthz`, `/health`, `/status`) all 200 with the same body; pick one canonical and 301 the others, or document them as supported aliases. Found via R1.

**Files:** `src/server/`, `wrangler.toml`, `esbuild.client.mjs`, `docs/OBSERVABILITY.md`

### Match-isolation flag for automated verification

During exploratory pairing on the production server, an MCP agent and a paired browser seat were split across the public queue — the browser matched a real user instead of the intended MCP partner, making exploratory / regression testing both flaky and user-disruptive. Options: a `delta_v_quick_match_connect({ scenario, rendezvousCode })` mode that pairs only with clients presenting the same short code (bypassing the public queue), a `private: true` flag that puts the ticket in a segregated pool, or a dev-only scenario namespace (e.g. `duel:test`) that never mixes with public queues.

**Files:** `scripts/delta-v-mcp-server.ts`, `packages/mcp-adapter/src/handlers.ts`, `src/server/`, `src/shared/agent/quick-match.ts`

### Public `/api/matches` exposes user-typed usernames

The matches JSON (public, unauthenticated) includes `winnerUsername` / `loserUsername` as the raw callsign the user typed at the lobby. Users entering real names, emails, or personal handles would have those published indefinitely in the public match log. Options: show only the agent playerKey prefix or a hashed handle for non-leaderboard matches, rate-limit per-IP, or warn users at the callsign input that the value will be published. (Pre-launch is the cheapest time to tighten this.)

**Files:** `src/server/`, `static/index.html`, `src/client/ui/` (callsign input warning)

### Retire legacy `{code, playerToken}` tool args once leaderboard stabilises

Hosted MCP tools still accept either `matchToken` or `{code, playerToken}` via `matchTargetSchema` in `packages/mcp-adapter/src/handlers.ts`. Carrying both doubles tool-args surface area and forces every call site to branch on auth mode. Once the public leaderboard is live and all active agents have migrated to `matchToken`, drop the legacy union and simplify the adapter — consistent with the pre-launch-deletions stance elsewhere.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/quick-match-agent.ts`, `scripts/llm-player.ts`, `docs/DELTA_V_MCP.md`

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Baseline controls are documented in [SECURITY.md](./SECURITY.md).

**Still backlog / trigger-gated:** WAF or `[[ratelimits]]` if baseline throttles prove insufficient; Turnstile on human name claim; proof-of-work on bulk agent name claims; spectator delay for serious competition. File hooks sit under [Future features](#future-features-not-currently-planned) where applicable.

### Documented rate limits significantly understate observed protection

Empirical 2026-04-19 (R1 / R2 probe burst from a single client IP, single CF colo LHR):

- `POST /create` — documented **5 / 60 s per IP** (`agent.json` and `wrangler.toml` `CREATE_RATE_LIMITER`); observed **~35 / 60 s** before any 429s. ~7x the published limit.
- `POST /api/agent-token` — documented **5 / 60 s per IP**; observed **0 throttling** in a 12-burst (rate limit code IS called at `src/server/index.ts:356` but never fired in this test).
- `POST /quick-match` — documented **5 / 60 s per IP**; observed first 429 around request 11.

Cloudflare's `[[ratelimits]]` binding is **best-effort and per-edge-colo**, so a single attacker hitting one colo can exceed the published limit; an attacker spread across multiple colos can exceed it by a much larger multiple. The current numbers offer real protection against accidental floods but don't match the documented contract.

Two actions: (1) bring the docs (`agent.json`, `/agents` page, `wrangler.toml` comment) in line with what the binding actually enforces under realistic conditions; (2) for endpoints where strict caps matter (token issuance, room creation), add a second layer using D1 or a Durable Object counter so the global cap is enforceable.

**Files:** `static/.well-known/agent.json`, `wrangler.toml`, `src/server/reporting.ts`, `src/server/index.ts`, `docs/SECURITY.md`

### `POST /create` accepts unknown scenarios and arbitrary payloads

Same gap that was just fixed for the MCP path (`26e6820`) is still wide open on the public Worker handler:

- `{"scenario":"fake_scenario"}` → 200 + valid 5-char code (room is created with engine fall-through behaviour).
- Empty body → 200 + valid code.
- 5 KB scenario string → 200 + valid code.

Combined with the rate-limit gap above, an anonymous client can burn through Durable-Object-create operations rapidly with junk payloads. Wire the same `isValidScenario` check used by the MCP path into `handleCreate`, and add a JSON schema or zod parse to fail closed on missing/oversize bodies (cap at, say, 1 KB). Found via R2.

**Files:** `src/server/index.ts`, `src/server/room-routes.ts`, `src/shared/map-data.ts`

### Server-side `/create` produces no D1 audit trail

Walking `events` after a 50-burst confirmed that **no row is written for `/create` attempts** — only client-emitted telemetry events (`create_game_attempted`, `game_created`, …) reach D1. An attacker hitting `/create` directly from a script bypasses analytics entirely; the only forensic trail is Cloudflare's Worker logs (1 day retention by default for free tier; 7 days persisted with `[observability]`). For incident reconstruction and abuse detection this is a real gap. Insert a server-side `events` row at the rate-limit decision point (with the hashed IP, scenario, success / `rate_limited`) so the analytics pipeline matches the request volume.

**Files:** `src/server/index.ts`, `src/server/reporting.ts`, `docs/OBSERVABILITY.md`

### Orphan room cleanup invisible to operators

A `POST /create` from an unauthenticated client creates a Durable Object that never gets joined. These rooms do not appear in `/api/matches?status=live` (which only counts pairs with a connected second player) and there is no public surface that exposes or counts them. After my probes I had ~24 orphan DOs that I had no way to enumerate or explicitly clean up — the alarm-driven cleanup in `GameDO` is the only sweep. Either expose an admin-only `/api/rooms?status=orphaned` count for monitoring, or document the alarm timer and orphan-eviction policy in [OBSERVABILITY.md](./OBSERVABILITY.md) so operators know what cost they're carrying.

**Files:** `src/server/game-do/`, `src/server/live-registry-do.ts`, `docs/OBSERVABILITY.md`, `docs/SECURITY.md`

### Silent `limit` caps differ across listing endpoints

Observed 2026-04-19:

- `GET /api/leaderboard?limit=99999` → response `limit: 200` (silently capped at 200, no warning).
- `GET /api/matches?limit=99999` → response `limit: 100` (silently capped at 100, no warning).

Two different caps in two endpoints serving similar paginated reads, neither documented in `agent.json`, neither surfaces a `Link: rel=next` or even an explicit `requested_limit` field — the only signal that the request was clamped is the difference between the request and the `limit` field in the response, which most clients won't compare. Either reject `limit > MAX` with 400 like the recent matches-filter fix does for `winner` / `scenario`, or echo the requested value alongside the applied one (e.g. `{ limit: 100, requestedLimit: 99999, capped: true }`). Pick one cap or document why they differ.

**Files:** `src/server/matches-list.ts`, `src/server/leaderboard/`, `static/.well-known/agent.json`

### Loose query validation on `/api/leaderboard`

Same anti-pattern that `7b21301` fixed for `/api/matches` is still present on the leaderboard endpoint: `?limit=-1`, `?limit=abc`, `?includeProvisional=garbage`, and `?ofset=10` (typo) all return 200 with whatever default the server happened to choose. Apply the same `Number.parseInt` + range validation + boolean-or-400 used in `parseFilters` (`src/server/matches-list.ts`) to the leaderboard handler so both share an idiom and clients fail fast on typos.

**Files:** `src/server/leaderboard/`, `src/server/matches-list.ts` (reuse helpers), tests

### `/join/{code}` success response missing documented metadata

`/agents` and `agent.json` describe `GET /join/{code}` as returning "room metadata". Empirically:

- Joinable room → `{ "ok": true }` only — no scenario, no host info, no fleet-building state.
- Unjoinable (in-progress) → rich `{ code: "GAME_IN_PROGRESS", message: ... }`.
- Unknown code → 404.

Either drop the "metadata" claim from the docs or actually return scenario, room creation timestamp, and seat status (`open`, `full`, `host-only`) so a join UI can render the lobby card without reconnecting first.

**Files:** `src/server/room-routes.ts`, `static/.well-known/agent.json`, `static/agents.html`

### Worker logs no entry on auth-failure paths

`POST /mcp` with a bad `Authorization: Bearer …` header and `POST /api/agent-token` with malformed JSON both return helpful structured error bodies but emit **zero `console.log` lines** (verified with `wrangler tail --format json`). Brute-force attempts on token verification or sustained malformed-payload probes would leave no observability trail unless someone happens to look at the Cloudflare request log per-IP. Add a `console.log` (gated behind a sample rate to avoid log spam) on the four-eyes authentication failure paths: invalid agent token, malformed JSON to token endpoints, and rate-limited rejections. These map directly to the abuse signals operators most want to see.

**Files:** `src/server/index.ts`, `src/server/auth/`, `src/server/reporting.ts`, `docs/OBSERVABILITY.md`

### Validation/error-shape inconsistency across public POST endpoints

Quality varies wildly:

- `/api/claim-name` → structured JSON with explanatory messages, e.g. `{"ok":false,"error":"agent_-prefixed playerKeys claim names via POST /api/agent-token"}` (literally tells the caller the right path) — gold standard.
- `/api/agent-token` → also structured (`{"ok":false,"error":"playerKey must match …"}`).
- `/create` → silently 200 on garbage (see entry above).
- `/quick-match` → 400 with plaintext `Invalid quick match payload` (no JSON envelope, no field-level pointer).

Pick the `/api/claim-name` shape as the standard and bring the others up to it: every 4xx returns `{ok:false, error, message?, hint?}` JSON with `Content-Type: application/json`, including a `hint` line when there's a more correct related endpoint. Found via R2.

**Files:** `src/server/index.ts`, `src/server/room-routes.ts`, `src/server/quick-match-route.ts` (or wherever quick-match enqueue lives)

### CRITICAL: DO close handler crashes after a code deploy → match outcomes lost

`wrangler tail` captured during a 2026-04-19 paired match:

```
TypeError: The Durable Object's code has been updated, this version can no longer access storage.
  at async GameDO.getGameCode (index.js:45700:12)
  at async Promise.all (index 0)
  at async GameDO.getLatestGameId (index.js:45754:33)
  at async GameDO.getCurrentGameState (index.js:45666:20)
  at async handleGameDoWebSocketClose (index.js:45582:21)
```

When a Worker version rolls out while long-lived `GameDO` instances are still alive, Cloudflare evicts the old DO and any storage access from old code throws. The exception fires inside the **WebSocket close handler** — the same handler that's responsible for triggering match-archive writes when a player disconnects. Concretely: any match where one or both players disconnect during a deploy window risks losing its `match_archive` row, R2 archive object, and `match_rating` rows. Result: rated outcomes silently dropped during deploy windows.

Fix options: (a) wrap close-handler storage calls in try/catch with a structured `console.error` and a fallback re-route to a fresh DO instance via `state.storage.fetch` or a sibling DO; (b) gate code deploys on zero in-flight games (use the live-registry count); (c) document the deploy-window hazard in [OBSERVABILITY.md](./OBSERVABILITY.md) and accept lossy archives as the trade-off.

This is the highest-priority finding from the 2026-04-19 pass — it directly threatens leaderboard integrity. Found via R8.

**Files:** `src/server/game-do/game-do.ts`, `src/server/game-do/archive.ts`, `src/server/game-do/ws.ts`, `docs/OBSERVABILITY.md`

### Surrender silently disabled in `duel`; misleading "Logistics not enabled" error

`POST` action `{"type":"surrender"}` against a duel scenario returns `{"error":"Logistics not enabled for this scenario"}` (verified 2026-04-19; test `mcp-handlers.test.ts:648` enshrines this). Two distinct issues:

1. **Behavioural**: surrender is a fundamental "I quit" mechanic. Disabling it in `duel` (and possibly other scenarios) leaves the only out as drifting/dying. `/agent-playbook.json` `phaseActionMap.astrogation.legalC2S` lists `surrender` unconditionally, so an agent following the documented contract gets rejected.
2. **UX/wording**: the rejection message names the wrong subsystem. An agent looking at the logistics phase to debug will find nothing; the actual issue is scenario-level surrender allow-listing. Either always allow surrender (recommended), or return `{error:"surrender_not_allowed", message:"Surrender is not enabled for scenario duel"}` so the message matches the action.

Cross-references the doc-vs-behaviour drift item in **Agent & MCP ergonomics**.

**Files:** `src/shared/engine/logistics.ts`, `src/server/game-do/actions.ts`, `static/agent-playbook.json`, `src/server/game-do/mcp-handlers.test.ts` (update assertion)

### Matchmaker pairs the same agent identity into two simultaneous matches

Sequence captured 2026-04-19 (with `wrangler tail` and `match_rating`):

1. `delta_v_quick_match_connect({username:"QA_Probe_3"})` → enqueued, **timed out client-side** after 30 s. Server-side ticket apparently not cleaned up.
2. Browser queued (`QA_Probe_B`).
3. `delta_v_quick_match_connect({username:"QA_Probe_M"})` → enqueued.
4. Within 600 ms, the matchmaker emitted two `matchmaker_paired` log lines: `E65LY` paired browser ↔ `agent_mcp_1f1dfd39d380` (QA_Probe_3) and `XVSZQ` paired QA_Probe_M ↔ same `agent_mcp_1f1dfd39d380`.

Result: the QA_Probe_3 player record now shows `games_played: 2` from a single ticket. This violates the implicit invariant "one active match per playerKey" and lets a stalled / abandoned client passively log multiple rated outcomes. In the `match_rating` table this reads as the same player's rating evolving in two simultaneous games, which the Glicko-2 update assumes is sequential. Either invalidate orphan tickets when the corresponding WebSocket never connects within N seconds, or reject any pairing whose `playerKey` is already in an active `LiveRegistryDO` entry. Found via R8 + leaderboard inspection.

**Files:** `src/server/matchmaker-do.ts`, `src/server/live-registry-do.ts`, `src/shared/agent/quick-match.ts`, `src/server/leaderboard/`

### Leaderboard pollution from exploratory test traffic

The 2026-04-19 paired test left three rows in the public `player` table (`QA_Probe_M`, `QA_Probe_3`, `QA_Probe_B`) with non-default Glicko-2 ratings, all visible at `/api/leaderboard?includeProvisional=true`. Pre-launch this is fine to wipe (and is in fact the third such wipe this week), but post-launch any exploratory pass that pairs against a real or test opponent will accrete leaderboard pollution unless tests use a reserved username prefix that the leaderboard handler filters out (e.g. `QA_*`, `Probe_*`, or a `?test=1` query in `/api/agent-token`). Add a server-side filter so the public leaderboard view excludes a named test prefix, and update [EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md) anti-patterns with the chosen prefix convention.

**Files:** `src/server/leaderboard/`, `src/server/auth/issue-route.ts`, `docs/EXPLORATORY_TESTING.md`

---

## Architecture & correctness

### Deterministic initial publication path

**Done for this slice:** `initGameSession` already publishes via the same `GameDO.publishStateChange` → `runPublicationPipeline` path as post-init actions; `getActionRng()` breach fallbacks now use fixed-seed `mulberry32` streams instead of `Math.random` so any accidental call stays replayable while warnings surface the bug.

**Remaining:** optional further deduplication if `match.ts` should call `runPublicationPipeline` without the `publishStateChange` indirection.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

### Boundary hardening and explicit client seams

Hide clone-sensitive engine mutators behind non-exported modules, extend import-boundary enforcement to the missing directions, and finish the client kernel DI cleanup so `WebSocket` and `fetch` are injected rather than reached directly.

**Files:** `src/shared/engine/victory.ts`, `src/shared/engine/turn-advance.ts`, `src/shared/import-boundary.test.ts`, `src/server/import-boundary.test.ts`, `src/client/game/client-kernel.ts`, `src/client/game/connection.ts`, `src/client/game/session-api.ts`, `biome.json`

---

## Type safety & scenario definitions

### Close remaining stringly-typed registries and IDs

Tighten scenario/body registries around closed keys; brand ship / ordnance identifiers so lookup-heavy paths stop depending on plain `string` (wire `isHexKey` coverage exists in Vitest — extend to call sites and registries).

**Files:** `src/shared/hex.ts`, `src/shared/ids.ts`, `src/shared/map-data.ts`, `src/shared/types/domain.ts`, `src/server/room-routes.ts`, `src/server/game-do/http-handlers.ts`, `src/client/game/main-session-network.ts`

---

## Testing & client consistency

### Broaden engine and protocol coverage

Optional positive/negative `contracts.json` rows for parameterless phase one-shots (`skipOrdnance`, `endCombat`, …) beyond current coverage. Deeper `transport.json` vs live Durable Object message parity.

**Files:** `src/shared/__fixtures__/contracts.json`, `src/shared/protocol.test.ts`, `src/server/game-do/__fixtures__/transport.json`, `src/server/game-do/publication.test.ts`

---

## Future features (not currently planned)

These items are potential future work that depend on product decisions or external triggers. They are not in the active queue.

### Simultaneous or pre-submitted astrogation

**Trigger:** product wants both players to commit astrogation before reveal, or any model other than I-go-you-go `activePlayer` after fleet building.

Requires an explicit engine + protocol change; today astrogation is sequential by `activePlayer` (same contract across engine, action guards, local MCP, and hosted MCP).

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

Baseline per-isolate rate limiting is already shipped (100 join-style GETs including `/join`, quick-match ticket polling, and `/api/matches` per 60s per IP; **250** `/replay` GETs per 60s on a separate counter). Add WAF or `[[ratelimits]]` only if the baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Cloudflare Turnstile on human name claim

**Trigger:** logs show bulk human name-claim POSTs, or the beta opens to a larger audience.

Add Turnstile verification to `POST /api/claim-name`: include a site-key widget on the claim form, pass `turnstileToken` in the request, verify server-side via a `TURNSTILE_SECRET_KEY` binding before the name validation / upsert. Free, no tier cap. Endpoint is already structured to accept the extra field with no change to the success path.

**Files:** `src/server/auth/claim-name.ts`, `src/server/auth/turnstile.ts` (new), `static/index.html` + `src/client/` home screen, `wrangler.toml` (`TURNSTILE_SITE_KEY` public var, `TURNSTILE_SECRET_KEY` secret)

### Proof-of-work on first agent name claim

**Trigger:** logs show bulk agent-token issuance being used to farm leaderboard pseudonyms.

Symmetric in spirit to the Turnstile gate on human claims. Server issues a challenge; client submits a nonce whose hash beats a threshold. A few seconds of CPU for a legit agent, painful at bulk. No new infra or billing. Keep the per-IP rate limit in place alongside.

**Files:** `src/server/auth/agent-token.ts`, `src/shared/pow.ts` (new)

### Spectator delay for organized competitive play

**Trigger:** organized matches or tournaments make real-time spectator leakage a meaningful competitive risk.

Delay spectator-facing state/replay updates without affecting player latency.

**Files:** `src/server/game-do/broadcast.ts`, `src/shared/engine/resolve-movement.ts`, replay/socket viewer paths

### Populate Help overlay screenshots

**Trigger:** UI/UX is frozen enough that in-game screenshots won't go stale in the next release cycle.

Six `.help-screenshot` placeholder blocks in `#helpOverlay` currently render as dashed boxes containing descriptive notes of what each image should show (ship + burn arrows, gravity well, combat result popup, fleet builder, mines/torpedoes, in-game HUD with labels). Once the UI settles, capture screenshots at 2x DPI, optimize to WebP + PNG fallback, and replace each placeholder with an `<img>` (with `alt` text from the current placeholder copy). Keep the `.help-screenshot` CSS for the final frame/caption styling.

**Files:** `static/index.html` (lines ~311, 323, 361, 386, 403, 468), `static/styles/overlays.css` (`.help-screenshot`), new image assets under `static/help/`

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
