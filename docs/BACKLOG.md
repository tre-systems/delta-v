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
- None currently pinned. Re-rank after each exploratory / QA pass.

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
- `/healthz` now returns the deployed `sha` and a real boot timestamp again (`{"ok":true,"sha":"118a9f00","bootedAt":"2026-04-19T21:58:22.461Z"}` on 2026-04-19), so the old stale-payload launch note is closed.
- Local Play-vs-AI restore-after-reload no longer deletes `delta-v:local-game` on the initial blank startup tick; the saved snapshot survives long enough for `resumeLocalGame()` to restore it, with a regression test covering the startup race in `local-session-store`.
- Public docs now describe the shipped two-layer state-changing POST limits accurately: strict Worker-local 5 / 60 s per hashed IP for `/create`, `/api/agent-token`, `/quick-match`, and `/api/claim-name`, with Cloudflare `CREATE_RATE_LIMITER` as an extra best-effort edge layer in production; hosted `/mcp` is documented separately as a 20 / 60 s edge limit keyed by agentToken hash or hashed IP.
- Replay viewer: spectator mode now anchors P0=cyan / P1=orange so the two fleets read distinctly; the ship list, fleet scoreboard, and HUD status bar all show "Fleet N" / "P{n} PHASE" instead of the "YOUR TURN" / "OPPONENT'S TURN" player framing. (Shipped 2026-04-19; verified production 2026-04-20.)
- Replay viewer: autoplay starts immediately on entry; Pause is the discoverable affordance. (Shipped 2026-04-19.)
- Replay viewer: archived matches animate ship movement, ordnance, and combat using the same pipeline as live play. The projection step now batches engine events per resolution and reconstructs `movementResult` / `combatResult` S2C messages via `src/server/game-do/replay-reconstruct.ts`. (Shipped 2026-04-20.)
- Replay viewer: 0.5x / 1x / 2x / 4x speed cycling, a gradient progress bar, and a `Turn N/M` label in the replay bar. (Shipped 2026-04-20.)
- Replay viewer: final-entry outcome banner — "Replay ended — Player N wins: {reason}" fires as a log line + toast when the timeline reaches its last entry. (Shipped 2026-04-20.)
- Replay viewer: combat log populates during replay with per-attack dice rolls and damage outcomes (e.g. `Roll: 5 → DISABLED (2T)`). Known gap — `[Odds: —]` placeholder — tracked separately below under "Replay combat log shows `[Odds: —]` placeholder".
- Leaderboard: claimed-but-unplayed callsigns (rating 1500 ±350, 0 games) no longer show on the provisional list; the server filters `games_played > 0`. (Shipped 2026-04-20.)

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

### Play-vs-AI Turn 1 Ordnance phase unresponsive (needs manual repro)

During exploratory testing 2026-04-19 via Claude-in-Chrome MCP, a Play-vs-AI (Duel scenario) session got stuck on Turn 1 Ordnance: SKIP SHIP / CONFIRM PHASE buttons didn't respond to programmatic `.click()`, only to physical clicks via the MCP computer tool. Eventually the canvas renderer froze (screenshot calls timed out; `document.querySelector('canvas')` stayed responsive). Could be a real bug (event handler blocking on `isTrusted` or similar) **or** an artefact of the CDP-driven tab not being the foreground window (`document.hidden === true` inside the MCP tab — see note below). The code path goes `src/client/ui/events.ts → ui-event-router.ts → command-router.ts → action-deps.ts`.

**Triage step:** reproduce manually in a normal foreground browser window (no browser automation). The current report came from a CDP/MCP-controlled tab where synthetic `.click()` failed but physical clicks worked while the tab also reported `document.hidden === true`, so this may be automation-specific rather than a gameplay bug. Do **not** patch button/ordnance routing speculatively until a real-user repro exists. If SKIP SHIP / CONFIRM PHASE respond to real clicks and the renderer stays live, close as CDP-specific; otherwise capture `console.log` / `performance.now()` timing and file as a P1 bug against the failing layer (input dispatch, command routing, phase state, or renderer).

**Files:** potentially `src/client/ui/button-bindings.ts`, `src/client/game/ordnance.ts`, `src/client/game/command-router.ts`

### Note: MCP-automated tabs report `document.hidden === true`

Claude-in-Chrome MCP tabs run in a non-foreground Chrome window, so `document.hidden === true` / `visibilityState === 'hidden'` even when JS is responsive. That makes `renderer.animateMovements` take its fast-path (`onComplete()` synchronously, no RAF loop), which is correct behaviour for hidden tabs but means exploratory passes can't observe the actual animation pacing. If we need to verify animation timing under MCP automation, the skill or docs should note "force the window foreground" as a precondition, or we fake `document.visibilityState` per-tab.

**Files:** `.claude/skills/play/SKILL.md`, `docs/EXPLORATORY_TESTING.md`

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

### Homepage layout: cluttered menu hides the "cool stuff"

**Done for this slice:** the menu no longer hides the social/discovery surfaces behind tiny text links. Leaderboard and Recent Matches now sit as discover tiles, the private-code path lives behind a disclosure, and the old footer clutter has been demoted into slim footer actions instead of competing with the primary CTAs.

**Done for this slice:** the difficulty row now explains the intended Easy/Normal/Hard play-style gap directly in the menu, so the selector is less opaque even if the tier win-rate gap stays moderate.

**Remaining:** only revisit this if playtesting still says the home screen feels too settings-heavy or the AI difficulty selector needs a stronger modal-driven presentation. That would be a larger product design pass, not a launch blocker.

**Files:** `static/index.html`, `static/styles/components.css`, `src/client/ui/lobby-view.ts`

---

## AI behavior & rules conformance

Further AI ordnance work vs the [2018 Triplanetary rulebook](../Triplanetary2018.pdf) (pp. 5–6): simulation-backed thresholds, EV refinement, and deeper regression fixtures.

### `recommendedIndex` over-suggests consecutive ordnance launches

**Done for this slice:** consecutive ordnance recommendations no longer blindly lose to `skipOrdnance`, and 3-turn follow-up torpedoes only stay ahead of skip when the intercept target is materially threatening under the same target-scoring model the AI already uses.

**Remaining:** tune the remaining thresholds with simulation outcomes (especially scenario-specific target velocities / gravity lanes).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/agent/observation.ts`, `src/shared/agent/candidates.ts`, `src/shared/agent/candidate-labels.ts`

### Tighten Hard-difficulty nuke gates with cost and intercept probability

**Done for this slice:** raised hard `nukeMinReachProbability` and the nuke score floor when a torpedo is also viable so marginal lanes prefer the cheaper weapon; duel-sweep remains the harness for follow-up EV tuning.

**Done for this slice:** when both torpedo and nuke geometry are viable, Hard now compares expected net target value instead of only score floors, so expensive nukes no longer beat cheaper torpedoes on marginal capital targets just because the target is "strong enough."

**Done for this slice:** Hard now uses measured threshold tables instead of a single flat nuke gate. The required anti-nuke survival floor steps up by intercept window (`1T`: 0.16 / 0.18, `2T`: 0.22 / 0.26, `3T+`: 0.30 / 0.34 for direct vs torpedo-viable shots), and the target-score floor steps up alongside it (`70/82/94` direct, `122/132/144` when a torpedo is already viable). That keeps point-blank shots available while making longer expensive lanes prove more value before they outrank torpedoes.

**Remaining:** keep validating those tables against broader scenario sweeps; if a future `simulate:duel-sweep` run shows late-turn hard nukes still over-firing, tighten the `3T+` rows first.

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/engine/combat.ts`

### Add ordnance AI regression fixtures for impossible-shot launches

**Done for this slice:** `evaluateOrdnanceLaunchIntercept` wired to the same open-map drift geometry as the existing impossible-shot ordnance fixtures.

**Done for this slice:** same-stack blocker regressions are now covered directly in the nuke-lane assessor, so enemies or enemy ordnance stacked on the intended target hex no longer count as premature blockers.

**Done for this slice:** gravity-aware ballistic fixtures now cover real-map divergence too: one shipped solar-map case where gravity bends a nuke into a hit that does not exist on the empty map, and one where gravity pulls an apparent empty-space hit off target. The shared test helper now models ballistic motion for both ordnance and drifting targets with entered-gravity effects instead of only open-space drift.

**Remaining:** optional `game-engine.test.ts` integration seeds if we later want end-to-end replay/engine coverage on top of the current ordnance helper + AI regression layer.

**Files:** `src/shared/ai.test.ts`, `src/shared/test-helpers.ts`, `src/shared/test-helpers.test.ts`, optional `src/shared/engine/game-engine.test.ts`

### Per-scenario seat-balance gaps (100-game hard-vs-hard runs)

Re-ran the simulation harness at 100 games per scenario for tighter signal (2026-04-19). The earlier 30-game numbers were too noisy — biplanetary in particular flipped sign between samples, which is why this entry replaces the earlier "Material first-player advantage" note.

| Scenario | P0% | P1% | Draws | Avg turns | Status |
|----------|----:|----:|------:|----------:|--------|
| escape | 38 | 62 | 0 | 11.1 | was P1-skewed; see updated note below |
| biplanetary | 41 | 59 | 0 | 7.3 | mild P1 edge |
| blockade | 43 | 57 | 0 | 7.1 | mild P1 edge |
| interplanetaryWar | 45 | 53 | 2 | 33.8 | balanced ✓ |
| convoy | 54 | 42 | 4 | 29.0 | balanced ✓ |
| fleetAction | 59 | 35 | 6 | 33.0 | P0 edge + 6% timeouts |
| duel | 59 | 41 | 0 | 6.2 | P0 edge |
| grandTour | 50 | 25 | **25** | 156.6 | balanced-when-decided, but 25% timeout (see grandTour entry) |

**Done for this slice:** fleetAction now overrides AI closing pressure upward (`combatClosingWeight` / `combatCloseBonus`) so the fleets commit earlier; a fresh 40-game hard-vs-hard sample moved it from 15% timeouts / 70-turn average to 10% timeouts / 46-turn average without reviving the old P0 blowout. Duel now also suppresses combat-closing pressure completely at the scenario-override layer; a fresh 60-game hard-vs-hard sample landed at 50/50 with the average fight lengthened to 7.4 turns. Escape now starts the Terra-side enforcer corvette one lane back instead of directly on the fugitive launch hex; a fresh 100-game hard-vs-hard sample moved it from 35/65 to 49/51 with no timeouts.

Action: pick a target band (50±10% is conventional) and tune only the scenarios that still stay outside it on broader seeded sweeps. Fresh 120-game hard-vs-hard confirmation on 2026-04-20 moved `biplanetary` to `55/45`, `blockade` to `55.8/44.2`, and `interplanetaryWar` to `55.8/40.8/3.3`, so the old "mild P1 edge" framing is now mostly stale and the remaining work is validation, not urgent scenario-side surgery. Duel and fleetAction have both moved back into the target band on later seeded sweeps, so the seat-balance section is no longer a broad launch-readiness blocker. For matchmaking + ranked play, document the seat-assignment policy: random per match, or always-asymmetric-to-skill?

Seat assignment is now randomised in `MatchmakerDO`; keep `match_rating.player_a_key` / `player_b_key` ordering aligned to the actual seated side when touching pairing or archival logic.

Implication for the launch-readiness snapshot: the earlier *first-player advantage* line was over-stated based on 30-game noise. After the latest duel/fleetAction/escape tuning and broader 120- to 240-game follow-up sweeps, the remaining seat-balance work is mostly "keep watching larger seeded samples" rather than obvious scenario imbalance.

**Files:** `src/server/matchmaker-do.ts`, `src/shared/scenarios/duel.ts`, `src/shared/scenarios/biplanetary.ts`, `src/shared/scenarios/escape.ts`, `src/shared/scenarios/blockade.ts`, `src/shared/scenarios/fleet-action.ts`, `src/shared/ai/`, `scripts/simulate-ai.ts`

### High timeout rate in `fleetAction`

`grandTour` no longer records null timeouts in the simulation harness: when the phase cap trips in a checkpoint race, `scripts/simulate-ai.ts` now resolves a progress tiebreak from visited checkpoint count, surviving ships, and estimated remaining tour distance. A fresh 30-game hard-vs-hard sample came back `46.7/53.3` with **0** timeouts, `4` progress-tiebreak wins, `4` full race completions, and a reduced average length of `102.2` turns. `fleetAction` has improved after the closing-pressure override, but still times out often enough to need another larger seeded sweep before dropping the item.

Follow-up seeded sweep 2026-04-20 (`8` base seeds × `30` games = `240` total) still showed `28` timeouts (`11.7%`) and wide seed variance (`39.3%` to `70.4%` P0 decided-win rate, ~`55.2` average turns overall). So this was still a live tuning item, not just a remeasurement chore.

**Done for this slice:** the fleet-builder no longer optimizes `fleetAction` into near-all-corvette swarms that can barely carry ordnance. It now rewards mixed warship fleets with real torpedo capacity, and the scenario-local closing override is stronger (`combatClosingWeight: 5`, `combatCloseBonus: 75`) so those fleets commit sooner once they enter range. A fresh 240-game hard-vs-hard sample moved to `121/101/18` (`50.4/42.1`, `7.5%` timeouts, `46.4` average turns), which is still materially better than the earlier `102/106/32` (`13.3%` timeouts, `59.9` turns) sample on the old doctrine.

**Remaining:** this is now close to "good enough" rather than a clear launch-readiness issue. Only revisit if future larger seeded sweeps drift back above ~`8–10%` timeouts or reintroduce a strong P0 blowout.

**Files:** `src/shared/ai/`, `scripts/simulate-ai.ts` (turn cap), `src/shared/scenario-definitions.ts`, `src/shared/engine/victory.ts` (tiebreak)

### AI difficulty tiers still under-differentiate

Earlier diagonal sweep on `duel`, 50 games per cell:

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

That snapshot is now partially stale. Fresh 120-game `duel` mirrors on 2026-04-20 came back much closer to neutral:

| P0 | P1 | P0 win% | Avg turns |
|----|----|---------|-----------|
| easy | easy | 47.5% | 6.7 |
| normal | normal | 49.2% | 7.7 |
| hard | hard | 46.7% | 8.9 |

So the worst same-difficulty seat-bias inversion has largely been fixed. The real remaining problem is narrower:

1. **Normal ≈ Hard.** Fresh 120-game cross-tier sweeps on 2026-04-20 moved in the right direction after weakening Normal's closing pressure / torpedo reach / lookahead bias: `hard-vs-normal` now comes back `44.2/55.0/0.8` and `normal-vs-hard` `46.7/52.5/0.8`. Hard now wins in both seat orders, but the edge is still moderate rather than emphatic.
2. **Tier expectations needed explicit copy.** Easy/Normal/Hard now differ more in style than in raw win rate. That is better than the old seat-driven instability, but it still needed the menu to explain those intended behavior differences directly.

**Done for this slice:** widened the risk split in astrogation lookahead and combat commitment so Normal and Hard no longer collapse to the exact same duel outcomes on the same seeds; the follow-up duel override then held `hard-vs-hard` at 50/50 on a 60-game sample while leaving a visible behavior gap between tiers.

**Done for this slice:** Easy no longer applies its random-burn sabotage on turn 1, so the worst "first player is weaker on Easy" inversion is gone. A fresh 60-game `easy-vs-easy` duel sample moved from the old `36/64` reversal to `56.7/43.3`.

**Done for this slice:** Normal is now slightly less decisive by default (shorter torpedo reach, lower lookahead bias, lower close-combat bonus, higher roll floor), which preserved healthier same-tier mirrors (`normal-vs-normal` 46.7/53.3, `hard-vs-hard` 50/50 in fresh 120-game duel sweeps) while finally giving Hard a real edge in both seat orders.

**Done for this slice:** the menu difficulty selector now explains the intended tier behavior directly (Easy = forgiving / learning, Normal = balanced duel, Hard = punishing pressure), so the remaining issue is no longer hidden product semantics.

**Remaining:** only widen the Hard-vs-Normal gap again if real playtesting still says the tiers feel too similar despite the stronger menu copy.

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

**Done for this slice:** the remaining room/runtime failures (`ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_IN_PROGRESS`) are now explicitly covered as intentional plain-error cases, so all engine-invalid submitter-scoped failures are on the structured `actionRejected` path and only true room/runtime conditions stay on the generic error channel.

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

### Clear the transitive `hono` advisory in the MCP adapter chain

`npm audit --omit=dev` still reports `GHSA-458j-xx4x-4375` through `@modelcontextprotocol/sdk -> hono`. The current codebase does not appear to use the affected JSX SSR path, so this is not the top security issue, but it should still be tracked as dependency hygiene and cleared when the MCP SDK chain updates.

**Files:** `package.json`, `packages/mcp-adapter/package.json`

## Telemetry & observability

### `events` table is write-only from the app — analysis relies on ad-hoc SQL

Exploratory pass 2026-04-20: the [`events` D1 table](../migrations/0001_create_events.sql) is written by `src/server/reporting.ts` (browser `/telemetry` + `/error` ingest) and `src/server/game-do/telemetry.ts` (server-side turn/fleet/action events), but **no application code reads it back**. There is no admin endpoint, no scheduled aggregation, no dashboard. The data is only queryable via `wrangler d1 execute` SQL one-liners, which means it doesn't currently drive any decisions.

To turn this telemetry into something useful for "analysing issues and improving the game once there are many players", we need at minimum:
- A small internal `/api/metrics` endpoint (auth-gated) that returns common aggregates: daily-active matches, scenario play mix, AI difficulty distribution, first-turn-completion rate, WS error rate, reconnect success rate, average turn duration per scenario.
- Documented SQL recipes for the top 10 analyses (engagement, funnel, balance, infra health). Drop into [OBSERVABILITY.md](./OBSERVABILITY.md).
- Optional: scheduled export to R2 / BigQuery for longer-horizon analysis when D1 retention trimming kicks in.

**Files:** `src/server/reporting.ts`, new `src/server/metrics-route.ts`, `docs/OBSERVABILITY.md`

### Telemetry coverage gaps — no signal for spectator / replay engagement

Exploratory pass 2026-04-20: the existing `trackEvent` calls cover matchmaking lifecycle, turn/fleet actions, WS errors, and reconnect churn (`quick_match_*`, `game_over`, `turn_completed`, `ws_connect_error`, `reconnect_succeeded`). What's missing is any signal for **post-match and discovery surfaces**:

- No `leaderboard_viewed`, `leaderboard_row_clicked` — can't tell if anyone uses the leaderboard.
- No `matches_list_viewed`, `match_replay_opened`, `replay_reached_end`, `replay_exited_early {atProgress, atTurn}` — can't tell if replays are watched, abandoned at turn 2, or watched to completion.
- No `replay_speed_changed {to}` — can't tell if the 2x/4x buttons are used.
- No `scenario_selected {scenario, from: 'ai'|'private'}` — we lose the scenario-popularity signal at the menu level (only the final `ai_game_started` fires, by which point the user already committed).
- No connection-quality metric over a session (RTT, out-of-order frames). We log `ws_invalid_message` but not steady-state health.

**Files:** `src/client/game/main-session-shell.ts`, `src/client/game/replay-controller.ts`, `src/client/leaderboard/*.ts`, `static/matches.html`, `static/leaderboard.html`

### `match_rating` keeps pre/post rating columns write-only — keep as audit trail, document intent

Exploratory pass 2026-04-20: [`match_rating.pre_rating_a/b`, `post_rating_a/b`](../migrations/0004_leaderboard.sql) are populated on every rated match but no query reads them. That's intentional for now — they form a rating-history audit trail for future features (player profile "recent matches" graph, admin anti-cheat review, balance analysis). Document that intent in the migration or a short note in [OBSERVABILITY.md](./OBSERVABILITY.md) so future maintainers don't see them as dead schema and drop them in a cleanup pass.

**Files:** `migrations/0004_leaderboard.sql`, `docs/OBSERVABILITY.md`

## Architecture & correctness

### Deterministic initial publication path

**Done for this slice:** `initGameSession` already publishes via the same `GameDO.publishStateChange` → `runPublicationPipeline` path as post-init actions; `getActionRng()` breach fallbacks now use fixed-seed `mulberry32` streams instead of `Math.random` so any accidental call stays replayable while warnings surface the bug.

**Remaining:** optional further deduplication if `match.ts` should call `runPublicationPipeline` without the `publishStateChange` indirection.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

### Boundary hardening and explicit client seams

Hide clone-sensitive engine mutators behind non-exported modules, extend import-boundary enforcement to the missing directions, and finish the client kernel DI cleanup so `WebSocket` and `fetch` are injected rather than reached directly.

**Done for this slice:** browser telemetry/error reporting now runs through a configured runtime from `src/client/main.ts`, so the client no longer reaches global `fetch` directly inside `src/client/telemetry.ts`; the seam is covered in `src/client/telemetry.test.ts`. `src/client/game/connection.ts` and `src/client/game/session-api.ts` also now require injected `WebSocket` / `fetch` / `location` dependencies instead of silently falling back to globals, with the explicit-seam path covered in their Vitest suites. The leaderboard claim/rank helpers now follow the same pattern: `src/client/leaderboard/api.ts` requires injected `fetch`, while `src/client/ui/lobby-view.ts` owns the browser default wrapper and the seam is covered in `src/client/leaderboard/api.test.ts`.

**Done for this slice:** import-boundary enforcement now checks the whole `shared/` layer for browser/Cloudflare globals, not just `shared/engine/`, so agent helpers, protocol code, and shared utilities cannot quietly pick up `window`, `document`, or Worker runtime APIs outside the engine boundary.

**Files:** `src/shared/engine/victory.ts`, `src/shared/engine/turn-advance.ts`, `src/shared/import-boundary.test.ts`, `src/server/import-boundary.test.ts`, `src/client/game/client-kernel.ts`, `src/client/game/connection.ts`, `src/client/game/session-api.ts`, `biome.json`

---

## Type safety & scenario definitions

### Close remaining stringly-typed registries and IDs

Tighten scenario/body registries around closed keys; brand ship / ordnance identifiers so lookup-heavy paths stop depending on plain `string` (wire `isHexKey` coverage exists in Vitest — extend to call sites and registries).

**Done for this slice:** the server create/init protocol path now preserves validated `ScenarioKey` values through `parseCreatePayload`, `parseInitPayload`, `RoomConfig`, and the public room/http handlers instead of widening them back to plain `string` immediately after validation.

**Done for this slice:** combat payload parsing now brands `targetId` as `ShipId` or `OrdnanceId` at validation time based on `targetType`, instead of pushing an untyped string through the shared combat path until later casts.

**Done for this slice:** shared combat resolution and conflict projection now narrow ship-vs-ordnance targets with explicit guards, so those hot paths no longer need ad hoc `as ShipId` / `as OrdnanceId` assertions after `targetType` checks.

**Done for this slice:** combat phase target tracking now uses a branded `CombatTargetKey` helper instead of raw `${targetType}:${targetId}` strings in engine state, replay projection, and AI combat planning.

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
