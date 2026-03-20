# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

All P0–P3 items are complete. User-testing readiness items are resolved. Multiplayer playtest issues are resolved (except #26 interactive minimap). Only feature work remains.

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

#### ~~18. Camera doesn't auto-center on ship at turn start~~ *(done)*

`frameOnShips()` now clamps zoom to 0.6–1.8× and filters
destroyed ships, ensuring the hex grid is visible on center.

#### ~~19. Keyboard shortcuts for camera don't work~~ *(done)*

Switched document `keydown` listener to capture phase so it
fires before chat input's `stopPropagation`. Escape blurs
focused inputs to restore keyboard control.

### P1 — major UX gaps

#### ~~20. Burn direction not visible at default zoom~~ *(done)*

Burn markers enlarged from 8→12px with numbered labels (1-6)
matching keyboard shortcuts. Combined with #18 zoom fix,
hexes are now visible at default zoom.

#### ~~21. No velocity vector / projected path~~ *(done)*

Velocity vectors now show arrowheads indicating drift
direction and a ghost dot at the predicted destination for
own ships.

#### ~~22. Planetary base threat zones not visible~~ *(done)*

Enemy base adjacent gravity hexes now render a subtle red
threat zone highlight showing where defense fire applies.

### P2 — polish

#### ~~23. Disabled state has weak feedback~~ *(done)*

"DISABLED" label now renders with a dark red background plate
and white text for visibility against any background.

#### ~~24. Turn timer punishes new players~~ *(done)*

Timer display hidden for the first 15 seconds of each turn,
giving players time to orient without clock pressure.

#### ~~25. Chat input captures game keyboard shortcuts~~ *(done)*

Fixed via #19 capture-phase listener. Escape key blurs chat
input to return focus to the game.

#### 26. Minimap is not interactive

The minimap shows planet/ship positions but clicking it
doesn't pan the main camera. Click-to-navigate would solve
the "can't find my ship" problem.

#### ~~28. Chat input UI hidden/unusable~~ *(done)*

Increased chat input font (0.68→0.75rem), padding, and
border visibility.

#### ~~29. "Waiting for opponent..." persists incorrectly~~ *(done)*

Removed redundant "Waiting for opponent..." status text;
"OPPONENT'S TURN" in the phase bar conveys the same info.

#### ~~30. Indistinguishable player and enemy ships~~ *(done)*

Enemy ship labels now prefixed with "Enemy" and rendered in
brighter orange (0.7 opacity) vs player white labels.

#### ~~31. Top status bar extremely crowded~~ *(done)*

Latency indicator moved to fixed bottom-left corner at
reduced opacity, freeing space in the top bar.

#### ~~32. "DISABLED: 1T" text visibility~~ *(done)*

Fixed via #23 background plate improvement.

### P3 — minor

#### ~~27. Empty turn headers in game log~~ *(done)*

Previous turn header auto-removed if no events were logged
after it before the next turn header is added.

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
