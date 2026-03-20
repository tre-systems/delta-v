# Delta-V Backlog

Prioritised list of remaining work. Items are grouped by type and ordered by priority within each group. The priority reflects a product heading toward commercial release with user testing.

**Priority key:** P0 = rule correctness, P1 = production safety & iteration velocity, P2 = code quality & extensibility, P3 = test coverage.

All P0–P3 items are complete. Only feature work remains.

---

## User-testing readiness

Issues found during a deep review ahead of user testing. Grouped by priority relative to the first external test session.

### High — fix before user testing

#### 1. No fetch timeout on game creation

`createGame()` in `src/client/main.ts` can hang
indefinitely on slow networks. Add an `AbortController`
with ~10s timeout so the UI always recovers.

**Files:** `src/client/main.ts`

#### 2. No loading indicator on game creation

Users click "Create Game" and see nothing for 2–5s
while the request completes. Show a spinner or disable
the button until the response arrives.

**Files:** `src/client/ui/ui.ts`, `src/client/main.ts`

#### ~~3. Empty src/client/__tests__/ directory~~ *(done)*

Deleted.

### Medium — ship without, but track

#### 4. Generic error messages

"Failed to create game. Try again." doesn't distinguish
server errors from network issues. Users won't know
whether the problem is on their end or the server.

**Files:** `src/client/main.ts`, `src/client/ui/ui.ts`

#### 5. Engine errors not telemetrized

When the game engine throws, the error is logged to
stdout but not sent to D1. Capturing these from real
users is essential for catching edge-case bugs.

**Files:** `src/server/game-do/game-do.ts`,
`src/client/telemetry.ts`

#### 6. Chat rate limit resets on reconnect

The 500ms per-player rate limit is held in memory and
lost on reconnect. Low risk with 2-player rooms but
technically exploitable.

**Files:** `src/server/game-do/game-do.ts`

#### 7. Event log unbounded growth

No cleanup or checkpointing for long games. The full
event log is re-read and re-written on each append.
Monitor and consider checkpointing for games longer
than ~1 hour.

**Files:** `src/server/game-do/game-do.ts`

#### 8. No offline detection

When internet drops, reconnection attempts fire
immediately with no "You're offline" message. Adding
`navigator.onLine` checks and `offline`/`online` event
listeners would give much better UX.

**Files:** `src/client/main.ts`

### High — UI/mobile issues

#### 12. Help overlay shows keyboard shortcuts on mobile

The controls help overlay (?) is identical on desktop and
mobile. Mobile users see WASD, Tab, N, T, K, Enter, Esc,
E, H, L, M — all keyboard-only shortcuts they can't use.
On mobile, show only touch-relevant controls (drag to
pan, pinch to zoom, tap ship to select, tap arrow to
burn). Hide or collapse keyboard-only sections behind a
"Keyboard shortcuts" disclosure on mobile.

**Files:** `static/index.html` (help overlay HTML),
`static/style.css`

#### 13. Game log says "Press ? for controls help" on mobile

The opening log message tells players to "Press ? for
controls help" — a keyboard instruction. On mobile, this
should say "Tap ? for controls help" or just
"Tap the ? button for help".

**Files:** `src/client/game/helpers.ts` (lines 256, 281)

#### 14. Tutorial mentions keyboard shortcuts

Tutorial step text references keyboard shortcuts that
don't exist on mobile. For example, the ordnance tip
says "Use N=mine, T=torpedo, K=nuke" and the combat
tip says "Press Enter to attack or skip". On mobile
these should reference the on-screen buttons instead.

**Files:** `src/client/tutorial.ts`

### Low — nice-to-have

#### 15. No explicit CORS headers

Telemetry and error-reporting endpoints rely on
Cloudflare defaults. Should add explicit
`Access-Control-Allow-Origin` headers.

**Files:** `src/server/index.ts`

#### 16. Room code collision ceiling

34^5 (~45M) codes with 12 retries. Fine for early
testing but the scaling limit should be documented.

**Files:** `src/server/protocol.ts`

#### 17. Multiple WebSocket connections per player

Opening two tabs with the same token causes both to
receive broadcasts. Could confuse users who
accidentally open a second tab.

**Files:** `src/server/game-do/game-do.ts`

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
