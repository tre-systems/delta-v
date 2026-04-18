# Manual Test Plan

Hands-on verification for release candidates and significant changes. Each section is self-contained — run only the ones relevant to what changed. Related docs: [SPEC.md](./SPEC.md) for game rules, [SIMULATION_TESTING.md](./SIMULATION_TESTING.md) for automated harnesses.

## Release gate

Any of these is a blocker:

- A new player cannot start **Bi-Planetary** and finish turn 1 using only in-game guidance.
- The current player, selected ship, objective, or next required action is unclear at any point.
- Multiplayer create / join / reconnect / chat / rematch / disconnect resolution is flaky.
- Mobile / touch has blocked actions, overlapping HUD, or unreadable text.
- PWA offline single-player is broken.
- A 20-30 minute session shows serious stutter, dropped input, stale UI, or unclear win/loss messaging.

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

1. **In-process benchmark** — `npm run benchmark -- --agent-command "<your agent>" --opponent easy,normal,hard --scenario duel --games 10` (tune flags per `scripts/benchmark.ts --help`). From the JSON summary, check each `matchups[]` row: **`actionValidityRate` ≥ 0.95**, **`parseErrorRate` === 0**, **`timeoutRate` < 0.05** (stricter is fine).
2. **Concurrent hosted MCP** — run `scripts/mcp-six-agent-harness.ts` (see script `--help`) and confirm it finishes **three** concurrent matches without Durable Object errors or stuck tickets.
3. **Live quick-match agent** — run `scripts/quick-match-agent.ts` against each AI difficulty for a small **N**; confirm stable action acceptance and no systematic JSON parse failures.

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

- **Attack:** preview shows attacker/defender factors, odds, range modifier, velocity modifier, and "CAN COUNTER" where applicable. ATTACK queues; FIRE ALL resolves; result toast shows outcome.
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
- **Convoy** — liner + tanker + frigate escort; logistics enabled; land liner on Venus with colonists.
- **Lunar Evacuation** — passenger rescue enabled; win requires passengers aboard.
- **Duel** — last ship standing.
- **Blockade Runner** — packet with head-start velocity; land on Mars.
- **Fleet Action** — 400 MC fleet build (section 8).
- **Interplanetary War** — 850 MC fleet build; logistics; longer play.
- **Grand Tour** — combat disabled; shared bases; visit 8 checkpoints and return home.

## 7. Multi-ship management (Escape vs AI)

No ship auto-selected; HUD prompts selection. Clicking ships toasts the selection. Clicking stacked ships cycles them. **Tab** cycles through own ships. Set burns for all ships → status shows "All burns set"; confirm animates simultaneously.

## 8. Fleet building (Fleet Action / Interplanetary War)

Budget shown; ship cards show stats + cost; over-budget ships greyed. × removes a ship; **CLEAR** resets; **LAUNCH FLEET** starts the match. AI also builds a fleet.

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
- **Rematch / exit:** REMATCH starts a fresh match with reset state; EXIT returns to menu cleanly.
- **Post-game replay selector:** finished two matches in the same room → `-m1` / `-m2` in the selector; start / prev / next / end navigation works; EXIT REPLAY restores the latest match outcome.
- **Archived replay (connecting):** open a spectator/archived replay URL (room code plus `gameId`, or the in-app path) so the **Connecting** overlay appears while the timeline fetch runs. Press **Cancel** or exit to the menu before loading finishes. **Pass:** you land on the menu without a flash of wrong endgame state from a late response; starting the same or another replay afterward behaves normally.

## 17. AI opponent

- **Easy:** basic moves; beatable by a beginner.
- **Normal:** uses gravity assists; tactical choices; fair challenge.
- **Hard:** aggressive; optimal movement; uses ordnance.

Then `npm run simulate -- all 40` (pre-commit and CI use 60) → expect **0 engine crashes** across all scenarios. The harness randomises starting seat during bulk runs.

## 18. Sound

No audio before user interaction. **M** toggles; thrust / gun / explosion / phase / timer-warning cues play timely; never blasts on load, reconnect, or rematch.

## 19. Help & tutorial

**?** opens overlay with sections matching current controls. Fresh profile: tutorial tips appear in each relevant phase; copy matches device ("Click" / "Tap"); tips don't cover primary buttons or linger; skipping returns control cleanly. Returning players aren't forced through the tutorial.

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

---

## Automated checks

These run in CI and don't replace manual experience checks:

| Command | What it checks |
| --- | --- |
| `npm run verify` | Full local release gate (lint / typecheck / coverage / build / e2e / a11y / simulation) |
| `npm test` | Unit, property, and regression tests |
| `npm run test:e2e` | Thin Playwright browser smoke |
| `npm run test:e2e:a11y` | Playwright + axe accessibility baseline |
| `npm run simulate -- all 40` | Engine stability / balance sweep (`verify` uses 40; pre-commit / CI use 60) |
| `npm run lint` / `typecheck:all` | Code style / type safety |

Playwright is intentionally small — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the layered test strategy. Scenario walk-throughs and deep rule validation belong in Vitest and simulation, not Playwright.
