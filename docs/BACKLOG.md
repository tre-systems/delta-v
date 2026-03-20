# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

All P0–P3 items are complete. User-testing readiness items are resolved. Only feature work remains.

---

## User-testing readiness *(all resolved)*

Issues found during a deep review ahead of user testing.

### High — fix before user testing

#### ~~1. No fetch timeout on game creation~~ *(done)*

Added `AbortController` with 10s timeout to `createGame()`.

#### ~~2. No loading indicator on game creation~~ *(done)*

Button shows "CREATING..." and disables while request is in flight.

#### ~~3. Empty src/client/__tests__/ directory~~ *(done)*

Deleted.

### Medium — ship without, but track

#### ~~4. Generic error messages~~ *(done)*

Distinct messages for timeout, network error, and server error.

#### ~~5. Engine errors not telemetrized~~ *(done)*

Engine errors now inserted into D1 via `reportEngineError`.

#### ~~6. Chat rate limit resets on reconnect~~ *(done)*

Rate limit moved from in-memory Map to DO storage.

#### ~~7. Event log unbounded growth~~ *(done)*

Capped at 500 events with oldest trimmed on append.

#### ~~8. No offline detection~~ *(done)*

Toast notifications on offline/online events.

### High — UI/mobile issues

#### ~~12. Help overlay shows keyboard shortcuts on mobile~~ *(done)*

Keyboard-only rows and sections hidden via CSS at mobile breakpoint.

#### ~~13. Game log says "Press ? for controls help" on mobile~~ *(done)*

Shows "Tap ? for controls" on mobile.

#### ~~14. Tutorial mentions keyboard shortcuts~~ *(done)*

Added `mobileText` variants for touch-friendly instructions.

### Low — nice-to-have

#### ~~15. No explicit CORS headers~~ *(done)*

Added `Access-Control-Allow-Origin: *` and OPTIONS preflight.

#### ~~16. Room code collision ceiling~~ *(done)*

32^5 (~33.6M) codes with 12 retries. Collision
ceiling documented in `src/server/protocol.ts`.

#### ~~17. Multiple WebSocket connections per player~~ *(done)*

Old sockets closed before accepting new connection.

---

## Multiplayer playtest issues

Issues found during live multiplayer testing (2025-03-20).

### P0 — fix before next playtest

#### 18. Camera doesn't auto-center on ship at turn start

When a turn begins the camera stays wherever the player left
it. Combined with zoomed-in defaults, players spend most of
their timer hunting for their ship instead of planning a burn.

**Fix:** snap or smooth-pan camera to the selected ship when
the astrogation phase starts, at minimum on Turn 1.

#### 19. Keyboard shortcuts for camera don't work

WASD, arrow keys, H (center fleet), +/- (zoom), and E
(focus enemy) all fail to do anything. Only drag-pan and
scroll-wheel zoom work. Likely a focus / event-routing issue
where keypresses aren't reaching the canvas handler.

### P1 — major UX gaps

#### 20. Burn direction not visible at default zoom

The "Click adjacent hex to set burn direction" prompt
assumes the hex grid is visible, but at the default zoom
level hexes are invisible. Either auto-zoom to show the grid
around the ship, or overlay directional arrows.

#### 21. No velocity vector / projected path

Velocity is shown as raw numbers ("1, -3") with no on-map
visualisation. A projected drift line or ghost-ship showing
where the ship will end up would massively help new players
grok vector movement.

#### 22. Planetary base threat zones not visible

Flying near enemy bases triggers defence fire with no prior
visual warning. Bases should render a threat radius or
danger-zone highlight so players can route around them.

### P2 — polish

#### 23. Disabled state has weak feedback

When a ship is disabled the only indicators are a small "D3"
badge and the confirm button. Add a more prominent visual:
red tint on the ship, "DISABLED" overlay, or shake animation.

#### 24. Turn timer punishes new players

The 90-second timer starts immediately. Combined with #18
(can't find ship), players repeatedly run out of time on
early turns. Consider a longer first-turn timer, or pause
until the player's first interaction.

#### 25. Chat input captures game keyboard shortcuts

If the chat textbox has focus, pressing number keys (1-6)
types into chat instead of setting a burn direction. Game-
relevant keys should be intercepted even when chat is focused
(or provide a clear way to toggle focus).

#### 26. Minimap is not interactive

The minimap shows planet/ship positions but clicking it
doesn't pan the main camera. Click-to-navigate would solve
the "can't find my ship" problem.

#### 28. Chat input UI hidden/unusable

The chat input row is difficult to see or missing, and the event log (e.g. "- Turn 11: You -") is squished into a tiny horizontal black bar at the bottom.

#### 29. "Waiting for opponent..." persists incorrectly

The text stays on screen during the player's turn and overlaps with other status instructions (like setting burn direction).

#### 30. Indistinguishable player and enemy ships

Both ships are labeled as "Corvette" in the same color, making it hard to tell them apart without looking at trail colors. Label should be color-coded or explicitly name the enemy.

#### 31. Top status bar extremely crowded

TURN, FUEL, speed info, objective, and ping (26MS) are all crammed together on the right. Need better spacing or moving ping to a corner.

#### 32. "DISABLED: 1T" text visibility

The red text over the trajectory lacks a background plate and feels slightly misaligned, making it hard to read against the dark grid.

### P3 — minor

#### 27. Empty turn headers in game log

Many log entries show "— Turn N: Opponent —" with no events
underneath. These empty headers should be collapsed or
omitted to reduce log noise.

---

## Features

### Turn replay

Allow players to review past turns after a game ends (or during, stepping back through history).

### Spectator mode

Third-party WebSocket connections that receive state broadcasts but cannot submit actions.

**Files:** `src/server/game-do/game-do.ts` (spectator seat type), `src/server/protocol.ts`, client spectator UI

### New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics beyond what's currently implemented (rescue/passenger transfer, fleet mutiny trigger, advanced reinforcement waves).

### Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios. Extends the logistics phase with a new transfer type.
