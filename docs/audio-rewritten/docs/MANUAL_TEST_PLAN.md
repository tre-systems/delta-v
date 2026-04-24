# Manual Test Plan

Hands-on verification for release candidates and significant changes. Each section is self-contained, so run only the ones relevant to what changed. The game specification document holds the rule references; the simulation-testing document covers automated harnesses; the exploratory-testing document covers open-ended discovery passes — a different intent, since that document helps you find unknown issues while this one verifies known requirements.

## Release gate

Any of these is a blocker: a new player cannot start Bi-Planetary and finish turn one using only in-game guidance; the current player, selected ship, objective, or next required action is unclear at any point; multiplayer create, join, reconnect, chat, rematch, or disconnect resolution is flaky; mobile and touch has blocked actions, overlapping heads-up display, or unreadable text; the Progressive Web App offline single-player mode is broken; or a twenty-to-thirty minute session shows serious stutter, dropped input, stale interface, or unclear win or loss messaging.

When a test fails, record the browser, device, scenario, seat, steps taken, and whether the failure is about correctness, clarity, performance, or recovery.

## Contrast and readability spot-check

Use the browser's accessibility inspector, a color picker, or an external contrast checker on the translucent panels — not just on the solid menu backgrounds. The help overlay's stacked panels place body copy on semi-transparent layers with a backdrop blur, so aim for a ratio of four-and-a-half to one for normal-sized text against the effective background. The game-over screen's stat pills and any queue or status strips with muted text on glassy fills are the other likely candidates.

## Recommended matrix

Test across desktop Chromium with mouse and keyboard, desktop Safari or Firefox with a trackpad, a phone-sized viewport and one real device if available, an installed Progressive Web App shell if the browser supports it, and a fresh browser profile at least once per release to cover tutorial, reconnect, audio, and help-state scenarios.

Cover single-player online, single-player offline, two-tab multiplayer, and refresh, reconnect, and rematch flows.

## Agent and Model Context Protocol smoke test

Run this when changes touch the agent protocol, the Model Context Protocol adapter, matchmaking, or the benchmark script. First, run the in-process benchmark against each built-in artificial-intelligence difficulty for a small number of games; from its JSON summary, confirm the action-validity rate is at least ninety-five percent, the parse-error rate is zero, and the timeout rate is below five percent. Second, run the six-agent harness and confirm it finishes three concurrent matches without Durable Object errors or stuck tickets. Third, run the quick-match agent script against each difficulty for a small number of games, confirming stable acceptance and no systematic JSON parse failures. Skip this section when the release does not touch the agent or Model Context Protocol surfaces.

---

## 1. Smoke test: Bi-Planetary versus artificial intelligence

Open the app — the menu shows the title, difficulty, and play options. Pick Easy, then Bi-Planetary — the status indicates first-burn fuel cost and free takeoff. Click a direction arrow or press one of the number keys one through six, or zero to clear — a course preview and fuel-cost label appear. Click Confirm or press Enter — the ship animates and the heads-up display updates. The artificial intelligence takes its turn, then yours resumes. Pass: takeoff, movement, and artificial-intelligence response all work.

### 1a. First-time user experience on a fresh profile

Start from the menu without opening any external documentation. Within the first ten seconds it should be obvious which ship is yours, what the goal is, and what the next action is. Finish turn one without guessing what Confirm will do. Make and recover from a deliberate mistake — a wrong burn or wrong selection — using only in-game affordances like deselect, undo, or help. After the artificial-intelligence turn, within three seconds you should know the objective, the selected ship, the next action, and why the last event happened. Reach turn three without any external explanation.

## 2. Vector movement (Bi-Planetary)

Verify that velocity persists: confirm a burn, then confirm with no burn and the ship should coast at the same velocity. Confirm that a burn shifts the endpoint by exactly one hex in the chosen direction and that the fuel-cost label appears. Gravity should deflect one turn later, shown by yellow arrows in passing gravity hexes, with cyan dashed arrows appearing next turn to show deferred deflection; edge-of-hex passes do not deflect. For the Grand Tour scenario and areas past Luna or Io, weak gravity applies: a single hex is optional, but two consecutive make the second mandatory. For Duel warships, the overload option is shown with a double-circle icon, costs two fuel, and is unavailable after use until resupply. Non-warships such as the Convoy tanker and Liner cannot overload, so that option should be absent.

## 3. Landing and takeoff (Bi-Planetary)

Starting landed, take off, enter orbit, and land on the opponent's base. Booster takeoff is free but the initial burn costs one fuel. Landing requires first being in orbit. Intersecting a planet off-base results in destruction.

## 4. Combat (Duel versus hard artificial intelligence)

For attacks, the preview should show attacker and defender factors, odds, range modifier, velocity modifier, and whether a counterattack is available. Attack queues the action; Fire All resolves it; a result notification shows the outcome. A counterattack fires at its own odds if the defender is still eligible. Disabled ships drift for the stated number of turns, decreasing by one per turn; six or more cumulative disabled turns means elimination; landing at a friendly base repairs all damage. Planetary defense in Bi-Planetary fires at two-to-one odds against any enemy entering the gravity hex above your base, with no range or velocity modifiers. The dice penalty is one per hex of range and one per hex of velocity difference above two. Line of sight is blocked by planets, moons, and Sol; ships and asteroids do not block it.

## 5. Ordnance (Duel or Convoy versus artificial intelligence)

Mines inherit ship velocity, the launching ship must change course that turn, they self-destruct after five turns, and they detonate on hex intersection. Torpedoes are warships-only, receive a one-to-two hex launch boost, target a single ship, and misses continue moving. Nukes are available only in the Escape scenario, inherit velocity, destroy everything in their hex, can be shot down by guns or point defense at two-to-one odds, and clear asteroid hexes. No ordnance may be launched while resupplied, while landed, or more than once per ship per turn.

## 6. Scenarios

Each scenario has its rules fully specified in the game specification. Quick verification points: Bi-Planetary — land on the opposite planet; Escape — hidden fugitive ship, only nukes available with no mines or torpedoes, planetary defense disabled, and a moral victory on Enforcer disable; Convoy — liner, tanker, and frigate escort with logistics enabled, land the liner on Venus with colonists; Lunar Evacuation — passenger rescue enabled and the win requires passengers aboard; Duel — last ship standing; Blockade Runner — packet with a head-start velocity, land on Mars; Fleet Action — four-hundred-credit fleet build, covered in section eight; Interplanetary War — eight-hundred-fifty-credit fleet build with logistics and longer play; Grand Tour — combat disabled, shared bases, visit eight checkpoints and return home.

## 7. Multi-ship management (Escape versus artificial intelligence)

No ship is auto-selected; the heads-up display prompts for selection. Clicking a ship shows a selection notification. Clicking stacked ships cycles through them. The Tab key cycles through your own ships. After setting burns for all ships, the status shows that all burns are set, and confirming animates them simultaneously.

## 8. Fleet building (Fleet Action or Interplanetary War)

The budget is shown, ship cards display stats and cost, and over-budget ships are greyed out. Removing a ship clears it from the selection; the clear button resets the entire fleet; Launch Fleet starts the match. The artificial intelligence also builds its own fleet.

## 9. Logistics (Convoy versus artificial intelligence)

Match two friendly ships to the same hex and velocity and a logistics phase appears after movement, where the transfer panel can be used. Torch ships cannot transfer fuel to other ships in the Interplanetary War scenario. The logistics phase is skipped in scenarios that do not have logistics enabled, such as Bi-Planetary and Duel.

## 10. Combat edge cases

When the last two ships kill each other, the non-attacker wins, indicated by a mutual-destruction message. Dreadnaughts may fire while disabled; damaged orbital bases may fire at the first damage level. In Fleet Action, multiple ships can combine strength for an attack, using the highest applicable range and velocity penalties. Ships with only defensive ratings — such as the Transport, Tanker, and Liner — do not show an attack button. Ramming occurs when a course passes through an occupied hex, causing both ships to take damage from the ramming table; mines and torpedoes in that hex also detonate. For asteroid hazards, one roll is made per asteroid hex entered at speed greater than one; crossing a hexside between two asteroid hexes counts as one roll.

## 11. Heads-up display and information

The top bar shows the turn number and phase name, fuel and speed, objective, and fleet count. A brief centered phase banner appears on phase change and auto-dismisses. Hovering over or tapping a ship shows a tooltip with its type, fuel, cargo, velocity, and damage. The log panel is toggled with the L key on desktop and displays color-coded, chronological entries. The game-over screen shows victory or defeat with the reason, turn count, fleet counts, and working rematch and exit buttons. At any moment you should be able to answer in three seconds whose turn it is, which ship is selected, whether the game is waiting for input or animating, and what Confirm or Fire All will do. Unavailable actions explain why they are unavailable. For accessibility basics, one-hundred-fifty-percent zoom stays readable, and low-fuel, urgent-timer, and victory states are not conveyed by color alone.

## 12. Camera and navigation

Panning is available via drag, the W, A, S, D keys, or the arrow keys. Zooming uses scroll, pinch, or the plus and minus keys, with a zoom range from very small to four times normal. The view auto-frames during movement. The minimap supports click-to-jump. The H key centers on your fleet; the E key focuses the nearest enemy.

## 13. Keyboard and focus safety

The number keys one through six set burn direction; zero clears it. Enter confirms an action or fires. Escape deselects. Tab cycles through ships. The question mark key toggles help. L toggles the log panel on desktop. The N, T, and K keys trigger mine, torpedo, and nuke respectively during the ordnance phase. E focuses the nearest enemy and H centers on your fleet. M toggles sound. W, A, S, D and the arrow keys pan the camera. Plus and minus zoom in and out.

In the menu, Tab and Shift-Tab work correctly and a visible focus indicator is always present. Typing in the chat input does not trigger game hotkeys, and clicking back into the game re-enables them.

## 14. Mobile and touch

In the menu, all buttons should be tappable, the scenario list scrolls if needed, and touch targets should be at least forty-eight pixels. During gameplay, the log starts collapsed as a single-line bar and expands to an overlay when tapped; all action buttons have adequate touch targets; the top bar never overflows; and the ship list scrolls without overlapping other elements. The status text should say Tap rather than Click, with no Enter or keyboard hints shown; burn circles have no number labels; and the help overlay shows touch-specific instructions only. In landscape orientation, the heads-up display compacts, the canvas remains usable, and nothing overlaps. Comfort checks: panning should not issue commands or select text; pinch-to-zoom should not zoom the browser page; opening the log, help, or chat should not hide controls behind the keyboard or safe area; and backgrounding then restoring the app should preserve layout and selection state.

## 15. Resupply and bases

Land a damaged or low-fuel ship at a friendly base. On the next turn, fuel should be restored, damage repaired, overload allowance restored, and ordnance reloaded. Same-turn gun and ordnance use is blocked while landed. In Grand Tour, shared bases serve both players.

## 16. Multiplayer across two tabs or devices

For creating and joining: room codes, the copy-link button, and manual entry all work; an invalid code produces a clear error; a full room fails clearly. For presence and chat: the transition from waiting to playing is visible on both sides; each chat message appears once with correct attribution; objective, turn ownership, and ship state match on both sides; and the latency indicator does not clash with the heads-up display. The turn timer appears after a grace period, its styling becomes urgent near expiry, the warning sound and visual fire once, and any action resets the timer. For reconnect: refreshing one tab reconnects to the same seat; the stale tab stops receiving updates; closing and reopening within thirty seconds with a stored token continues the match; and the post-reconnect interface matches the other player's view. If one player is disconnected for more than thirty seconds, the other wins by forfeit with a clear reason. Rematch starts a fresh match with reset state and Exit returns to the menu cleanly. After finishing two matches in the same room, the replay selector shows both matches labeled so you can navigate between them using start, previous, next, and end controls, and exiting the replay restores the latest match outcome. For an archived replay, open a spectator or archived replay URL so the Connecting overlay appears while the timeline fetch runs, then press Cancel or exit to the menu before loading finishes; the pass condition is that you land on the menu without a flash of wrong end-game state from a late response, and that starting the same or another replay afterward behaves normally.

## 17. Artificial intelligence opponent

On Easy the artificial intelligence makes basic moves and is beatable by a beginner. On Normal it uses gravity assists and tactical choices for a fair challenge. On Hard it plays aggressively with optimal movement and uses ordnance.

Then run the all-scenarios sweep at sixty games with the continuous-integration flag — the canonical form used by pre-push and continuous integration — and expect zero engine crashes across all scenarios. The harness randomises the starting seat during bulk runs.

## 18. Sound

There should be no audio before user interaction. The M key toggles sound. Thrust, gun, explosion, phase-change, and timer-warning cues play in a timely manner and never blast on load, reconnect, or rematch.

## 19. Help and tutorial

The question mark key opens an overlay with sections matching the current controls. On a fresh profile, tutorial tips appear during each relevant phase; copy matches the device type using "Click" or "Tap" as appropriate; tips do not cover primary buttons and do not linger; skipping the tutorial returns control cleanly. Returning players are not forced through the tutorial again.

## 20. Progressive Web App and offline single-player

Install the app if the browser supports it; the launched shell should look correct. Online local artificial-intelligence play should work in the shell. To test offline, use browser developer tools to simulate an offline or airplane-mode state: the app shell should still load; start a single-player artificial-intelligence match; play at least three turns; multiplayer should fail clearly without hanging. Re-enabling the network should allow online play to recover after a retry or reload.

## 21. Leaderboard

Run when changes touch the leaderboard server code, the shared rating module, or any of the leaderboard database migrations.

On the public leaderboard page, the table should load ordered by rating descending, and agent rows should show an "Agent" badge. By default, provisional players are hidden; flipping the include-provisional query flag should surface them at a lower confidence. Newly created players start in the hidden bucket until their rating deviation shrinks and they meet the distinct-opponents threshold.

For human claims, a fresh browser profile should be able to claim a unique username through the home-screen callsign field, which is backed by the claim-name endpoint. Reclaiming the same username from a different player key should return a conflict response.

For agent claims, minting an agent token with an associated username claim should return a token valid for twenty-four hours and mark the row with the "is agent" flag. Playing one rated match should then update the player's row.

The per-player rank lookup endpoint should return the username, rank, rating, and related fields when the player key is known, or a not-found response when the key is unclaimed.

## 22. Edge cases and regression grab-bag

With zero fuel, the ship drifts at current velocity with no burn options; gravity, resupply, and map-exit rules still apply. Map exit: a final course that goes off the edge of the map results in elimination. Nuke clears asteroid: an asteroid hex becomes clear space after a nuke detonates. Destroyed-ship cleanup: no ghost highlight or selection, and clicking a wreck hex does not produce an error. Empty combat phase: a skip-combat option is available, or the phase auto-skips. Stacked ships: clicking cycles through all ships in the hex. Turn timer: after two minutes of idle time the turn times out, with a warning firing at thirty seconds. Rematch: the same scenario and opponent restart with a fully cleared state.

---

## Automated checks

These checks run in continuous integration and do not replace manual experience checks. A fast local gate runs lint, type-checking, and build. The full local release gate adds coverage, end-to-end smoke tests, accessibility checks, and the simulation sweep. A separate command runs unit, property, and regression tests. A thin browser smoke test uses Playwright. A Playwright-plus-axe accessibility test checks the baseline. A simulation-smoke command runs a short all-scenarios artificial-intelligence smoke for local push checks. The canonical full sweep runs all scenarios at sixty games with the continuous-integration flag — used by full verification and by continuous integration — and also produces the minified client bundle, where the current baseline is roughly three hundred ninety-seven kilobytes raw and one hundred seventeen kilobytes gzipped after every build. Code-style and type-safety checks run lint and type-checking across all source files. The contributing guide describes the layered test strategy; scenario walk-throughs and deep rule validation belong in unit and simulation tests, not in Playwright.
