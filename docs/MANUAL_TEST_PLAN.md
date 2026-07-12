# Manual Test Plan

Hands-on verification for release candidates and significant changes. Each section is self-contained — run only the ones relevant to what changed. Related docs: [SPEC.md](./SPEC.md) for game rules, [SIMULATION_TESTING.md](./SIMULATION_TESTING.md) for automated harnesses, [EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md) for open-ended discovery passes (different intent — that doc helps you find unknown issues; this one verifies known requirements).

## Release gate

Any of these is a blocker:

- A new player cannot start **Bi-Planetary** and finish turn 1 using only in-game guidance.
- The current player, selected ship, objective, or next required action is unclear at any point.
- Multiplayer create / join / reconnect / chat / rematch / disconnect resolution is flaky.
- Mobile / touch has blocked actions, overlapping HUD, or unreadable text.
- PWA offline single-player is broken.
- A 20-30 minute session shows serious stutter, dropped input, stale UI, or unclear win/loss messaging.
- An asymmetric scenario (Convoy, Lunar Evacuation, Escape, Blockade Runner) hides which side the player is on. The briefing **description** plus the per-seat objective must together communicate the role. Per-seat copy lives in [src/client/ui/scenario-briefing-copy.ts](../src/client/ui/scenario-briefing-copy.ts); if a new asymmetric scenario lands without a per-seat entry, players will see the shared description beside a misaligned objective. See § 6a.
- A Beginner-tagged race scenario (Bi-Planetary, Blockade Runner) is functionally a combat scenario in a 5+ game live sample — i.e. zero of those games end on the intended landing. Confirm with the Lens 11 query in [EXPLORATORY_TESTING.md § R20](./EXPLORATORY_TESTING.md#r20-d1-r2-storage-audit).
- A fleet-build scenario traps the player in fleet building without a visible exit/back affordance before launch.

When a test fails, record browser, device, scenario, seat, steps, and whether the failure is correctness, clarity, performance, or recovery.

## Contrast & readability (WCAG AA spot-check)

Use the browser accessibility / color picker or an external contrast checker on translucent panels (not only solid menu backgrounds):

- **Help overlay** (`#helpOverlay`): stacked `.help-group` body copy on semi-transparent panels — aim for **≥ 4.5 : 1** for normal-sized text against the effective background (stacked layers + `backdrop-filter` change perceived luminance).
- **Game-over** stat pills and any queue / status strips that use muted text on glassy fills.

## Recommended matrix

- Desktop Chromium, mouse + keyboard
- Desktop Safari or Firefox, trackpad
- Phone-sized viewport (375 × 812) and one real device if available
- Installed PWA shell (if the browser supports it)
- Fresh profile once per release for tutorial/reconnect/audio/help-state coverage

Cover single-player online, single-player offline, two-tab multiplayer, and refresh/reconnect/rematch.

## Agent / MCP smoke (pre-release, optional)

Run when agent protocol, MCP adapter, matchmaking, or `scripts/benchmark.ts` changes.

1. **Sandbox MCP smoke** — run `npm run mcp:sandbox-smoke` and confirm the JSON summary reports `"ok": true`, at least four submitted actions, hosted match resources checked, no validation/send issues, and no public live-list exposure for the sandbox match.
2. **In-process benchmark** — `npm run benchmark -- --agent-command "<your agent>" --opponent easy,normal,hard --scenario duel --games 10` (tune flags per `scripts/benchmark.ts --help`). From the JSON summary, check each `matchups[]` row: **`actionValidityRate` ≥ 0.95**, **`parseErrorRate` === 0**, **`timeoutRate` < 0.05** (stricter is fine).
3. **Concurrent hosted MCP** — run `scripts/mcp-six-agent-harness.ts` and confirm it finishes **three** concurrent matches without Durable Object errors or stuck tickets.
4. **Live quick-match agent** — run `scripts/quick-match-agent.ts` against each AI difficulty for a small **N**; confirm stable action acceptance and no systematic JSON parse failures.

Skip this section when the release did not touch agent or MCP surfaces.

---

## 1. Smoke test (2 min, Bi-Planetary vs AI)

1. Open the app. Menu shows title, difficulty, and play options.
2. Pick **Easy**, then **Bi-Planetary**. Status indicates first-burn fuel cost and free takeoff.
3. Click a direction arrow (or press **1–6**, **0** to clear). Course preview and fuel-cost label appear.
4. Click **CONFIRM** / press **Enter**. Ship animates. HUD updates.
5. AI takes its turn. Yours resumes.

**Pass:** takeoff, movement, and AI response all work.

### 1a. First-time UX (fresh profile, 5 min)

Start from the menu without opening any docs. Within the first 10 s it should be obvious which ship is yours, the goal, and the next action. Finish turn 1 without guessing what CONFIRM will do. Make and recover from a deliberate mistake (wrong burn / selection) using in-game affordances (deselect, undo, help). After the AI turn, within 3 s you should know: objective, selected ship, next action, why the last event happened. Reach turn 3 without external explanation.

Open **Play vs AI** and confirm **Training Flight** is the prominent recommended card above the staged mission groups. It must launch an Easy Bi-Planetary game, replay the tutorial even for a profile that previously completed it, label an unchanged takeoff plan **STAY LANDED**, and change to **CONFIRM COURSE** after a burn is plotted. Before the first burn, exactly one safe direction has a glowing gold **TRY** marker; after movement, the log explains whether the ship moved toward or away from the target and whether momentum continues in that direction. The course summary must show fuel cost, resulting speed, and any known gravity, landing, map-exit, or crash outcome. At game over, the training summary names the skills learned and **Next: Duel** launches an Easy Duel. Open **Create Private Match** separately and confirm Training Flight is absent there while all normal scenario groups remain available.

Each tutorial tip should give one immediate instruction rather than a rules paragraph; the Help path owns the deeper explanation. For a first-turn telemetry spot-check, confirm `first_turn_action` emits each successful milestone at most once for the loaded match (`ship_selected`, `burn_planned`, `undo_used` / `help_opened` when used, and `orders_confirmed`), then confirm the existing `first_turn_completed` event follows when turn 1 actually rolls over.

### 1b. Moderated first-time-player sessions (five newcomers)

Use five people who have never played Delta-V and a fresh browser profile for each. Do not show documentation. Say only: “Start Training Flight and think aloud.” If someone is stuck, wait 30 seconds before offering help and record the exact prompt required. Do not collect names, account details, or recordings unless separately consented; aggregate notes are sufficient.

For each session, record elapsed time and whether assistance was needed for: identifying their ship and objective, plotting the first burn, explaining the dashed preview and fuel cost, using Undo after a deliberate wrong burn, completing turn 1, explaining momentum after the movement feedback, understanding the training summary, and choosing the next mission. End with three neutral questions: “What is your goal?”, “What will happen if you do not burn next turn?”, and “What would you play next?”

The onboarding passes when at least 4/5 players plot and confirm turn 1 without prompting and can explain fuel plus the route preview, at least 4/5 recover the deliberate mistake, and at least 3/5 can state the objective and momentum model before starting the suggested Duel. Record recurring confusion as clarity defects with the screen, wording, and observed behavior—not proposed solutions—before prioritizing changes.

## 2. Vector movement (Bi-Planetary)

- **Velocity persists:** confirm a burn, then confirm with no burn — ship coasts at same velocity.
- **Burn shifts endpoint** by exactly 1 hex in the chosen direction; fuel-cost label appears.
- **Gravity deflects one turn later:** yellow arrows in passing gravity hexes; cyan dashed arrows next turn show deferred deflection; edge-of-hex passes do **not** deflect.
- **Weak gravity (Grand Tour, past Luna / Io):** single hex is optional; two consecutive make the second mandatory.
- **Overload (Duel warships):** double-circle icon, 2 fuel cost, unavailable after use until resupply.
- **Non-warships cannot overload** (Convoy tanker, Liner): option absent.

## 3. Landing & takeoff (Bi-Planetary)

Start landed → take off → orbit → land on opponent's base. Booster takeoff is free but the initial burn costs 1 fuel. Landing requires first being in orbit. Intersecting a planet off-base = destruction.

## 4. Combat (Duel vs AI Hard)

- **Attack:** preview shows a compact odds/modifier badge over the selected target. ATTACK resolves the selected attack; END COMBAT finishes the phase; result toast shows outcome.
- **Counterattack:** fires at its own odds if defender is still eligible.
- **Damage / recovery:** disabled ships drift for the stated number of turns, decrease by 1/turn. ≥ 6 cumulative disabled turns = elimination. Base landing repairs all damage.
- **Planetary defense (Bi-Planetary):** enemy entering gravity hex above your base is fired at 2:1 with no range/velocity mods.
- **Range / velocity modifiers:** dice penalty is 1 per hex of range; 1 per hex of velocity difference above 2.
- **LOS:** blocked by planets / moons / Sol; ships and asteroids do not block.

## 5. Ordnance (Duel or Convoy vs AI)

- **Mine (N):** inherits ship velocity; launching ship must change course that turn; 5-turn self-destruct; detonates on hex intersection.
- **Torpedo (T):** warships only; 1–2 hex launch boost; single-target; misses continue.
- **Nuke (K, Escape-only):** inherits velocity; destroys everything in its hex; guns/PD can shoot down at 2:1; clears asteroid hex.
- **Restrictions:** no launch while resupplied, while landed, or more than once per ship per turn.

## 6. Scenarios (verify each starts correctly and applies its rules)

Scenarios and their rules are fully specified in [SPEC.md § Scenarios](./SPEC.md#scenarios). Quick verification:

- **Bi-Planetary** — land on opposite planet.
- **Escape** — hidden fugitive ship; only nukes (no mines/torpedoes); planetary defense disabled; moral victory on Enforcer disable.
- **Convoy** — liner + tanker + frigate escort; logistics enabled; land a ship on Venus with colonists, or verify pirates win immediately once no colonists survive.
- **Lunar Evacuation** — currently hidden from the player-facing scenario picker; keep engine/simulation checks active before re-enabling. Transport + corvette + frigate evacuation force; passenger rescue enabled; win requires passengers aboard; interceptor wins immediately once no colonists survive.
- **Duel** — last ship standing.
- **Blockade Runner** — packet with head-start velocity; land on Mars.
- **Fleet Action** — asymmetric 600/400 MC fleet build (section 8).
- **Interplanetary War** — 850 MC fleet build; logistics; longer play.
- **Grand Tour** — combat disabled; shared bases; visit 9 checkpoint bodies and return home.

### 6a. Per-seat briefing & objective (asymmetric scenarios)

For Convoy, Lunar Evacuation, Escape, and Blockade Runner the human is randomly assigned P0 or P1 by `Math.random()`. The briefing now overrides the shared scenario description with seat-specific narration in [src/client/ui/scenario-briefing-copy.ts](../src/client/ui/scenario-briefing-copy.ts); the objective remains per-seat. Force each seat (`globalThis.__DELTAV_FORCE_PLAYER_SIDE = 0` then `= 1` before clicking the scenario card) and verify the description and objective tell the same story:

- **Convoy P0** (escort, Mars→Venus): description mentions the colonist liner / escort role; objective shows `Land on Venus`.
- **Convoy P1** (pirates, intercept): description mentions hunting the convoy / destroying the liner; objective shows `Destroy all enemies`.
- **Lunar Evacuation P0** (rescue): description mentions evacuating Luna survivors / the carrier; objective shows `Land on Terra` (with passengers). Lunar Evacuation is hidden from the lobby for now; run this check before re-enabling the card.
- **Lunar Evacuation P1** (corsair interceptor): description mentions cutting off the transport; objective shows `Destroy all enemies`.
- **Escape P0** (pilgrim transports): description mentions hiding fugitives in a 3-transport formation and breaking north; objective shows `Fly ★ ship off the north map edge`.
- **Escape P1** (enforcer): description mentions inspecting / capturing / destroying transports; objective shows `Inspect, capture, or destroy fugitives`.
- **Blockade Runner P0** (packet): description mentions the head-start velocity and avoiding a fight; objective shows `Land on Mars`.
- **Blockade Runner P1** (corvette): description mentions intercepting the packet's path; objective shows `Destroy all enemies`.

**Fail** if the description and objective describe opposite roles (the regression that prompted this section, where Convoy P1 read "escort the liner" beside `Destroy all enemies`).

### 6b. Intended-objective conformance (live data)

After a release that touches scenario rules, AI behaviour, or scenario-specific UI affordances, run the Lens-11 D1 query in [EXPLORATORY_TESTING.md § R20](./EXPLORATORY_TESTING.md#r20-d1-r2-storage-audit). For each scenario with > 5 archived live games, expect:

- **Bi-Planetary, Blockade Runner, Grand Tour:** > 50 % of decided games end on a `Landed on …` / `Grand Tour complete!` outcome (the intended objective). 0 % means the scenario is functionally a combat scenario in production even when the briefing promises a race.
- **Convoy, Lunar Evacuation:** decided games should be a mix of `Landed on … with colonists!` (escort) and `Fleet eliminated!` (corsair). 100 % elimination on either side suggests AI/balance pressure pushes both seats to attrition regardless of objective.
- **Duel, Fleet Action, Interplanetary War, Escape:** elimination-dominated outcomes are expected.

If the live distribution diverges from the AI-vs-AI Hard simulation (`npm run simulate -- <scenario> 30 --ci`) by more than ~30 percentage points on the intended-objective share, that is a release-blocking scenario-design finding regardless of test pass/fail in any other section.

## 7. Multi-ship management (Escape vs AI)

No ship auto-selected; HUD prompts selection. Clicking ships toasts the selection. Clicking stacked ships cycles them. **Tab** cycles through own ships. Set burns for all ships → status shows "All burns set"; confirm animates simultaneously.

## 8. Fleet building (Fleet Action / Interplanetary War)

Budget shown; ship cards show stats + cost; over-budget ships greyed. × removes a ship; **CLEAR** resets; **LAUNCH FLEET** starts the match. AI also builds a fleet. **Exit to menu** / **Back** must be available before launch; a player who opens Fleet Action or Interplanetary War by mistake must not have to buy and launch a fleet to leave.

## 9. Logistics (Convoy vs AI)

Match two friendly ships to same hex + velocity → logistics phase appears after movement → transfer panel works. **Torch ships cannot transfer fuel to others** (Interplanetary War with a torch). Logistics phase is **skipped** in scenarios without `logisticsEnabled` (Bi-Planetary, Duel).

## 10. Combat edge cases

- **Mutual destruction:** when the last two ships kill each other, the non-attacker wins ("Mutual destruction — last attacker loses!").
- **Disabled exceptions:** dreadnaughts may fire while disabled; damaged orbital bases may fire at D1.
- **Multi-ship attack (Fleet Action):** combined strength with highest applicable range and velocity penalties.
- **Defensive-only ships:** 1D / 2D suffix (Transport, Tanker, Liner) — no ATTACK button with only defensive ships available.
- **Ramming:** course through an occupied hex → both ships take damage from the ramming table; mines/torpedoes in the hex also detonate.
- **Asteroid hazards:** 1 roll per asteroid hex entered at speed > 1; hexside between two asteroid hexes = 1 roll.

## 11. HUD & information

- **Top bar:** turn number + phase name, fuel/speed, objective, fleet count.
- **Phase banner:** brief centered overlay on phase change; auto-dismisses.
- **Tooltips:** hover / tap a ship → type, fuel, cargo, velocity, damage.
- **Log panel (desktop L toggle):** color-coded, chronological.
- **Game over:** VICTORY / DEFEAT + reason; turn count + fleet counts; REMATCH and EXIT work.
- **Clarity check:** at any moment you can answer in 3 s — whose turn, which ship, whether waiting for input or animating, what CONFIRM/FIRE ALL will do. Unavailable actions explain why.
- **Accessibility basics:** 150 % zoom stays readable; low-fuel / urgent-timer / victory states aren't conveyed by color alone.

## 12. Camera & navigation

Pan (drag / WASD / arrows), zoom (scroll / pinch / +/−), zoom range 0.15× – 4.0×, auto-frame during movement, minimap click-to-jump, **H** centers fleet, **E** focuses nearest enemy.

## 13. Keyboard & focus safety

| Key | Expected |
| --- | --- |
| 1-6 / 0 | Burn direction / clear |
| Enter | Confirm / fire |
| Escape | Deselect |
| Tab | Cycle ships |
| ? | Toggle help |
| L | Toggle log panel (desktop) |
| N / T / K | Mine / Torpedo / Nuke (ordnance phase) |
| E / H | Focus enemy / center own fleet |
| M | Toggle sound |
| WASD / Arrows | Pan |
| +/− | Zoom |

Menu: **Tab** / **Shift+Tab** works; visible focus always present. Typing in chat input does **not** trigger game hotkeys; clicking back into the game re-enables them.

## 14. Mobile / touch (375 × 812)

- **Menu:** all buttons tappable; scenario list scrolls if needed; touch targets ≥ 48 px.
- **Gameplay:** log starts collapsed as a single-line bar; tap expands as overlay; all action buttons have adequate targets; top bar never overflows; ship list scrolls without overlapping.
- **Phase banner:** on 320 × 568, 360 × 640, and 375 × 812 portrait, start a scenario and wait through the first five seconds after the phase banner appears. It must not visibly cover the selected ship card, fuel/status text, or action buttons.
- **Touch language:** status says "Tap" not "Click"; no Enter / keyboard hints; burn circles have no number labels; help overlay shows touch instructions only.
- **Landscape:** HUD compacts; canvas usable; no overlap.
- **Comfort:** pan-drag doesn't issue commands or select text; pinch-to-zoom doesn't zoom the page; opening log / help / chat doesn't hide controls behind keyboard or safe area; backgrounding + restoring preserves layout and selection.

## 15. Resupply & bases

Land a damaged or low-fuel ship at a friendly base → next turn: fuel restored, damage repaired, overload allowance restored, ordnance reloaded. Same-turn gun/ordnance use is blocked. Grand Tour shared bases serve both players.

## 16. Multiplayer (two tabs or devices)

- **Create / join:** code + Copy Link + manual entry all work; invalid code errors clearly; full room fails clearly.
- **Presence / chat:** transition from waiting to playing is visible on both sides; each chat appears once with correct attribution; objective / turn ownership / ship state match on both sides; latency indicator doesn't clash with HUD.
- **Turn timer:** appears after grace; styling gets urgent near expiry; warning sound/visual fires once; action resets it.
- **Reconnect:** refresh one tab → reconnects to same seat; stale tab stops receiving updates; close-and-reopen under 30 s with stored token continues the match; post-reconnect UI matches the other player's view.
- **Disconnect forfeit:** one player disconnected > 30 s → the other wins by forfeit with a clear reason.
- **Protocol surrender:** in a private Duel, send a raw WebSocket or MCP `surrender` action for every active ship owned by the current player. **Pass:** the game resolves immediately or advances through a documented end-of-turn path; it must not leave the same surrendered player active with `outcome: null` and require disconnect forfeit to finish.
- **Rematch / exit:** REMATCH starts a fresh match with reset state; EXIT returns to menu cleanly.
- **Post-game replay selector:** finished two matches in the same room → `-m1` / `-m2` in the selector; start / prev / next / end navigation works; EXIT REPLAY restores the latest match outcome.
- **Archived replay (connecting):** open a spectator/archived replay URL (room code plus `gameId`, or the in-app path) so the **Connecting** overlay appears while the timeline fetch runs. Press **Cancel** or exit to the menu before loading finishes. **Pass:** you land on the menu without a flash of wrong endgame state from a late response; starting the same or another replay afterward behaves normally.

## 17. AI opponent

- **Easy:** basic moves; beatable by a beginner.
- **Normal:** uses gravity assists; tactical choices; fair challenge.
- **Hard:** aggressive; optimal movement; uses ordnance.
- **Known scenario risk:** Lunar Evacuation is hidden from the player-facing scenario picker for now while passenger-rescue balance and briefing clarity are watched. The 2026-05-02 live pass against deployed hash `f49fcdfb` still measured the non-randomized side assignment as very short and rescue-favored (`evacuation 60 --ci --quiet --json`: P0 decided 81.7 %, average 2.02 turns). A randomized-start 80-game scorecard balanced the winner split better but still averaged only 3.26 turns. Keep engine/simulation coverage active; do not sign off a release that changes passenger rescue, scenario setup, or AI movement without a focused Evacuation scorecard before considering re-enabling it.
- **Blockade Runner release gate:** use the production-start scorecard (`npm run simulate -- blockade 60 --ci --quiet --json`) unless the scenario is deliberately changed to randomize starts. `--randomize-start` is a useful stress check, but it forces packet-first openings that do not match the shipped `startingPlayer: 1` geometry.
- **Known scenario risk:** Fleet Action historically passed engine stability while producing a bad AI experience. The 2026-05-02 `fleetAction 40 --ci --quiet --json` scorecard on hash `f49fcdfb` reported 0 fuel stalls, 0 invalid actions, 0 crashes, and 0 timeouts; keep requiring a focused Fleet Action scorecard when touching fleet building, AI movement, or fuel-stall classification.
- **Fleet-builder flow gate:** Fleet Action and Interplanetary War both enter fleet building. Verify the visible **BACK** control and Escape key return to the menu before launch, with no ship purchase required.

Then `npm run simulate -- all 60 --ci` (the canonical form used by pre-push and CI) → expect **0 engine crashes** across all scenarios. The harness randomises starting seat only for scenarios whose simulation policy enables start-order randomization.

## 18. Sound

No audio before user interaction. **M** toggles; thrust / gun / explosion / phase / timer-warning cues play timely; never blasts on load, reconnect, or rematch.

## 19. Help & tutorial

**?** opens overlay with sections matching current controls. Fresh profile: tutorial tips appear in each relevant phase; copy matches device ("Click" / "Tap"); tips don't cover primary buttons or linger; skipping returns control cleanly. Returning players aren't forced through the tutorial.

### 19a. Tutorial completion reachability

Run when `src/client/tutorial.ts`, scenario phase rules, or the `STEPS` list change. The tutorial has six steps: four core movement tips (`welcome`, `select-ship`, `gravity`, `fuel`) and two optional phase tips (`ordnance-intro`, `combat-intro`). Completion is based on acknowledging the core movement tips; ordnance/combat tips should still appear when those phases are reached before completion.

- Start a fresh profile, pick **Bi-Planetary** Easy, walk through the welcome / select-ship / gravity / fuel tips, then play to the natural game-over.
- Confirm `tutorial_completed` appears in `events` for the session (D1: `SELECT props FROM events WHERE event='tutorial_completed' ORDER BY ts DESC LIMIT 1;`).
- In a scenario with ordnance/combat, confirm those phase-specific tips still display if reached before the core movement tips complete.
- **Fail** if completion requires a scenario without ordnance/combat to reach those phases, or if `tutorial_completed` fires before the four core movement tips have been acknowledged.

## 20. PWA / offline single-player

Install the app (if supported); launched shell looks correct. Online local AI works in the shell. DevTools offline / airplane mode: app shell still loads; start single-player AI; play ≥ 3 turns; multiplayer fails clearly (no hang). Re-enable network → online play recovers after retry or reload.

## 21. Leaderboard (`/leaderboard`)

Run when changes touch `src/server/leaderboard/`, `src/shared/rating/`, or `migrations/000*_leaderboard.sql`.

- **Public page:** `/leaderboard` loads; table ordered by rating descending; agent rows show an "Agent" badge.
- **Provisional filter:** by default, provisional players are hidden; toggling `?includeProvisional=true` surfaces them at a lower confidence. Newly-created players start in the hidden bucket until `rd` shrinks and they meet the distinct-opponents threshold.
- **Human claim:** a fresh browser profile can claim a unique username via the home-screen callsign field (backed by `POST /api/claim-name`). Re-claiming the same username from a different `playerKey` returns 409.
- **Agent claim:** `curl -sX POST /api/agent-token -d '{"playerKey":"agent_test","claim":{"username":"TestAgent"}}'` returns a 24 h token and sets `isAgent: true`. Playing one rated match updates the player's row.
- **Rank lookup:** `GET /api/leaderboard/me?playerKey=…` returns `{ username, rank, rating, … }` or 404 when unclaimed.

## 22. Edge cases / regression grab-bag

1. **Zero fuel:** ship drifts at current velocity; no burn options; gravity / resupply / map exit still apply.
2. **Map exit:** final course off the map = elimination.
3. **Nuke clears asteroid:** asteroid hex becomes clear space.
4. **Destroyed-ship cleanup:** no ghost highlight / selection; wreck-hex click doesn't error.
5. **Empty combat phase:** SKIP COMBAT available, or auto-skips.
6. **Stacked ships:** click cycles through them.
7. **Turn timer:** after 2 min idle → timeout; warning at 30 s.
8. **Rematch:** same scenario, same opponent, cleared state.
9. **`/?code=COMPLETED` URL:** if a friend sends a link to a finished game, the toast should say "That game has already completed", not the generic "No game found with that code". (Server returns `code:"GAME_COMPLETED"` with HTTP 410; client mapping is in `JOIN_ERROR_MESSAGES`.) For best UX, offer a "View replay" affordance when a `gameId` is known.
10. **`/matches` noise filter:** the public list should not be dominated by 1-turn `Opponent disconnected` rows from `POST /create` calls that never opened a WebSocket. Confirm with the Lens 13 query in [EXPLORATORY_TESTING.md § R20](./EXPLORATORY_TESTING.md#r20-d1-r2-storage-audit) and ensure the noise share stays under ~5 % — either by hiding 1-turn no-pair rows from the public listing or by not archiving rooms that never had two seats fill.

## 23. Public API surface conformance

Run when `/server/index.ts` route handlers, public endpoints, or HTTP method handling change.

- **HEAD/GET parity (R18):** for each public path, `HEAD == GET` status. Older deployed hashes exposed `/robots.txt` as a HEAD/GET drift case; current releases should keep status parity across public GET routes unless a route is intentionally unsupported.
- **Error-shape consistency (R19):** every public JSON endpoint returns `{ok: false, error, message}`. Notable exception: `GET /join/{CODE}` returns `{code, message}` for backwards compat with the existing client mapping; do not change this without coordinating both sides. New endpoints must follow the unified shape.
- **Status-param validation:** `/api/matches?status=anything` should reject unknown values with `invalid_query` rather than silently returning `[]`. Pass: unknown values return HTTP 400 with `invalid_query`. Fail: unknown values return HTTP 200 or an empty list.
- **Matchmaker scenario set:** `QUICK_MATCH_SCENARIO` in `src/shared/matchmaking.ts` is `'duel'` only. Quick Match never routes to other scenarios. If a release advertises Quick Match for another scenario (Bi-Planetary, Grand Tour, …), update both the matchmaker default and the lobby copy that says "Find the next available commander in the duel queue."

---

## Automated checks

These run in CI and don't replace manual experience checks:

| Command | What it checks |
| --- | --- |
| `npm run verify:quick` | Fast local gate (lint / typecheck / build) |
| `npm run verify` | Full local release gate (lint / typecheck / coverage / build / e2e smoke / a11y / simulation) |
| `npm test` | Unit, property, and regression tests |
| `npm run test:e2e:smoke` | Thin Playwright browser smoke |
| `npm run test:e2e:a11y` | Playwright + axe accessibility baseline |
| `npm run simulate:smoke` | Short all-scenarios AI smoke for local push checks |
| `npm run simulate -- all 60 --ci` | Engine stability / balance sweep used by full verification and CI |
| `npm run lint` / `typecheck:all` | Code style / type safety |

Playwright is intentionally small — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the layered test strategy. Scenario walk-throughs and deep rule validation belong in Vitest and simulation, not Playwright.
