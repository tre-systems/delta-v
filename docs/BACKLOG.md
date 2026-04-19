# Delta-V Backlog

A prioritised list of outstanding tasks that deserve a named home between PRs — design gaps, tuning work, hardening items, doc-vs-reality drift. Each entry is either actionable in the next few weeks or explicitly trigger-gated.

Sections are grouped by theme and ordered by priority within each group: gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

Shipped work lives in `git log`, not here. Recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in [EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

## Launch-readiness snapshot (2026-04-19)

Pinned by an exploratory pass on production (see [EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md) pass log). Update or remove this section when the listed items are resolved or reassessed.

**P0 — launch-blockers** (data integrity or scenario design, fix before any public traffic):

- None currently pinned. Re-rank after each exploratory / QA pass.

(Note: the seat-hijack / unauthenticated-join finding is **not** P0 — by product decision, frictionless start outweighs private-room auth. Listed under polish below for the spectator-misadvertisement and structured-rejection parts only.)

**P1 — pre-launch polish** (player-visible weirdness or abuse surface, fix soon):
- *`/healthz` production payload still stale until the fallback ships live* (Agent & MCP ergonomics) — production still returns `sha:null, bootedAt:"1970-01-01..."` as of 2026-04-19. Code now falls back from Worker deploy metadata to bundled `/version.json` `assetsHash` and stamps `bootedAt` at module load; re-verify on the next deploy before removing this line.

**Fixed since opening** (re-verified 2026-04-19 on production):

- `POST /create` validates scenario (`invalid_payload`), empty body, and payload size (1024-byte cap via `payload_too_large`).
- `/api/matches?limit=abc` / `?limit=99999` / `?status=bogus` / `?before=garbage` / `?winner=*` / `?scenario=*` return 400 with `invalid_query` — full filter validation now complete.
- `/api/leaderboard?limit=abc` / `?limit=-1` / `?includeProvisional=garbage` return 400.
- `/join/{code}` returns `{ok, scenario, seatStatus}` — matches the "room metadata" doc contract.
- `delta_v_reconnect` shipped in local MCP (hosted parity still outstanding).
- DO close handler no longer causing visible exceptions in tail during normal close (re-verify on next post-deploy pass).
- Evacuation scenario balance fixed: 100-game sweep now 63/37 (was 3/97).
- Matchmaker seat-shuffle shipped: `Math.random() < 0.5` in `matchEntries` at [src/server/matchmaker-do.ts](../src/server/matchmaker-do.ts).
- `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png` now return 200 (no more favicon 404 noise, iOS home-screen icon works).
- `Forget my callsign` control exists on the lobby and regenerates to an anonymous `Pilot XXXX` identity (confirmed 2026-04-19).
- `delta-v:tokens` localStorage is now bounded (was 6 entries, now 0 — cleanup appears to be shipped).
- `/api/matches` filter validation complete across all five params (`scenario`, `winner`, `limit`, `status`, `before`).
- `/api/matches` response no longer leaks user-typed usernames: `winnerUsername` and `loserUsername` return `null` — matches the [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) contract.
- Security headers deployed 2026-04-19: CSP, HSTS (1 y + preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy geolocation=(), microphone=(), camera=(). Public read endpoints return wildcard CORS for browser embeds.
- Reserved-name blocklist landed: fresh-playerKey claims for `root`, `moderator`, `delta-v`, `deltav`, `admin`, `administrator`, and `owner` all return 409 `username_reserved` (verified 2026-04-19).
- Match-history `Replay →` links now work end-to-end: clicking loads `/?code=XXXXX` in spectator mode with full playback controls (First / Previous / Play / Next / Last / EXIT). Scrubbing advances at event-stream granularity ("Turn N · P# PHASE · n/total"); the Play button auto-advances and flips aria-label to Pause. Verified 2026-04-19 against completed match `E65LY-m1`.
- MCP resources shipped: hosted `/mcp` `resources/list` returns eleven entries — `game://rules/current`, nine per-scenario `game://rules/{id}` entries, and `game://leaderboard/agents`. `resources/read` returns `application/json` with `{version, scenario, definition}` (or `{version, kind, entries}` for the leaderboard). Verified 2026-04-19.
- Local Play-vs-AI restore-after-reload no longer deletes `delta-v:local-game` on the initial blank startup tick; the saved snapshot survives long enough for `resumeLocalGame()` to restore it, with a regression test covering the startup race in `local-session-store`.
- Public docs now describe the shipped two-layer state-changing POST limits accurately: strict Worker-local 5 / 60 s per hashed IP for `/create`, `/api/agent-token`, `/quick-match`, and `/api/claim-name`, with Cloudflare `CREATE_RATE_LIMITER` as an extra best-effort edge layer in production; hosted `/mcp` is documented separately as a 20 / 60 s edge limit keyed by agentToken hash or hashed IP.

**Confirmed working** (do not regress):

- End-to-end pipeline: matchmaking → game → `match_archive` → R2 archive → `match_rating` → `/api/leaderboard`.
- Glicko-2 calculations behave correctly under sequential updates.
- D1 `events` payloads contain no PII (UUID `anon_id`, hashed `ip_hash`).
- `wrangler tail` redacts `?playerToken=REDACTED`.
- Tutorial fires on first Play-vs-AI, persists `tutorial_done` across reloads.
- PWA manifest, service worker, masked icons all wired correctly.
- 2251 unit tests pass; lint + typecheck clean.
- All 9 scenarios launch from the Play-vs-AI lobby without console errors.
- Validation quality on `/api/claim-name` and `/api/agent-token` is the gold standard for the rest of the API.
- SPA initial load: TTFB 21-30ms, DOM ready ~180ms, 39KB initial transfer, 15 resources (measured 2026-04-19).
- HUD scale toggle (`deltav_hud_scale`) and sound-effects toggle both persist to localStorage and survive reload.
- Help overlay has 10 content sections (Turn Phases, Movement & Fuel, Gravity & Landing, Combat, Ships, Ordnance, Win Conditions, Map Symbols, Controls).

---

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

**Done (phase 2):** combat **`{` / `}`** cycles legal attackers for the selected target, updates planning on the same command path, recenters on the attacking stack, and makes mixed-hex attacker selection reachable without pointer-only clicks.

**Done (phase 3):** standard-mapped gamepads now drive the same command path: **A/B** confirm/cancel, **LB/RB** cycle ships, **D-pad** cycles combat targets/attackers, and **X/Y/Start/Back** map to log/focus-help/mute shortcuts without inventing a separate controller input stack.

**Remaining:** other tactical picks that are still pointer-first.

**Files:** `src/client/game-client-browser.ts`, `src/client/game/client-runtime.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud.ts`, `static/index.html`

### Burn-arrow tap targets (verification)

Revisit burn/overload hit targets only if playtesting reports misses at very small `hexSize` (picks resolve by neighboring hex cell, not only the painted disk — `resolveBurnToggle` / `resolveOverloadToggle` in `input.ts`).

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/game/input.ts`, `src/client/input-interaction.ts`

---

## AI behavior & rules conformance

Further AI ordnance work vs the [2018 Triplanetary rulebook](../Triplanetary2018.pdf) (pp. 5–6): simulation-backed thresholds, EV refinement, and deeper regression fixtures.

### `recommendedIndex` over-suggests consecutive ordnance launches

**Done for this slice:** consecutive ordnance recommendations no longer blindly lose to `skipOrdnance`, and 3-turn follow-up torpedoes only stay ahead of skip when the intercept target is materially threatening under the same target-scoring model the AI already uses.

**Remaining:** tune the remaining thresholds with simulation outcomes (especially scenario-specific target velocities / gravity lanes).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/agent/observation.ts`, `src/shared/agent/candidates.ts`, `src/shared/agent/candidate-labels.ts`

### Tighten Hard-difficulty nuke gates with cost and intercept probability

**Done for this slice:** raised hard `nukeMinReachProbability` and the nuke score floor when a torpedo is also viable so marginal lanes prefer the cheaper weapon; duel-sweep remains the harness for follow-up EV tuning.

**Remaining:** expected-damage refinement beyond current gates, and **`simulate:duel-sweep`**-driven threshold tables tied to measurement runs (rulebook: nuke **300 MCr** vs torpedo **20 MCr**, **2:1** anti-nuke table, detonation on lane contacts).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/engine/combat.ts`

### Add ordnance AI regression fixtures for impossible-shot launches

**Done for this slice:** `evaluateOrdnanceLaunchIntercept` wired to the same open-map drift geometry as the existing impossible-shot ordnance fixtures.

**Remaining:** same-stack edge cases beyond launch-hex stacking, deeper gravity-edge assertions (beyond open-map determinism smoke), optional `game-engine.test.ts` integration seeds.

**Files:** `src/shared/ai.test.ts`, `src/shared/test-helpers.ts`, `src/shared/test-helpers.test.ts`, optional `src/shared/engine/game-engine.test.ts`

### Per-scenario seat-balance gaps (100-game hard-vs-hard runs)

Re-ran the simulation harness at 100 games per scenario for tighter signal (2026-04-19). The earlier 30-game numbers were too noisy — biplanetary in particular flipped sign between samples, which is why this entry replaces the earlier "Material first-player advantage" note.

| Scenario | P0% | P1% | Draws | Avg turns | Status |
|----------|----:|----:|------:|----------:|--------|
| escape | 38 | 62 | 0 | 11.1 | asymmetric (intended?), but ±12pp |
| biplanetary | 41 | 59 | 0 | 7.3 | mild P1 edge |
| blockade | 43 | 57 | 0 | 7.1 | mild P1 edge |
| interplanetaryWar | 45 | 53 | 2 | 33.8 | balanced ✓ |
| convoy | 54 | 42 | 4 | 29.0 | balanced ✓ |
| fleetAction | 59 | 35 | 6 | 33.0 | P0 edge + 6% timeouts |
| duel | 59 | 41 | 0 | 6.2 | P0 edge |
| grandTour | 50 | 25 | **25** | 156.6 | balanced-when-decided, but 25% timeout (see grandTour entry) |

**Done for this slice:** fleetAction now overrides AI closing pressure upward (`combatClosingWeight` / `combatCloseBonus`) so the fleets commit earlier; a fresh 40-game hard-vs-hard sample moved it from 15% timeouts / 70-turn average to 10% timeouts / 46-turn average without reviving the old P0 blowout. Duel now also suppresses combat-closing pressure completely at the scenario-override layer; a fresh 60-game hard-vs-hard sample landed at 50/50 with the average fight lengthened to 7.4 turns.

Action: pick a target band (50±10% is conventional) and tune the offending scenarios. biplanetary + blockade + escape still need either P0 strengthening or scenario-side rebalancing. Re-measure fleetAction and duel on larger seeded sweeps before calling them done. For matchmaking + ranked play, document the seat-assignment policy: random per match, or always-asymmetric-to-skill?

Seat assignment is now randomised in `MatchmakerDO`; keep `match_rating.player_a_key` / `player_b_key` ordering aligned to the actual seated side when touching pairing or archival logic.

Implication for the launch-readiness snapshot: the earlier *first-player advantage* line was over-stated based on 30-game noise. After the latest duel/fleetAction tuning, the remaining meaningful seat skews appear to be escape/biplanetary/blockade on the P1 side plus any residual fleetAction drift that survives a larger seeded sweep.

**Files:** `src/server/matchmaker-do.ts`, `src/shared/scenarios/duel.ts`, `src/shared/scenarios/biplanetary.ts`, `src/shared/scenarios/escape.ts`, `src/shared/scenarios/blockade.ts`, `src/shared/scenarios/fleet-action.ts`, `src/shared/ai/`, `scripts/simulate-ai.ts`

### High timeout rate in `grandTour` (23%) and `fleetAction` (20%)

Same sweep — almost a quarter of grandTour and a fifth of fleetAction games hit the simulation turn-limit without resolving. For grandTour the 164-turn average suggests the scenario is genuinely long. fleetAction has improved after the closing-pressure override, but still times out often enough to need another larger seeded sweep before dropping the item. Either lower the turn limit and add a tiebreak (sum of remaining ship-cost? closest-to-objective?), or keep tuning AI cohesion pressure so it forces engagement before the limit.

**Files:** `src/shared/ai/`, `scripts/simulate-ai.ts` (turn cap), `src/shared/scenario-definitions.ts`, `src/shared/engine/victory.ts` (tiebreak)

### AI difficulty tiers under-differentiate; first-player bias flips with difficulty

Diagonal sweep on `duel`, 50 games per cell:

| P0 | P1 | P0 win% | Avg turns |
|----|----|---------|-----------|
| easy | easy | 36.0% | 6.0 |
| normal | normal | 60.0% | 6.4 |
| hard | hard | 60.0% | 6.6 |
| hard | easy | 70.0% | 7.2 |
| hard | normal | 64.0% | 5.9 |
| normal | hard | 62.0% | 5.8 |
| easy | normal | 50.0% | 5.9 |
| easy | hard | 40.0% | 7.6 |

Two intertwined problems:

1. **Normal ≈ Hard.** `normal-vs-hard` gives 62/38 in P0's favour and `hard-vs-normal` gives 64/36 — i.e. the seat bias swamps the difficulty signal. A player picking "Hard" over "Normal" in *Play vs AI* gets ~4 percentage points of edge net of seat. From the player's perspective the difficulty selector is largely cosmetic.
2. **First-player bias depends on difficulty.** `hard-vs-hard` → P0=60% (forward bias). `easy-vs-easy` → P0=36% (**reversed bias**). The same pattern reproduces on biplanetary (Hard-vs-Hard P0=63%, Easy-vs-Easy P0=33%). So the seat advantage isn't a fixed first-mover bonus — it's emergent from the AI heuristics, and the Easy AI plays *worse* as the initiator. For matchmaking with random seat assignment among Hard-vs-Hard matches the leaderboard skew will persist; for the *Play vs AI* difficulty selector to be meaningful, the gap between tiers needs to be larger than the seat skew (~20pp).

**Done for this slice:** widened the risk split in astrogation lookahead and combat commitment so Normal and Hard no longer collapse to the exact same duel outcomes on the same seeds; the follow-up duel override then held `hard-vs-hard` at 50/50 on a 60-game sample while leaving a visible behavior gap between tiers.

**Remaining:** hold that spread across larger seeded sweeps, keep reducing seat bias in the same-difficulty ladders, add a "play first vs second" heuristic to Easy so it does not invert the bias, and optionally expose per-difficulty expectations in the difficulty selector copy.

**Files:** `src/shared/ai/config.ts`, `src/shared/ai/`, `src/client/ui/lobby.ts` (difficulty selector copy), `scripts/simulate-ai.ts`

### "Mutual destruction — last attacker loses" tiebreak feels arbitrary

Surfaced once per 100-game duel run (`Mutual destruction — last attacker loses!`). The current rule punishes the player whose attack triggered the simultaneous wipeout, which can feel unfair to the attacker (they were "winning until they weren't"). At minimum, the game-over screen should explain the rule clearly; ideally, consider a different tiebreak (e.g. coin flip with both players notified, or a draw outcome). Low frequency means this is polish, not P0/P1.

**Files:** `src/shared/engine/victory.ts`, `src/client/ui/game-over.ts`, `docs/SPEC.md`

---

## Agent & MCP ergonomics

Gaps in local vs hosted MCP parity, first-class resources, and structured rejection surfaces for autonomous play.

### Structured action-rejection reasons

**Done for this slice:** submitter-only `actionAccepted` now carries `guardStatus: inSync | stalePhaseForgiven` so local MCP, hosted MCP, browser clients, and agent scripts can distinguish forgiven phase drift from fully in-sync submissions without overloading `actionRejected`.

**Done for this slice:** engine validation/resource failures that are still submitter-scoped now map into typed `actionRejected` reasons instead of collapsing to a generic `error` transport message.

**Remaining:** extend the structured rejection coverage to any remaining engine-invalid paths that still escape through generic `error`.

**Files:** `src/server/game-do/action-guards.ts`, `src/shared/types/protocol.ts`, `src/shared/protocol.ts`, `scripts/delta-v-mcp-server.ts`, `src/client/game/client-message-plans.ts`

### Retire legacy `{code, playerToken}` tool args once leaderboard stabilises

Hosted MCP tools still accept either `matchToken` or `{code, playerToken}` via `matchTargetSchema` in `packages/mcp-adapter/src/handlers.ts`. Carrying both doubles tool-args surface area and forces every call site to branch on auth mode. Once the public leaderboard is live and all active agents have migrated to `matchToken`, drop the legacy union and simplify the adapter — consistent with the pre-launch-deletions stance elsewhere.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/quick-match-agent.ts`, `scripts/llm-player.ts`, `docs/DELTA_V_MCP.md`

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Baseline controls are documented in [SECURITY.md](./SECURITY.md).

**Still backlog / trigger-gated:** WAF or `[[ratelimits]]` if baseline throttles prove insufficient; Turnstile on human name claim; proof-of-work on bulk agent name claims; spectator delay for serious competition. File hooks sit under [Future features](#future-features-not-currently-planned) where applicable.

### Strict cross-colo rate limits for state-changing POSTs (only if needed)

The docs now reflect the shipped model accurately: `/create`, `/api/agent-token`, `/quick-match`, and `/api/claim-name` use a strict Worker-local **5 / 60 s per hashed IP** bucket plus Cloudflare `CREATE_RATE_LIMITER` as an extra best-effort edge layer in production. That is enough for accidental floods and single-isolate abuse, but not a true global cap.

If cross-colo or distributed issuance becomes a real problem, the next step is a D1 or Durable Object counter so the limit is global rather than per isolate plus best-effort edge binding.

**Files:** `static/.well-known/agent.json`, `wrangler.toml`, `src/server/reporting.ts`, `src/server/index.ts`, `docs/SECURITY.md`

### Private-room code space + unauthenticated join (intentional UX trade-off)

Confirmed 2026-04-19: `POST /create` returns a 5-char code from a 32-char alphabet (~33.6M codes); `WebSocket(/ws/<code>)` with no `playerToken` auto-seats the connecting client as player 1 and issues a fresh playerToken. Brute-forcing the 5-char code is theoretically feasible (~3 h to find a random active room from a populated server, multi-IP).

**Decision (2026-04-19, product):** this is *not* a launch-blocker. Frictionless start (no login, share-and-join) outweighs private-room hijack defence. Document the trade-off and skip auth/captcha/invite-token work; revisit only if real-world griefing is observed post-launch. The actually-actionable bit that remains is the bare 1006 close shape on a full room when no player token or spectator flag is provided.

**Files:** —

## Architecture & correctness

### Deterministic initial publication path

**Done for this slice:** `initGameSession` already publishes via the same `GameDO.publishStateChange` → `runPublicationPipeline` path as post-init actions; `getActionRng()` breach fallbacks now use fixed-seed `mulberry32` streams instead of `Math.random` so any accidental call stays replayable while warnings surface the bug.

**Remaining:** optional further deduplication if `match.ts` should call `runPublicationPipeline` without the `publishStateChange` indirection.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

### Boundary hardening and explicit client seams

Hide clone-sensitive engine mutators behind non-exported modules, extend import-boundary enforcement to the missing directions, and finish the client kernel DI cleanup so `WebSocket` and `fetch` are injected rather than reached directly.

**Done for this slice:** browser telemetry/error reporting now runs through a configured runtime from `src/client/main.ts`, so the client no longer reaches global `fetch` directly inside `src/client/telemetry.ts`; the seam is covered in `src/client/telemetry.test.ts`. `src/client/game/connection.ts` and `src/client/game/session-api.ts` also now require injected `WebSocket` / `fetch` / `location` dependencies instead of silently falling back to globals, with the explicit-seam path covered in their Vitest suites.

**Files:** `src/shared/engine/victory.ts`, `src/shared/engine/turn-advance.ts`, `src/shared/import-boundary.test.ts`, `src/server/import-boundary.test.ts`, `src/client/game/client-kernel.ts`, `src/client/game/connection.ts`, `src/client/game/session-api.ts`, `biome.json`

---

## Type safety & scenario definitions

### Close remaining stringly-typed registries and IDs

Tighten scenario/body registries around closed keys; brand ship / ordnance identifiers so lookup-heavy paths stop depending on plain `string` (wire `isHexKey` coverage exists in Vitest — extend to call sites and registries).

**Done for this slice:** the server create/init protocol path now preserves validated `ScenarioKey` values through `parseCreatePayload`, `parseInitPayload`, `RoomConfig`, and the public room/http handlers instead of widening them back to plain `string` immediately after validation.

**Files:** `src/shared/hex.ts`, `src/shared/ids.ts`, `src/shared/map-data.ts`, `src/shared/types/domain.ts`, `src/server/room-routes.ts`, `src/server/game-do/http-handlers.ts`, `src/client/game/main-session-network.ts`

---

## Testing & client consistency

### Broaden engine and protocol coverage

Optional positive/negative `contracts.json` rows for parameterless phase one-shots (`skipOrdnance`, `endCombat`, …) beyond current coverage. Deeper `transport.json` vs live Durable Object message parity.

**Done for this slice:** `transport.json` now fixture-covers the submitter-only `actionAccepted` / `actionRejected` envelopes as reviewed wire shapes, so the newer guard/engine rejection metadata is locked to the same normalized transport fixtures as `gameStart`, `stateUpdate`, `movementResult`, and `combatResult`.

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
