# Manual Test Plan

A hands-on guide to verifying Delta-V works correctly
and feels good to play. Use this after significant
changes or before a release. Each section is
self-contained — run whichever sections are relevant
to the changes you're testing.

This plan intentionally covers both rule correctness
and user experience. A build is not ready if the
simulation is technically correct but the game is
confusing, fragile, noisy, or frustrating for real
players.

Related docs: [SPEC](./SPEC.md), [ARCHITECTURE](./ARCHITECTURE.md),
[SIMULATION_TESTING](./SIMULATION_TESTING.md).

---

## Release Gate

Treat any of the following as release blockers:

- A new player cannot start **Bi-Planetary** and
  finish the first turn using only in-game guidance.
- The current player, selected ship, objective, or
  next required action is hard to understand at any
  point.
- Multiplayer create, join, reconnect, chat,
  rematch, or disconnect resolution is unreliable or
  confusing.
- Mobile / touch play has blocked actions,
  overlapping HUD, accidental browser gestures, or
  unreadable text.
- PWA / offline single-player regresses relative to
  the product promise.
- A 20-30 minute session produces serious stutter,
  dropped input, stale UI, or unclear win/loss
  messaging.

When a test fails, record the browser, device,
scenario, player seat, reproduction steps, and
whether the problem is correctness, clarity,
performance, or recovery.

---

## Recommended Test Matrix

For a release candidate, run the highest-risk
sections in at least:

- Desktop Chromium with mouse + keyboard
- Desktop Safari or Firefox / trackpad workflow
- Phone-sized viewport (375×812) and one real mobile
  device if available
- Installed PWA shell if supported by the browser
- A fresh browser profile once (tutorial, audio,
  reconnect token, and help-state coverage)

Cover these modes:

- Single-player online
- Single-player offline
- Multiplayer two-tab / two-device
- Refresh / reconnect / rematch flow

---

## 1. Quick Smoke Test

**Goal:** Confirm the game boots and a basic turn works.
**Time:** 2 minutes — **Scenario:** Bi-Planetary vs AI

1. Open the app. Main menu shows title, difficulty
   selector, and play options. Click **Play vs AI** to
   see the scenario list.
2. Select **Easy** difficulty, then **Bi-Planetary**.
3. Your corvette starts landed on a base. Status reads
   that the first burn costs 1 fuel and booster takeoff is
   free (see in-game wording).
4. Click a direction arrow — a course preview line
   appears with a fuel cost label. (You can also press
   **1–6** to pick a burn direction, **0** to clear.)
5. Click **CONFIRM** (or press Enter) — the ship
   animates along the plotted course.
6. After animation the HUD updates: fuel gauge shows
   "Speed N (N to stop)", phase changes.
7. The AI takes its turn — you see its ship animate,
   then it's your turn again.

**Pass:** You can take off, move, and see the AI respond.

### 1a. First-time user experience

**Goal:** Verify a new player can understand the game
without reading external docs.
**Time:** 5 minutes — **Scenario:** Bi-Planetary vs AI
in a fresh browser profile or with cleared local
storage

1. Start from the main menu without opening the SPEC
   or this plan.
2. Confirm the menu makes it obvious how to start a
   game and what the default scenario / difficulty
   mean.
3. Launch **Bi-Planetary** and rely only on the
   objective text, status line, tutorial tips, and
   help overlay to decide what to do.
4. Within the first 10 seconds, it should be obvious
   which ship is yours, what your goal is, and what
   action is expected next.
5. Complete the first turn. The tester should not
   need to guess what **CONFIRM** will do.
6. Make a deliberate mistake before confirming
   (wrong burn, wrong ship, accidental selection)
   and recover using in-game affordances such as
   deselect, undo, or help.
7. After the AI turn, the tester should be able to
   answer within 3 seconds:
   - what the objective is
   - which ship is selected
   - what the next action should be
   - why the last movement or combat result happened
8. Finish a second turn and note any moment that
   felt ambiguous, intimidating, or noisy.

**Pass:** A first-time player can reach turn 3
confidently, with no need for external explanation
and no "I don't know what the game wants from me"
moments.

---

## 2. Vector Movement

**Goal:** Verify that the core vector movement
model works correctly: velocity persists, burns shift
the endpoint, gravity deflects on the following turn.

**Time:** 5 minutes — **Scenario:** Bi-Planetary vs AI

### 2a. Velocity persistence

1. Take off and set a burn in one direction.
2. Confirm — note the ship's destination hex.
3. Next turn, set **no burn** (click Confirm without
   selecting a direction). The ship should coast:
   same velocity, same displacement.

### 2b. Burn mechanics

1. Select your ship. The predicted course (dashed
   line) shows where you'll end up with no burn.
2. Click a direction — the predicted destination
   shifts by one hex in that direction. A fuel cost
   label (e.g. "−1") appears near the destination.
3. Confirm and verify the ship arrives at the
   shifted destination.

### 2c. Gravity

1. Steer toward a planet (Venus or Mars). As your
   course enters gravity hexes, yellow arrows appear
   on the hexes you'll pass through.
2. On the **next** turn, cyan dashed arrows show
   where deferred gravity will deflect your course.
3. Verify the deflection matches: one hex toward
   the planet body per gravity hex entered on the
   previous turn.
4. Flying along the **edge** of a gravity hex should
   **not** trigger a deflection — only passing
   through the center.

### 2d. Weak gravity

1. In **Grand Tour**, fly past Luna or Io.
2. When passing through a single weak-gravity hex
   the engine should let you choose to use or
   ignore it. (Two consecutive weak-gravity hexes
   make the second one mandatory.)

### 2e. Overload

1. In **Duel** (frigates are warships), select your
   ship and set a burn. The overload option should
   be available (double circle icon, costs 2 fuel).
2. In **Convoy** (merchant tanker is non-warship),
   verify the tanker has **no** overload option —
   only warships can overload.
3. After overloading, verify the ship cannot
   overload again until it resupplies at a base.

**Pass:** Ships coast correctly, burns shift by exactly
one hex, gravity is deferred by one turn, weak gravity
is optional for a single hex, overload works for
warships only.

---

## 3. Landing and Takeoff

**Goal:** Verify orbit entry, landing, and takeoff.

**Time:** 3 minutes — **Scenario:** Bi-Planetary vs AI

1. Start the game. Your ship is landed. Status explains
   the first burn fuel cost and that booster takeoff is free.
2. Take off — the ship ends up in the gravity hex
   above the base, stationary. Takeoff itself is
   free (boosters), but you spent 1 fuel for the
   initial burn out.
3. From the gravity hex, burn to enter orbit
   (speed 1, moving through adjacent gravity hexes
   of the same body).
4. Navigate to the opponent's planet and slow to
   orbit speed, then land on a base hex side.
5. Victory should trigger — "Landed on [planet]!"
6. Verify a ship that **crashes** into a planet
   surface (not landing on a base) is destroyed
   with appropriate feedback.

**Pass:** Takeoff, orbit, and landing all work. Crash
detection is correct.

---

## 4. Combat

**Goal:** Test the full combat flow — targeting, odds
display, dice resolution, damage, and counterattack.

**Time:** 5 minutes — **Scenario:** Duel vs AI (Hard)

### 4a. Basic attack

1. Manoeuvre your frigate toward the enemy.
2. When the combat phase begins, click the enemy
   ship — a combat preview appears showing:
   - Attacker and defender combat strengths
   - Computed odds column (e.g. 1:1)
   - Range modifier ("Range −N")
   - Relative velocity modifier (if speed diff > 2)
   - "CAN COUNTER" label if the defender can fire back
3. Click **ATTACK** to queue the attack.
4. Click **FIRE ALL** to resolve.
5. A toast shows the result (e.g. "Frigate:
   Disabled 2T" or "DESTROYED").

### 4b. Counterattack

1. After your attack resolves, if the defender is
   still alive it may counterattack. Verify the
   counter-fire resolves with its own odds and
   modifiers.

### 4c. Damage and recovery

1. If a ship is disabled, verify it drifts (cannot
   set burns) for the stated number of turns.
2. Each turn the disabled count decreases by 1.
3. If cumulative damage reaches 6+, the ship is
   eliminated.
4. Landing at a friendly base repairs all damage.

### 4d. Planetary defense

1. In **Bi-Planetary**, move an enemy ship into a
   gravity hex directly above one of your bases.
2. Your base should auto-fire at 2:1 odds with
   no range or velocity modifiers.

### 4e. Range and velocity modifiers

1. Attack from range 3+ and verify the die roll
   is penalised (−1 per hex of range).
2. Attack a target with speed difference > 2 and
   verify the velocity penalty applies (−1 per hex
   of velocity difference above 2).

### 4f. Line of sight

1. Try to attack through a planet or moon — the
   attack should be blocked. Ships and asteroids
   do **not** block line of sight.

**Pass:** Combat odds, modifiers, counterattack, damage
tracking, planetary defense, and LOS all behave as
described in the rules.

---

## 5. Ordnance

**Goal:** Verify mines, torpedoes, and nukes.

**Time:** 5 minutes — **Scenario:** Duel or Convoy vs AI

### 5a. Mines

1. During the ordnance phase, click **MINE** (or
   press N). Select a ship with cargo capacity.
2. The mine inherits the ship's velocity. The ship
   **must** change course on the same turn (it cannot
   remain in the mine's hex).
3. Verify the mine appears on the map, drifts at
   its velocity each movement phase.
4. After 5 turns the mine self-destructs.
5. If a ship's course passes through the mine hex,
   the mine detonates — roll on the mine damage
   table. Verify the toast shows the result.

### 5b. Torpedoes

1. Click **TORPEDO** (or press T) with a warship
   selected. Choose a launch direction (1-2 hex
   acceleration).
2. Verify only warships can launch torpedoes.
3. The torpedo moves each turn. If it enters a hex
   with a ship, it detonates against a single
   target (random if multiple ships).
4. A torpedo that misses continues on its course.

### 5c. Nukes

1. In a scenario that allows nukes (Escape allows
   nukes only), click **NUKE** (or press K).
2. The nuke inherits the launching ship's velocity.
3. When a nuke reaches a target hex it destroys
   **everything** in that hex.
4. Verify guns and planetary defense can shoot
   down nukes at 2:1 odds.
5. A nuke hitting an asteroid clears it to open
   space.

### 5d. Launch restrictions

1. A ship **cannot** launch ordnance if it
   resupplied this turn.
2. A ship **cannot** launch ordnance while landed at
   a base.
3. Each ship may launch only one item per turn.
4. Verify non-warship ordnance limits from the
   scenario loadout UI and launch controls (cargo is
   intentionally stricter than warship loadouts).

**Pass:** All three ordnance types launch, move, and
detonate correctly. Launch restrictions are enforced.

---

## 6. Scenarios

### 6a. Bi-Planetary (Landing Objective + Gravity Basics)

- 1 corvette each, Mars vs Venus
- **Victory:** Land on the opponent's planet first
- Verify the objective text shows the target body

### 6b. Escape (Hidden Cargo + Intercept/Inspect Loop)

- 3 Pilgrim transports vs 1 corvette + 1 corsair
- One transport secretly carries the fugitives
  (hidden from the Enforcer player)
- **Victory conditions:**
  - Pilgrims decisive: escape beyond Jupiter with
    fuel to spare
  - Pilgrims marginal: escape beyond Jupiter
  - Pilgrims moral: disable an Enforcer ship
  - Enforcers decisive: capture fugitives and
    return to base
  - Enforcers marginal: destroy the fugitive
    transport
- Verify hidden identity: the Enforcer player
  should not see which transport has the fugitives
  until inspection (matching position + velocity)
- Nukes are available; mines and torpedoes are not
- Planetary defense is disabled

### 6c. Convoy (Merchant Escort + Passenger Delivery)

- Liner + tanker + frigate escort vs 2 corsairs + corvette
- **Victory:** Defenders land the liner on Venus with colonists
- Logistics enabled — verify fuel and passenger transfers work
  between friendly ships at same hex/velocity

### 6d. Evacuation (Lunar Passenger Rescue)

- Transport corvette + liner vs corsair (Luna → Terra)
- **Victory:** Fleet elimination or passenger delivery
- Passenger rescue enabled — verify passenger transfer UI
  and win condition requiring passengers aboard

### 6e. Duel (Pure Combat + Gravity Pressure)

- 2 Frigates near Mercury
- **Victory:** Last ship standing
- Good test for: combat modifiers, ordnance,
  gravity combat near Mercury/Sol

### 6f. Blockade Runner (Pursuit + Velocity Control)

- 1 Packet (with velocity head-start) vs 1 Corvette
- **Victory:** Packet lands on Mars
- Packet starts moving — test high-speed gameplay

### 6g. Fleet Action (Budget Fleet Construction)

- 400 MC budget, combat ships only
- Mars vs Venus
- Verify fleet building UI (section 8) then full
  combined-arms combat

### 6h. Interplanetary War (Large-Scale Logistics + Recovery)

- 850 MC budget, all ship types available
- Terra vs Mars, logistics enabled
- Longer game — verify damage recovery, resupply,
  overload restoration, and large-fleet management

### 6i. Grand Tour (Checkpoint Race + Combat Disabled)

- 1 Corvette each, visit 8 bodies and return home
- **Combat disabled** — verify attack buttons are
  hidden or disabled
- Shared bases at Terra, Venus, Mars, Callisto
- Verify checkpoint tracking — HUD or objective
  text should show which bodies remain
- Victory: visit all 8 checkpoints and land on
  your home body

**Pass:** Each scenario starts correctly, has the right
ships, applies its special rules, and triggers the
correct victory condition.

---

## 7. Multi-Ship Management

**Goal:** Verify ship selection, cycling, and status
tracking with multiple ships.

**Time:** 3 minutes — **Scenario:** Escape vs AI

1. Game starts — no ship auto-selected. HUD shows
   "Select a ship to begin", fuel gauge reads 0/0.
2. Click a transport — toast says "Selected:
   Transport", HUD updates with that ship's fuel.
3. Set a burn, then click a different transport —
   status changes to "Burn set · Select another
   ship".
4. Click the same hex with stacked ships — each
   click cycles to the next ship on that hex.
5. Press **Tab** to cycle through ships in order.
6. Set burns for all ships — status shows
   "All burns set · Confirm (Enter)".
7. Confirm — all ships animate simultaneously.
8. After movement, verify each ship's position
   and fuel updated correctly.

**Pass:** Selection, cycling, per-ship burns, and
simultaneous movement all work.

---

## 8. Fleet Building

**Goal:** Verify the MegaCredit fleet builder.

**Time:** 2 minutes — **Scenario:** Fleet Action or
Interplanetary War vs AI

1. Fleet building screen shows your starting
   budget (400 MC or 850 MC).
2. Each ship type shows its stats (combat, fuel, and
   cargo if non-zero) and cost.
3. Click a ship type — it appears in YOUR FLEET,
   budget decreases by the ship's cost.
4. Ships that cost more than remaining budget are
   greyed out.
5. Click the × on a ship in YOUR FLEET — it's
   removed, budget restored.
6. Click **CLEAR** — all ships removed, full budget
   restored.
7. Click **LAUNCH FLEET** — game begins with your
   purchased ships at your home planet.
8. Verify the AI also builds a fleet (there should
   be enemy ships on the map).

**Pass:** Budget tracking, ship add/remove, and
fleet launch all work correctly.

---

## 9. Logistics

**Goal:** Verify fuel and cargo transfer between ships.

**Time:** 3 minutes — **Scenario:** Convoy vs AI
(logistics enabled)

1. Manoeuvre your tanker and frigate to the same
   hex with matching velocity.
2. The logistics phase should appear after movement.
3. The transfer panel shows fuel transfer options
   between the two ships.
4. Transfer fuel from the tanker to the frigate.
5. Confirm — fuel values update for both ships.
6. Verify **torch ships** cannot transfer fuel to
   other ships (Interplanetary War scenario if
   a torch is purchased).
7. Verify the logistics phase is **skipped** in
   scenarios without `logisticsEnabled` (e.g.
   Bi-Planetary, Duel).

**Pass:** Fuel transfers work between matched ships, torch
restriction is enforced, and the phase skips when
disabled.

---

## 10. Combat Edge Cases

**Goal:** Test unusual combat situations.

**Time:** 5 minutes

### 10a. Mutual destruction

- In Duel, get both frigates damaged so that the
  next attack could eliminate both. If the last two
  ships destroy each other the winner should be the
  player who did **not** attack last. Message:
  "Mutual destruction — last attacker loses!"

### 10b. Disabled ship behavior

- A disabled ship drifts and cannot set burns,
  attack, or launch ordnance.
- **Exception:** Dreadnaughts may still fire guns
  even when disabled.
- Verify damaged orbital bases can still fire at
  D1 damage level.

### 10c. Multi-ship attack

- In Fleet Action, group multiple ships against
  one target. Their combat strengths should
  combine. The highest applicable range and
  velocity penalties apply.

### 10d. Defensive-only ships

- Transport and Tanker have a "D" suffix on their
  combat strength — they may **not** initiate
  attacks or counterattacks. They can only defend.
- Liner has 2D — same restriction.
- Verify the ATTACK button does not appear when
  only defensive ships are available.

### 10e. Ramming

- Fly your ship's course through the center of a
  hex occupied by an enemy ship. Both ships should
  take damage from the ramming table.
- Mines and torpedoes in the rammed hex should
  also detonate.

### 10f. Asteroid hazards

- In a scenario near the asteroid belt, fly
  through asteroid hexes at speed > 1. A die
  roll should occur for each asteroid hex entered.
- Flying along a hexside between two asteroid
  hexes counts as entering one asteroid hex
  (one roll, not two).

**Pass:** All edge cases resolve correctly per the
the game rules.

---

## 11. HUD and Information Display

**Goal:** Verify all HUD elements show correct info.

**Time:** 3 minutes — any scenario

### 11a. Top bar

1. Turn number and phase name visible (e.g.
   "Turn 3 ASTROGATION").
2. Fuel gauge shows "Fuel: X/Y" for selected ship,
   or "Speed N (N to stop)" when moving.
3. Objective text shows the target body or
   checkpoint progress (Grand Tour).
4. Fleet count visible.

### 11b. Phase banners

1. When a phase changes, a centered overlay appears
   briefly: phase name + "Your Turn" or
   "Opponent's Turn".
2. Auto-dismisses after ~1 second.

### 11c. Ship tooltips

1. Hover over (or tap) a ship — tooltip shows
   ship type, fuel, cargo, velocity, damage state.

### 11d. Game log

1. Log panel shows chronological events: turns,
   phase changes, movement, combat results,
   landings, crashes.
2. On desktop, press **L** to toggle the log panel.
3. Log entries are colour-coded by type.

### 11e. Game over screen

1. Shows "VICTORY" or "DEFEAT" with the win reason.
2. Stats show turn count, ships alive/total for
   each player.
3. REMATCH and EXIT buttons are functional.

### 11f. Clarity and trust

1. At any point during a turn, you can tell within
   3 seconds:
   - whose turn it is
   - which ship is selected
   - whether the game is waiting for input or
     resolving queued actions
   - what pressing CONFIRM / FIRE ALL will do
2. If an action is unavailable, the UI explains why
   (wrong phase, no fuel, landed, resupplied,
   defensive-only ship, etc.).
3. Important outcomes appear in the log, toast,
   status line, and animation without contradiction.
4. No stale highlights, banners, or status text
   remain after the game state changes.

### 11g. Readability and accessibility basics

1. Increase browser zoom to 150% on desktop.
2. Verify the top bar, action buttons, help overlay,
   and game-over screen remain readable and usable.
3. Critical states such as low fuel, urgent timer,
   victory/defeat, and selected ship are not
   conveyed by colour alone.
4. Important text remains legible over the map
   background and on smaller laptop screens.

**Pass:** All HUD elements display accurate information
throughout the game.

---

## 12. Camera and Navigation

**Goal:** Verify the camera controls and minimap.

**Time:** 2 minutes — any scenario

1. **Pan:** Drag the map to pan. WASD / arrow keys
   also pan.
2. **Zoom:** Scroll wheel zooms. Pinch-to-zoom on
   trackpad/touch. +/− keys also zoom.
3. **Zoom range:** Can zoom out far enough to see
   the whole solar system, and zoom in close enough
   for fine movement. Range is 0.15x to 4.0x.
4. **Auto-frame:** During movement animation the
   camera smoothly follows the action.
5. **Minimap:** Bottom-right corner shows celestial
   bodies, ship positions, trails, and a viewport
   rectangle.
6. Click on the minimap to jump to that area.
7. Press **H** to center on your fleet.
8. Press **E** to center on the nearest enemy.

**Pass:** All navigation methods work smoothly.

---

## 13. Keyboard Shortcuts

**Goal:** Verify all keyboard controls.

**Time:** 2 minutes — **Scenario:** Duel vs AI

| Key           | Expected                        |
| ------------- | ------------------------------- |
| 1-6           | Sets burn direction             |
| 0             | Clears burn                     |
| Enter         | Confirms turn / fires           |
| Escape        | Deselects ship                  |
| Tab           | Cycles ships (multi-ship)       |
| ?             | Toggles help overlay            |
| L             | Toggles log panel (desktop)     |
| N             | Launch mine (ordnance phase)    |
| T             | Launch torpedo (ordnance phase) |
| K             | Launch nuke (ordnance phase)    |
| E             | Focus nearest enemy             |
| H             | Center on own fleet             |
| M             | Toggle sound                    |
| WASD / Arrows | Pan camera                      |
| +/−           | Zoom                            |

### 13a. Focus and input safety

1. From the menu, use **Tab** / **Shift+Tab** to
   move through buttons and inputs. Visible focus
   styling should always be present.
2. Press **Enter** or **Space** on a focused control
   — it should activate the expected action.
3. Click into chat input (multiplayer) and type a
   message. Game hotkeys should **not** trigger
   while text entry is focused.
4. Click back into the game — shortcuts should work
   again immediately.

**Pass:** All shortcuts work as described.

---

## 14. Mobile / Touch

**Goal:** Verify the game is playable on mobile.

**Time:** 5 minutes — resize browser to 375×812 or
use a phone

### 14a. Menu

1. All buttons visible and tappable.
2. Scenario list scrollable if needed.
3. Difficulty buttons have adequate touch targets.

### 14b. Gameplay

1. Log panel starts collapsed — a single-line bar
   at the bottom shows the latest message.
2. Tap the log bar — full log expands as an overlay.
3. Tap × — log collapses.
4. All action buttons (CONFIRM, UNDO, SKIP COMBAT,
   ATTACK, FIRE ALL) have adequate touch targets
   (minimum 48px).
5. Top bar shows fuel, phase, and objective without
   overflow or truncation.
6. Ship list scrollable if many ships, doesn't
   overlap other elements.

### 14c. Touch-specific behaviour

1. Status messages say "Tap" not "Click", and
   don't show keyboard hints like "(Enter)".
2. Burn direction circles have **no** 1-6 number
   labels on touch devices.
3. Help overlay shows touch instructions
   ("Tap ship/arrow/enemy"), no keyboard shortcuts.

### 14d. Landscape

1. Rotate to landscape — HUD bars compact,
   canvas area is usable, no overlapping elements.

### 14e. Touch comfort and recovery

1. Tap-drag to pan does not accidentally issue ship
   commands or browser text selection.
2. Pinch-to-zoom works without the page itself
   scrolling or zooming instead of the game.
3. Opening and closing the log, help overlay, or
   chat input does not leave controls hidden behind
   safe areas or the mobile keyboard.
4. Background the app briefly, then return. Layout,
   input, and selected state should still be valid.

**Pass:** Full game is playable via touch with
appropriate touch-specific language and layout.

---

## 15. Resupply and Base Mechanics

**Goal:** Verify base resupply behaviour.

**Time:** 3 minutes — **Scenario:** Bi-Planetary or
Grand Tour vs AI

1. Land a damaged or low-fuel ship at a friendly
   base.
2. On the next logistics phase, verify:
   - Fuel is restored to maximum
   - All damage is repaired
   - Overload allowance is restored
   - Ordnance is reloaded to cargo capacity
3. During the turn a ship resupplies, it **cannot**
   fire guns or launch ordnance. Verify the combat
   and ordnance buttons reflect this restriction.
4. In Grand Tour with shared bases — verify both
   players can resupply at shared base locations
   (Terra, Venus, Mars, Callisto).

**Pass:** Resupply restores fuel, damage, overload, and
ordnance. Resupply-turn restrictions are enforced.

---

## 16. Multiplayer

**Goal:** Verify multiplayer feels dependable,
low-friction, and socially usable.

**Time:** 10 minutes — requires two browser tabs or
devices

### 16a. Game creation and join flow

1. Click **Create Game**, select a scenario.
2. The waiting screen shows a 5-character code, the
   chosen scenario, and a working **Copy Link**
   button.
3. In a second tab or device, join using the copied
   link. The game should start once both players
   are connected.
4. Repeat using manual room-code entry instead of
   the copied link.
5. Enter an invalid room code — the game should
   show a clear error and a way back to the menu.
6. Try to join an already-full or unavailable room
   if practical — it should fail clearly instead of
   hanging or silently reloading.

### 16b. Presence, chat, and shared context

1. Both players see the transition from waiting room
   to active match.
2. Send a short chat message from each side.
3. Each message appears once, with correct speaker
   attribution, and the chat input clears after
   send.
4. Objective text, turn ownership, and visible ship
   state are consistent between both players.
5. The latency indicator appears when connected and
   does not overlap more important HUD information.

### 16c. Turn timer and pressure

1. Leave one player idle until the timer appears
   after its grace period.
2. Verify the timer styling becomes more urgent as
   expiry approaches.
3. Low-time warning sound / visual cue should fire
   once, not continuously spam.
4. Taking an action or ending the turn resets the
   timer display appropriately.

### 16d. Reconnection

1. Both players reach astrogation.
2. Refresh one tab quickly — it should reconnect to
   the same seat without errors.
3. The stale tab (if still open) should no longer
   receive live updates or be able to issue actions.
4. Close one tab for less than 30 seconds, reopen
   with the stored token — the match should
   continue without seat swapping or duplicate
   ownership.
5. After reconnect, selected ship, turn, log, and
   action availability should still match the other
   player's view of the game.

### 16e. Disconnect forfeit

1. Disconnect one player for more than 30 seconds.
2. The remaining player should see a clear waiting /
   resolution flow, then win by forfeit.
3. The result screen should explain why the game
   ended.

### 16f. Rematch and exit

1. Finish a match normally.
2. Click **REMATCH** on both sides — a fresh match
   should start with reset turn count, cleared stale
   highlights, and the same scenario / opponent.
3. Click **EXIT** from the end screen — it should
   return cleanly to the menu.

### 16g. Post-game replay selection

1. Finish two matches in the same room so the latest
   game ID advances to `...-m2`.
2. On the game-over screen, use the replay match
   selector to switch between `...-m1` and `...-m2`.
3. Click **VIEW REPLAY** and verify start / prev /
   next / end navigation updates the board state and
   status label.
4. Click **EXIT REPLAY** and verify the finished-match
   screen restores the latest match outcome.

**Pass:** Create, join, chat, reconnect, forfeit,
and rematch all work correctly, and failure states
are clearly communicated.

---

## 17. AI Opponent

**Goal:** Verify the AI plays sensibly at all
difficulty levels.

**Time:** 5 minutes — play a few turns of Duel at
each difficulty

### 17a. Easy

- AI should make basic moves, burn fuel, and
  sometimes attack.
- Should be beatable by a beginner.

### 17b. Normal

- AI should use gravity assists, manage fuel,
  and make tactical combat decisions.
- Should provide a fair challenge.

### 17c. Hard

- AI should play aggressively, use ordnance, and
  make optimal movement choices.
- Should be difficult to beat.

### 17d. AI simulation (automated)

Run the following command — all available scenarios
should complete with **0 engine crashes**:

```
npm run simulate -- all 25
```

The simulation randomises the starting player during
bulk balance runs so the win-rate output is less
biased by seat order.

**Pass:** AI plays at appropriate difficulty levels.
Simulation shows 0 crashes and reasonable win rates.

---

## 18. Sound and Audio

**Goal:** Verify sound adds useful feedback without
surprising the player.

**Time:** 2 minutes — any scenario

1. Load the page fresh — no audio should play
   before user interaction.
2. Press **M** to toggle sound on.
3. Set a burn and confirm — thrust sound plays.
4. During combat — gun / explosion sounds play.
5. Phase transitions — a chime or tone sounds.
6. Let the turn timer reach the warning window —
   the warning sound should play once.
7. Press **M** again — all sound stops.
8. Verify the game never blasts unexpected audio on
   menu load, reconnect, or rematch.

**Pass:** Sound cues are helpful, timely, and fully
toggleable.

---

## 19. Help and Tutorial

**Goal:** Verify the help system teaches without
getting in the way.

**Time:** 2 minutes — any scenario

1. Press **?** — help overlay appears with sections
   for Navigation, Astrogation, Ordnance, Combat,
   and Other controls.
2. Content matches the current control scheme.
3. Press **?** again — overlay closes.
4. In a fresh profile or with tutorial storage
   cleared, tutorial tips should appear during each
   relevant phase explaining what to do next.
5. Tutorial copy should match the current device
   ("Click" on desktop, "Tap" on touch).
6. Tips should not cover the primary action buttons
   or linger after the player has moved on.
7. Skip the tutorial — it should dismiss cleanly
   and return immediate control.
8. Returning players should not be forced through
   the tutorial again unless the saved state was
   intentionally cleared.

**Pass:** Help overlay stays accurate and tutorial
tips are helpful, contextual, and non-intrusive.

---

## 20. PWA / Offline Single-Player

**Goal:** Verify the installable/offline experience
matches the product promise.

**Time:** 5 minutes — supported desktop or mobile
browser

1. Install the app if the browser offers install /
   add-to-home-screen.
2. Launch the installed app or standalone shell —
   title, icon, and menu should look correct.
3. While online, start a local AI game to confirm
   the installed shell behaves like the normal app.
4. Disable network (or use DevTools offline), then
   reload the app shell. The menu should still
   appear.
5. Start a single-player AI game while offline and
   play at least three turns.
6. Attempt a multiplayer create or join while
   offline — it should fail clearly instead of
   hanging forever.
7. Re-enable network and confirm online play
   recovers after retry or reload.

**Pass:** The app installs cleanly, offline
single-player works, and offline limitations are
clear to the user.

---

## 21. Edge Cases and Regressions

A grab-bag of things that have broken in the past
or are easy to miss.

1. **Zero-fuel drift:** A ship with 0 fuel should
   drift at its current velocity. No burn options
   should be available. The ship must continue
   until gravity, resupply, or map exit changes
   its path.

2. **Map exit:** A ship whose final course ends
   off the map is eliminated.

3. **Asteroid clearing:** A nuke detonating in an
   asteroid hex converts it to clear space.

4. **Destroyed ship cleanup:** After a ship is
   destroyed, no ghost highlight or selection
   artifact remains. Clicking the wreck hex does
   not cause errors.

5. **Empty combat phase:** If no enemies are in
   range, SKIP COMBAT should be available (or
   the phase should auto-skip).

6. **Stacked ships:** Clicking a hex with multiple
   ships correctly cycles through them.

7. **Turn timer:** After 2 minutes without acting,
   verify the turn times out gracefully (warn at
   30 seconds remaining).

8. **Rematch:** After a game ends, clicking REMATCH
   should start a new game with the same scenario
   and opponent.

---

## Automated Checks

These complement manual testing and run in CI:

| Command                      | What it checks                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`             | Full local release gate: lint, typecheck (app + tools), coverage, build, e2e smoke, a11y e2e, and simulation                      |
| `npm test`                   | Unit, property, and regression tests across engine, client, and server                                                              |
| `npm run test:e2e`           | Thin Playwright browser smoke coverage for boot, basic turn flow, mobile HUD/help, and core multiplayer join/chat/reconnect paths  |
| `npm run test:e2e:a11y`      | Playwright + axe DOM accessibility baseline for menu, lobby, HUD/help overlay, and keyboard focus behaviour                       |
| `npm run simulate -- all 25` | Engine stability / balance sweep across the current scenario roster                                                                 |
| `npm run lint`               | Code style                                                                                                                          |
| `npm run typecheck:all`      | Type safety for app and tooling                                                                             |

All must pass before any release, but they do **not**
replace the manual experience checks above.

Playwright is intentionally limited in scope. It should stay
fast enough to run routinely, so it is not the place for full
scenario walkthroughs, long-session UX checks, or detailed
rule validation already covered by Vitest and simulation.

---

## What Manual Tests Don't Cover

- **WebSocket synchronisation edge cases** — race
  conditions between simultaneous messages
- **Server alarm / timeout exactness** — turn timer,
  reconnect grace, and inactivity cleanup under real
  clock manipulation or tab suspension
- **Load / soak testing** — many concurrent games or
  very long-running sessions
- **Device performance profiling** — FPS, battery,
  thermal throttling, and memory pressure on older
  hardware
- **Formal accessibility audit** — screen readers,
  measured colour contrast, reduced-motion
  preferences, and assistive-tech compatibility
