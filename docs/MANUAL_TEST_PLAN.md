# Manual Test Plan

A hands-on guide to verifying Delta-V works correctly.
Use this after significant changes or before a release.
Each section is self-contained — run whichever sections
are relevant to the changes you're testing.

Related docs: [SPEC](./SPEC.md), [ARCHITECTURE](./ARCHITECTURE.md),
[SIMULATION_TESTING](./SIMULATION_TESTING.md).

---

## 1. Quick Smoke Test

**Goal:** Confirm the game boots and a basic turn works.
**Time:** 2 minutes — **Scenario:** Bi-Planetary vs AI

1. Open the app. Main menu shows title, difficulty
   selector, and scenario list.
2. Select **Easy** difficulty, then **Bi-Planetary**.
3. Your corvette starts landed on a base. Status reads
   "Click a direction to take off (costs 1 fuel)".
4. Click a direction arrow — a course preview line
   appears with a fuel cost label.
5. Click **CONFIRM** (or press Enter) — the ship
   animates along the plotted course.
6. After animation the HUD updates: fuel gauge shows
   "Speed N (N to stop)", phase changes.
7. The AI takes its turn — you see its ship animate,
   then it's your turn again.

**Pass:** You can take off, move, and see the AI respond.

---

## 2. Vector Movement

**Goal:** Verify that the core Triplanetary movement
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
   shifts by one hex in that direction. Fuel cost
   label reads "1 fuel".
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
2. In **Convoy** (tanker is commercial), verify the
   tanker has **no** overload option — commercial
   ships cannot overload.
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

1. Start the game. Your ship is landed. Status says
   "Click a direction to take off (costs 1 fuel)".
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
4. Non-warships can carry at most one nuke.

**Pass:** All three ordnance types launch, move, and
detonate correctly. Launch restrictions are enforced.

---

## 6. Scenarios

### 6a. Bi-Planetary (Beginner)

- 1 corvette each, Mars vs Venus
- **Victory:** Land on the opponent's planet first
- Verify the objective text shows the target body

### 6b. Escape (Asymmetric)

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

### 6c. Convoy (Escort)

- Tanker + Frigate escort vs 2 Corsairs + Corvette
- **Victory:** Defenders land the tanker on Venus
- Logistics enabled — verify fuel transfer works
  between friendly ships at same hex/velocity

### 6d. Duel (Combat)

- 2 Frigates near Mercury
- **Victory:** Last ship standing
- Good test for: combat modifiers, ordnance,
  gravity combat near Mercury/Sol

### 6e. Blockade Runner (Speed)

- 1 Packet (with velocity head-start) vs 1 Corvette
- **Victory:** Packet lands on Mars
- Packet starts moving — test high-speed gameplay

### 6f. Fleet Action (Fleet Building)

- 400 MC budget, combat ships only
- Mars vs Venus
- Verify fleet building UI (section 8) then full
  combined-arms combat

### 6g. Interplanetary War (Epic)

- 850 MC budget, all ship types available
- Terra vs Mars, logistics enabled
- Longer game — verify damage recovery, resupply,
  overload restoration, and large-fleet management

### 6h. Grand Tour (Race)

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
2. Each ship type shows its stats (combat, fuel,
   cargo) and cost.
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

**Pass:** Fuel transfers work between matched ships.
Torch restriction is enforced. Phase skips when
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
Triplanetary rules.

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

| Key | Expected |
|-----|----------|
| 1-6 | Sets burn direction |
| 0 | Clears burn |
| Enter | Confirms turn / fires |
| Escape | Deselects ship |
| Tab | Cycles ships (multi-ship) |
| ? | Toggles help overlay |
| L | Toggles log panel (desktop) |
| N | Launch mine (ordnance phase) |
| T | Launch torpedo (ordnance phase) |
| K | Launch nuke (ordnance phase) |
| E | Focus nearest enemy |
| H | Center on own fleet |
| M | Toggle sound |
| WASD / Arrows | Pan camera |
| +/− | Zoom |

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

**Pass:** Full game is playable via touch with
appropriate touch-specific language and layout.

---

## 15. Resupply and Base Mechanics

**Goal:** Verify base resupply behaviour.

**Time:** 3 minutes — **Scenario:** Bi-Planetary or
Grand Tour vs AI

1. Land a damaged or low-fuel ship at a friendly
   base.
2. On the next resupply phase, verify:
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

**Goal:** Verify the multiplayer connection flow.

**Time:** 5 minutes — requires two browser tabs

### 16a. Game creation and joining

1. Click **Create Game**, select a scenario.
2. The waiting screen shows a 5-character code and
   a "Copy Link" button.
3. In a second tab, enter the code or paste the
   link. The game should start once both players
   are connected.

### 16b. Reconnection

1. Both players reach the astrogation phase.
2. Refresh one tab quickly — it should reconnect
   to the same seat without errors.
3. The stale tab (if still open) should no longer
   receive live updates.
4. Close one tab for less than 30 seconds, reopen
   with the stored token — the match continues.

### 16c. Disconnect forfeit

1. Disconnect one player for more than 30 seconds.
2. The remaining player should win by forfeit.

**Pass:** Create, join, reconnect, and forfeit all
work correctly.

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

Run the following command — all 8 scenarios should
complete with **0 engine crashes**:

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

**Goal:** Verify sound effects play correctly.

**Time:** 2 minutes — any scenario

1. Press **M** to toggle sound on.
2. Set a burn and confirm — thrust sound plays.
3. During combat — gun/explosion sounds play.
4. Phase transitions — a chime or tone sounds.
5. Press **M** again — all sound stops.
6. Verify no audio on page load (sound should
   start muted or require interaction first).

**Pass:** Sound effects work and can be toggled.

---

## 19. Help and Tutorial

**Goal:** Verify the help system works.

**Time:** 1 minute — any scenario

1. Press **?** — help overlay appears with sections
   for Navigation, Astrogation, Ordnance, Combat,
   and Other controls.
2. Content matches the current control scheme.
3. Press **?** again — overlay closes.
4. On first play, tutorial tips should appear
   during each phase explaining what to do.

**Pass:** Help overlay shows correct, up-to-date
controls. Tutorial tips appear for new players.

---

## 20. Edge Cases and Regressions

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

| Command | What it checks |
|---------|----------------|
| `npm test` | 2600+ unit/property tests |
| `npm run simulate -- all 25` | Engine stability across all 8 scenarios |
| `npm run lint` | Code style |
| `npm run typecheck` | Type safety |

All must pass before any release.

---

## What Manual Tests Don't Cover

- **WebSocket synchronisation edge cases** — race
  conditions between simultaneous messages
- **PWA offline mode** — service worker caching
- **Turn timer server-side enforcement** — requires
  real clock manipulation
- **Load testing** — many concurrent games
- **Cross-browser rendering** — differences between
  Chrome, Firefox, Safari canvas
