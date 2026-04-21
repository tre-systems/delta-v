# Delta-V Backlog

A prioritised list of outstanding tasks that deserve a named home between PRs — design gaps, tuning work, hardening items, doc-vs-reality drift. Each entry is either actionable in the next few weeks or explicitly trigger-gated.

Sections are grouped by theme and ordered by priority within each group: gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

Shipped work lives in `git log`, not here. Recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in [EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

## AI objective discipline (2026-04-21)

Fresh hard-vs-hard simulation samples suggest the heuristic AI is still treating several objective scenarios as attrition fights instead of races or escorts. On 2026-04-21, `biplanetary` ended `120/120` by `Fleet eliminated!`; `blockade` ended `78/80` by elimination and `2/80` by mutual destruction; `evacuation` ended `78/80` by elimination and only `2/80` by `Landed on Terra with colonists!`; `convoy` ended `66/80` by elimination, `10/80` by `Landed on Venus with colonists!`, and `4/80` by timeout. The balance harness currently considers those runs "healthy", but from a gameplay perspective they show that the AI under-values the actual win criteria.

### Reweight target-body races around imminent completion, not just distance (P1)

`src/shared/ai/scoring.ts` currently rewards target-body progress mostly through distance reduction, velocity alignment, and a large terminal landing bonus. That means "already on a clean landing line next turn" and "still technically getting closer but drifting into a fight" can score too similarly until the final landing turn.

Action: extend objective navigation scoring so orbit setup, next-turn landing windows, braking discipline, and preserving a favored race line score much more strongly. Penalize leaving a line that remains ahead on projected landing time even if the detour improves local combat geometry.

### Narrow the Bi-Planetary home-screening override to true emergency states (P1)

`src/shared/ai/common.ts` applies `getHomeDefenseThreat()` plus `scoreObjectiveHomeDefenseCourse()` to single-ship target-body duels. In practice that can pull a Bi-Planetary ship off its own landing race and back toward home whenever the opponent is merely projected closer to the home world than the AI is to its target.

Action: replace the coarse "screen home if opponent is ahead by a couple of hexes" rule with a race-aware check that only defends when the opponent is genuinely about to win first and the intercept line improves that outcome more than continuing the AI's own scoring run.

### Make combat and ordnance choices prove they help the scenario objective (P1)

`src/shared/ai/scoring.ts`, `src/shared/ai/combat.ts`, and `src/shared/ai/ordnance.ts` still value many engagements on local odds, range, and disabled-target bonuses, even in scenarios where the right answer is to keep flying or cover the carrier. The current "objective contested" check is too soft: it keeps combat incentives alive in race scenarios long after the better strategic move is to continue the win line.

Action: add scenario-aware combat and ordnance gates so target-body racers, blockade runners, and passenger carriers only trade position or fire when the engagement materially delays the enemy objective or protects an otherwise losing objective line.

### Retune passenger-carrier doctrine so arrival outranks hull quality (P1)

The escort scenarios already have bespoke passenger logic in `src/shared/ai/logistics.ts` and `src/shared/ai/astrogation.ts`, but the fresh samples still end overwhelmingly by elimination. The current carrier/transfer scoring appears too willing to prioritize stronger or safer hulls over simply keeping the passengers on the best arrival line.

Action: revisit `scorePassengerCarrier()`, transfer thresholds, and escort posture so the AI strongly prefers preserving a viable destination runner. Reassign passengers only when the new carrier materially improves arrival odds, not just combat strength or generic ship value.

### Add objective-discipline regression tests and simulation thresholds (P2)

The current AI tests cover safety, escape-edge behavior, and one Bi-Planetary home-screening case, but they do not assert that target-body and passenger scenarios actually behave like target-body and passenger scenarios. `scripts/simulate-ai.ts` records win reasons, yet CI only checks crash-free execution and broad seat-balance thresholds.

Action: add focused regression fixtures for "take the landing line", "do not abandon the carrier's scoring route without immediate danger", and "narrow the existing Bi-Planetary defense test to real emergency cases". Extend the simulation harness with per-scenario objective-completion expectations or at least warnings when objective scenarios resolve almost entirely by elimination.

## Launch-readiness snapshot (2026-04-19)

Pinned by an exploratory pass on production (see [EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md) pass log). Update or remove this section when the listed items are resolved or reassessed.

**P0 — launch-blockers** (data integrity or scenario design, fix before any public traffic):

- None currently pinned. Re-rank after each exploratory / QA pass.

(Note: the seat-hijack / unauthenticated-join finding is **not** P0 — by product decision, frictionless start outweighs private-room auth. Listed under polish below for the spectator-misadvertisement and structured-rejection parts only.)

**P1 — pre-launch polish** (player-visible weirdness or abuse surface, fix soon):

- **Grand Tour AI is now finishing the tour, but the scripted route is still heavily Mars-favored.** The 2026-04-21 waypoint fix replaced the universal 499-turn progress-tiebreak deadlock with real objective completions, but current hard-vs-hard samples are still extremely lopsided: `grandTour 60 -- --ci` came back `0/60` for P0 and `60/60` for P1, all by `Grand Tour complete! Visited all 8 bodies.` The original “AI cannot complete the race” bug is closed; the remaining work is seat-balance and route quality, not timeout rescue. Action: keep the deterministic routing only as the stability baseline, then either (a) derive a more symmetric per-home waypoint set, or (b) replace the full scripted route with a smaller waypoint layer plus better checkpoint-return logic so both seats complete consistently without one side getting a free path. Add a simulation regression that keeps completion high while also flagging gross seat skew in this scenario. **Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`, `scripts/simulate-ai.ts`

**Fixed since opening** (re-verified 2026-04-19 on production):

- `POST /create` validates scenario (`invalid_payload`), empty body, and payload size (1024-byte cap via `payload_too_large`).
- `/api/matches?limit=abc` / `?limit=99999` / `?status=bogus` / `?before=garbage` / `?winner=*` / `?scenario=*` return 400 with `invalid_query` — full filter validation now complete.
- `/api/leaderboard?limit=abc` / `?limit=-1` / `?includeProvisional=garbage` return 400.
- `/join/{code}` returns `{ok, scenario, seatStatus}` — matches the "room metadata" doc contract.
- `delta_v_reconnect` shipped in local MCP; hosted session/event parity work also shipped for `delta_v_list_sessions`, `delta_v_get_events`, and `delta_v_close_session`.
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

During exploratory testing 2026-04-19 via Claude-in-Chrome MCP, a Play-vs-AI (Duel scenario) session got stuck on Turn 1 Ordnance: SKIP SHIP / CONFIRM PHASE buttons didn't respond to programmatic `.click()`, only to physical clicks via the MCP computer tool. Eventually the canvas renderer froze (screenshot calls timed out; `document.querySelector('canvas')` stayed responsive). Could be a real bug (event handler blocking on `isTrusted` or similar) **or** an artefact of the CDP-driven tab not being the foreground window (`document.hidden === true` inside the MCP tab — see note below). The code path goes `src/client/ui/events.ts → ui-event-router.ts → command-router.ts` (action-deps wiring is now inlined directly in `client-kernel.ts`).

**Triage step:** reproduce manually in a normal foreground browser window (no browser automation). The current report came from a CDP/MCP-controlled tab where synthetic `.click()` failed but physical clicks worked while the tab also reported `document.hidden === true`, so this may be automation-specific rather than a gameplay bug. Do **not** patch button/ordnance routing speculatively until a real-user repro exists. If SKIP SHIP / CONFIRM PHASE respond to real clicks and the renderer stays live, close as CDP-specific; otherwise capture `console.log` / `performance.now()` timing and file as a P1 bug against the failing layer (input dispatch, command routing, phase state, or renderer).

**Files:** potentially `src/client/ui/button-bindings.ts`, `src/client/game/ordnance.ts`, `src/client/game/command-router.ts`

### Contrast audit (quantified)

Run WCAG contrast / readability measurements each release using [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md) § **Contrast & readability** and [A11Y.md](./A11Y.md); tune CSS from findings.

**Files:** `static/styles/*.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Enforce notification channel precedence in code

Remaining audit: session UI effects / reactive wiring, telemetry-driven copy, and any logistics paths that still mirror the game log as a toast. Turn timer, local astrogation/ordnance validation, local emplacement success, structured `actionRejected` hints, “no enemies” camera hint, and local-only replay now use HUD/sound or the game log instead of stacking toasts. Connection, reconnect, and session errors stay on the toast channel per policy.

**Files:** `src/client/ui/overlay-view.ts`, `src/client/game/session-ui-effects.ts`, `src/client/game/session-signals.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/game/command-router.ts`, `src/client/telemetry.ts`

### Digital-input parity for map selection and targeting

**Done (phase 1):** combat **[`]` / `[`]** cycles eligible enemy ships/nukes (same visibility rules as pointer targeting), updates planning via `cycleCombatTarget` → `setCombatPlan`, centers the camera on the new target, and shows **Target: …** on the HUD status line (desktop hint includes `[ ]`).

**Done (phase 2):** combat **`{` / `}`** cycles legal attackers for the selected target, updates planning on the same command path, recenters on the attacking stack, and makes mixed-hex attacker selection reachable without pointer-only clicks.

**Done (phase 3):** standard-mapped gamepads now drive the same command path: **A/B** confirm/cancel, **LB/RB** cycle ships, **D-pad** cycles combat targets/attackers, and **X/Y/Start/Back** map to log/focus-help/mute shortcuts without inventing a separate controller input stack.

**Remaining:** other tactical picks that are still pointer-first.

**Files:** `src/client/game-client-browser.ts`, `src/client/game/client-runtime.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud.ts`, `static/index.html`

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

**Files:** `src/server/matchmaker-do.ts`, `src/shared/scenario-definitions.ts`, `src/shared/ai/`, `scripts/simulate-ai.ts`

### High timeout rate in `fleetAction`

`grandTour` no longer records null timeouts in the simulation harness: when the phase cap trips in a checkpoint race, `scripts/simulate-ai.ts` now resolves a progress tiebreak from visited checkpoint count, surviving ships, and estimated remaining tour distance. A fresh 30-game hard-vs-hard sample came back `46.7/53.3` with **0** timeouts, `4` progress-tiebreak wins, `4` full race completions, and a reduced average length of `102.2` turns. `fleetAction` has improved after the closing-pressure override, but still times out often enough to need another larger seeded sweep before dropping the item.

Follow-up seeded sweep 2026-04-20 (`8` base seeds × `30` games = `240` total) still showed `28` timeouts (`11.7%`) and wide seed variance (`39.3%` to `70.4%` P0 decided-win rate, ~`55.2` average turns overall). So this was still a live tuning item, not just a remeasurement chore.

**Done for this slice:** the fleet-builder no longer optimizes `fleetAction` into near-all-corvette swarms that can barely carry ordnance. It now rewards mixed warship fleets with real torpedo capacity, and the scenario-local closing override is stronger (`combatClosingWeight: 5`, `combatCloseBonus: 75`) so those fleets commit sooner once they enter range. A fresh 240-game hard-vs-hard sample moved to `121/101/18` (`50.4/42.1`, `7.5%` timeouts, `46.4` average turns), which is still materially better than the earlier `102/106/32` (`13.3%` timeouts, `59.9` turns) sample on the old doctrine.

**Remaining:** this is now close to "good enough" rather than a clear launch-readiness issue. Only revisit if future larger seeded sweeps drift back above ~`8–10%` timeouts or reintroduce a strong P0 blowout.

**Files:** `src/shared/ai/`, `scripts/simulate-ai.ts` (turn cap), `src/shared/scenario-definitions.ts`, `src/shared/engine/victory.ts` (tiebreak)

### Seat-balance drift after 2026-04-21 AI changes

Re-ran the balance sweep after Stream 1's landing-approach / target-race / blockade-objective AI commits (`dcd8626`, `6b08de7`, `cf9b8ee`, `b6b84ec`, `9d9a04c`, `9861219`, `a22baa7`, `8f0a9d1`) shipped to main. Two 30-game hard-vs-hard runs per scenario produced a few scenarios that now drift outside the harness's seat-balance warning band:

| Scenario | P0% | P1% | Draws | Avg turns | Warning |
|---|---:|---:|---:|---:|---|
| evacuation | 26.7–33.3 | 66.7–73.3 | 0 | 2.8 | P0 decided rate outside `[35-65%]` |
| convoy | 73.1–75.0 | 20 | 0–2 | ~42 | P0 decided rate outside `[30-70%]` |
| fleetAction | 37.9–60.0 | 33–42 | 1–2 | ~30–49 | first run showed P0 outside `[45-80%]` |
| biplanetary | 50 / 50 | — | 0 | 8.5 | but 96.7% `Fleet eliminated!` / 3.3% objective |

Evacuation specifically: the earlier "**Fixed since opening — Evacuation scenario balance fixed: 100-game sweep now 63/37**" launch-readiness entry no longer holds on 30-game runs; the P0 decided rate swung back to ~33% (P1 dominance). At 2.8 avg turns it's decided very quickly — likely one of the new scoring weights is overshooting. Convoy P0 is now 73-75% (decisive but lopsided). FleetAction has wider seed variance than before.

Needs a 100-game hard-vs-hard sweep to confirm signal vs 30-game noise, then targeted tuning. None of these is a launch-blocker on its own, but stacked with the Grand Tour deadlock they point to collateral damage from the latest AI sweep that wasn't caught by the CI gate (which is deliberately wide at 45-85% P0 for `grandTour` / `duel` only).

**Files:** `src/shared/ai/scoring.ts`, `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`, `src/shared/scenario-definitions.ts`, `scripts/simulate-ai.ts`.

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

**Files:** `src/shared/ai/config.ts`, `src/shared/ai/`, `src/client/ui/lobby-view.ts` (difficulty selector copy), `scripts/simulate-ai.ts`

---

## Agent & MCP ergonomics

Gaps in local vs hosted MCP parity, first-class resources, and structured rejection surfaces for autonomous play.

### Structured action-rejection reasons

**Done for this slice:** submitter-only `actionAccepted` now carries `guardStatus: inSync | stalePhaseForgiven` so local MCP, hosted MCP, browser clients, and agent scripts can distinguish forgiven phase drift from fully in-sync submissions without overloading `actionRejected`.

**Done for this slice:** engine validation/resource failures that are still submitter-scoped now map into typed `actionRejected` reasons instead of collapsing to a generic `error` transport message.

**Done for this slice:** the remaining room/runtime failures (`ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_IN_PROGRESS`) are now explicitly covered as intentional plain-error cases, so all engine-invalid submitter-scoped failures are on the structured `actionRejected` path and only true room/runtime conditions stay on the generic error channel.

**Files:** `src/server/game-do/action-guards.ts`, `src/shared/types/protocol.ts`, `src/shared/protocol.ts`, `scripts/delta-v-mcp-server.ts`, `src/client/game/client-message-plans.ts`

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Baseline controls are documented in [SECURITY.md](./SECURITY.md).

### Clear the transitive `hono` advisory in the MCP adapter chain

`npm audit --omit=dev` still reports `GHSA-458j-xx4x-4375` through `@modelcontextprotocol/sdk -> hono`. The current codebase does not appear to use the affected JSX SSR path, so this is not the top security issue, but it should still be tracked as dependency hygiene and cleared when the MCP SDK chain updates.

**Files:** `package.json`, `packages/mcp-adapter/package.json`

## Telemetry & observability

### `events` table is write-only from the app — analysis relies on ad-hoc SQL

Exploratory pass 2026-04-20: the [`events` D1 table](../migrations/0001_create_events.sql) is written by `src/server/reporting.ts` (browser `/telemetry` + `/error` ingest) and `src/server/game-do/telemetry.ts` (server-side turn/fleet/action events), but **no application code reads it back**. There is no admin endpoint, no scheduled aggregation, no dashboard. The data is only queryable via `wrangler d1 execute` SQL one-liners, which means it doesn't currently drive any decisions.

To turn this telemetry into something useful for "analysing issues and improving the game once there are many players", we need at minimum:
- A small internal `/api/metrics` endpoint (auth-gated) that returns common aggregates: daily-active matches, scenario play mix, AI difficulty distribution, first-turn-completion rate, WS error rate, reconnect success rate, average turn duration per scenario.
- **Done for this slice:** [OBSERVABILITY.md](./OBSERVABILITY.md) now carries documented SQL recipes for replay/discovery engagement, rating-history audit, matchmaking health, reconnects, and scenario popularity instead of leaving analysis as pure ad-hoc shell history.
- Optional: scheduled export to R2 / BigQuery for longer-horizon analysis when D1 retention trimming kicks in.

**Files:** `src/server/reporting.ts`, new `src/server/metrics-route.ts`, `docs/OBSERVABILITY.md`

### Telemetry coverage gaps — no signal for spectator / replay engagement

Exploratory pass 2026-04-20: the existing `trackEvent` calls cover matchmaking lifecycle, turn/fleet actions, WS errors, and reconnect churn (`quick_match_*`, `game_over`, `turn_completed`, `ws_connect_error`, `reconnect_succeeded`). What's missing is any signal for **post-match and discovery surfaces**:

- `leaderboard_viewed` and `matches_list_viewed` are now emitted from the public HTML pages on first successful load, so we can tell whether those discovery surfaces are used at all.
- Replay engagement now emits `match_replay_opened`, `replay_reached_end`, `replay_exited_early {atIndex, atTurn, progress}`, and `replay_speed_changed {speed}` from the shared replay controller, covering both archived and post-game replay entry points.
- Still no `leaderboard_row_clicked` — the current leaderboard rows are not interactive, so there is nothing to click-track yet.
- No `scenario_selected {scenario, from: 'ai'|'private'}` — we lose the scenario-popularity signal at the menu level (only the final `ai_game_started` fires, by which point the user already committed).
- No connection-quality metric over a session (RTT, out-of-order frames). We log `ws_invalid_message` but not steady-state health.

**Files:** `src/client/game/main-session-shell.ts`, `src/client/game/replay-controller.ts`, `src/client/leaderboard/*.ts`, `static/matches.html`, `static/leaderboard.html`

### `match_rating` keeps pre/post rating columns write-only — keep as audit trail, document intent

**Done for this slice:** the intent is now documented both in [`migrations/0004_leaderboard.sql`](../migrations/0004_leaderboard.sql) and [OBSERVABILITY.md](./OBSERVABILITY.md), so the `match_rating` pre/post columns are explicitly preserved as a rating-history audit trail rather than looking like dead schema.

**Files:** `migrations/0004_leaderboard.sql`, `docs/OBSERVABILITY.md`

## Architecture & correctness

### Deterministic initial publication path

**Done for this slice:** `initGameSession` already publishes via the same `GameDO.publishStateChange` → `runPublicationPipeline` path as post-init actions; `getActionRng()` breach fallbacks now use fixed-seed `mulberry32` streams instead of `Math.random` so any accidental call stays replayable while warnings surface the bug.

**Remaining:** optional further deduplication if `match.ts` should call `runPublicationPipeline` without the `publishStateChange` indirection.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

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
