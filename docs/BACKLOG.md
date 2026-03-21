# Delta-V Backlog

Remaining work only. Completed items are in git history.

---

## Review Follow-Up

### Phase 0. Correctness fixes

- Align base resupply with the rulebook: bases provide unlimited
  fuel, mines, and torpedoes, but should not implicitly reload
  nukes or reset nuke allowance for free.

### Phase 1. Gameplay interaction cleanup

- Fix combat click priority on mixed friendly/enemy hexes so
  same-hex enemy targets remain selectable instead of always
  toggling a friendly attacker first.
- Share one "orderable ship" rule between the astrogation client
  and engine validation so destroyed ships and emplaced orbital
  bases are excluded from selection and order submission.
- Add explicit cycling for stacked enemy combat targets instead of
  picking the first untargeted ship by array order.
- Rework combat target selection so picking a target does not
  silently draft every legal attacker, or make "attack with all"
  an explicit player action.
- Tighten astrogation confirm behavior so ending the phase with
  untouched ships is either blocked or clearly represented as an
  intentional hold-course/no-op order.
- Add regression coverage for mixed-hex combat targeting, stacked
  target cycling, filtered astrogation order construction, and
  astrogation confirm behavior with partially planned fleets.

---

## Features

### Turn replay

Allow players to review past turns after a game ends
(or during, stepping back through history).

### Spectator mode

Third-party WebSocket connections that receive state
broadcasts but cannot submit actions.

**Files:** `src/server/game-do/game-do.ts` (spectator seat
type), `src/server/protocol.ts`, client spectator UI

### New scenarios

Lateral 7, Fleet Mutiny, Retribution — require mechanics
beyond what's currently implemented (rescue/passenger
transfer, fleet mutiny trigger, advanced reinforcement
waves).

### Rescue / passenger transfer

Transfer passengers between ships for rescue scenarios.
Extends the logistics phase with a new transfer type.
