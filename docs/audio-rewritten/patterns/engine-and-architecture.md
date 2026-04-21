# Engine & Architecture Patterns

How the authoritative server stays consistent and why the shared engine has the shape it does. The architecture documentation covers the high-level layer diagrams and module inventory; this chapter zooms into the recurring patterns behind those layers.

Each section has four parts: the pattern, a minimal example, where it lives, and why this shape.

---

## Event-Sourced Match State

**Pattern.** Every mutation to an in-progress match is a versioned event appended to a per-match stream. Live state, replays, and reconnection are all projections of that stream plus periodic checkpoints — never a separate "current state" slot maintained by hand.

The flow works like this: a client-to-server action arrives at the engine, which is a pure function that returns events alongside updated state. That result passes through the publication pipeline, which appends events to a chunked stream, saves a checkpoint at turn boundaries, runs a parity check comparing the live result to the projected result, and then broadcasts filtered server-to-client messages.

Recovery follows the same shape in reverse: the system loads the latest checkpoint, loads the event tail since that checkpoint, and projects them together to arrive at current state.

**Minimal example.** The engine processes an astrogation action and returns a result containing state, movement data, and a list of engine events. The server then calls the publication pipeline with that result, attaching metadata like a game identifier, a sequence number, a timestamp, and the acting player to each event envelope.

**Where it lives.** The engine events module in the shared engine defines a 32-member union type covering every kind of engine event. The archive module on the server handles the append-only stream, grouping events into chunks of 64 per storage key. The event projector sub-package projects a stream back to state. The publication module is the single writer that coordinates all of this.

**Why this shape.**

- Recovery is free — any observer who can read the stream can reconstruct the game. No drift between live state and what was saved.
- Replays use the same code path as live play, filtered for the viewer. There is no second implementation.
- Chunked storage at 64 events per key keeps individual storage values well under the size limit while handling the hundred to three hundred events a typical match produces in a handful of writes.
- Checkpoints at turn boundaries reduce projection cost — reconnecting mid-match reads the latest checkpoint plus a short tail, not the whole history.

---

## Parity Check Between Live and Projected State

**Pattern.** After every incremental publication, the server reconstructs state from checkpoint plus event tail — the same code path used for reconnection — and compares it to the live in-memory result. Any mismatch is logged to telemetry but does not halt the match.

**Where it lives.** The publication module contains the parity verification function. The telemetry module records a projection parity mismatch event when a discrepancy is found. A dedicated projection module handles the reconstruction logic.

**Why this shape.**

- Replay correctness is the core invariant of the whole event-sourcing design. If the live result and the projected result differ, the stream is misrepresenting the match.
- The check is observability-only, not fatal — a parity bug should not take matches offline. The log-and-move-on approach accepts some correctness risk in exchange for availability while alerts are firing.

---

## Side-Effect-Free Shared Engine

**Pattern.** Everything in the shared layer has zero input or output: no Document Object Model access, no network calls, no storage, no random number generation, no console logging. Turn-resolution entry points — such as those handling astrogation, combat, and ordnance — deep-clone their input state on entry, then mutate the clone internally for speed. The caller's state is never touched.

**Minimal example.** Inside the combat processor, the first thing that happens is a deep clone of the incoming state. All mutations, such as applying damage to a ship, happen on the clone. The function then returns the cloned state along with engine events and results. The caller must use the returned state — their original reference is unchanged.

**Where it lives.** All files in the shared engine directory follow this rule. It is enforced by a clone-on-entry test file and by pre-commit checks that reject any use of the global random function, inner HTML assignment, or console logging.

**Why this shape.**

- Rollback safety — if the engine throws mid-turn, the server's real state is untouched.
- Speculative branching — artificial intelligence search and projection verification can invoke engine functions freely without defensive cloning.
- Testability — every engine call is a pure function given a random number generator. Property-based fuzzing is straightforward.

---

## Deterministic RNG via Per-Match Seed

**Pattern.** The server generates a 32-bit seed per match using the cryptographic random values API, persists it, and emits it in the game-created event. Before each engine call, a derive-action-RNG function derives a deterministic pseudo-random number generator from the match seed and the current event sequence number. This means replaying events from position N to M reproduces the same randomness without having to replay events from the beginning up to N. Providing a random number generator is mandatory on turn-resolution entry points.

**Minimal example.** For each action, the server derives a random number generator from the match seed and the state's event sequence number. Passing that same state, sequence number, and match seed always produces an identical result — every time.

**Where it lives.** The shared pseudo-random number generator module provides two functions: a Mulberry 32 generator and the derive-action-RNG function. The server actions module provides a helper that retrieves the action RNG. All engine entry points accept a random number generator as a required parameter typed as a function returning a number.

**Why this shape.**

- Replay determinism — the event stream alone is enough to verify history offline.
- Jumpable RNG — a Knuth multiplicative hash step means the system does not need to replay events one through N-minus-one to derive the random state for the Nth action.
- Injectable in tests — passing a fixed value or a seeded sequence pins outcomes reliably.

---

## Single Choke Points for Side Effects

**Pattern.** Where a side-effecting domain has an obvious owner, one function owns it. Instead of many call sites each doing a small piece of "persist plus broadcast plus schedule," a single applier function is the only path.

**Where it lives.** There are six of these choke points across the system. On the server, one function owns action execution and another owns state publication — handling event appending, checkpointing, parity checking, archiving, timer restarting, and broadcasting all in one place. On the client, one function owns command dispatch, another owns authoritative state application, another owns state-transition side effects, and a final one owns UI visibility changes.

**Why this shape.**

- Drift between similar flows is the main cost of duplication. If five call sites each "save state and broadcast," one of them will eventually forget to restart the turn timer.
- Tests get a narrow seam — asserting that the whole publication pipeline fired requires stubbing only one collaborator.

---

## Composition Root for Client Construction

**Pattern.** One function wires every collaborator and returns an object with narrow exports: dispose, renderer, and show-toast. No module constructs its own dependencies; they come in through dependency objects typed as callable getters.

**Minimal example.** A combat actions factory receives a dependencies object containing a get-game-state getter, a get-player-ID getter, a stable user interface reference, and a show-toast function. The getter pattern — calling get-game-state as a function rather than holding a direct reference — ensures collaborators always read the current state. The factory for combat actions is then created from those dependencies.

**Where it lives.** The client kernel module contains the game client factory function, which is the composition root. Input handler, UI manager, renderer, camera, bot client, and the various action factories all accept their dependencies at construction time.

**Why this shape.**

- Factories over classes make testing trivial — pass mock dependencies and inspect the returned methods.
- Callable getters ensure collaborators always read the current state and let the system break circular initialization-order dependencies without requiring a Proxy.
- The kernel is the only place where which module talks to which is visible. Collaborators do not reach for globals.

---

## Layer Boundaries (shared, server, client)

**Pattern.** Three top-level source directories operate under strict import rules. The shared layer imports only from shared. The server layer imports from shared and server, never from client. The client layer imports from shared and client, never from server.

**Where it lives.** Two import-boundary test files — one for the server and one for shared — enforce the directional rules at test time. Pre-commit checks enforce the sub-rule that shared code contains no input or output.

**Why this shape.**

- The shared engine is the contract between client and server. If one side pulls in the other's code, the boundary blurs and replay and parity break silently.
- Running the engine in Node for simulation or in the browser for local AI games uses the exact same code.

---

## Cross-Cutting Theme: Initial Game Creation Is the Outlier

Five of the patterns on this page note that initial match setup goes through a separate code path from incremental actions. It does not use the publication pipeline. It does not thread the match seed into the game creation function. It emits the game-created and fugitive-designated events outside the normal return path. And its reproducibility is only partial.

Consolidating initial creation into the same pipeline as every other action would close all five gaps at once. This is the single highest-leverage architecture refactor available in the codebase today.
