# Protocol & Persistence Patterns

How WebSocket actions turn into persisted events and back into broadcast state. A separate architecture document shows the high-level action path; this chapter zooms into the patterns that make replay, reconnection, and spectating correct.

Each section covers the pattern, a minimal example, where it lives, and why this shape.

---

## Chunked Event Storage

**Pattern.** Per-match events live in fixed-size chunks of 64 events per storage key, not one key per event and not one giant key per match. New events append to the current chunk; the chunk count and sequence counter update together in a single atomic storage write.

The storage layout for a given match uses separate keys for each chunk of events, a key tracking the total number of chunks, and a key tracking the current sequence number. For example, a match that has accumulated 128 events would have two chunks of 64, a chunk count of 2, and a sequence number of 128.

**Where it lives.** The archive storage module defines the chunk size and provides read and write helpers. A separate archive module builds the event envelopes. A compatibility module lazily migrates legacy single-key event streams on first access.

**Why this shape.**

- **Value-size ceiling.** Durable Object storage values max out at 128 kilobytes. A typical match produces 100 to 300 events, which works out to roughly 6 to 32 kilobytes per chunk — well inside the limit.
- **Atomic appends.** Writing the modified chunk, the chunk count, and the sequence number in a single storage call prevents split-brain state after a crash.
- **Fast tail reads.** A simple division tells the server which chunk to start from when replaying events for a reconnecting client — no need to scan the whole stream from the beginning.

---

## Event Envelopes

**Pattern.** Raw engine events are wrapped in envelopes before persistence. Envelopes carry identity metadata — the game identifier, the sequence number, a timestamp, and the actor — separate from the event payload. The engine never knows about envelopes; the publication pipeline wraps them.

An envelope holds the stable per-match game identifier, a sequence number that counts monotonically within that match, a server timestamp, the actor (either a player identifier or the string "server"), and the underlying engine event, which can be one of 32 domain event shapes.

**Where it lives.** The envelope type is defined in the shared engine events module. Envelopes are constructed in the archive module. They are consumed by the event projector and by replay timeline code.

**Why this shape.**

- **The sequence number is authoritative ordering.** Timestamps can drift; sequence numbers do not.
- **The game identifier is stable even across room reuse.** A single room code can host multiple matches — for example, a rematch gets a new suffix — so the game identifier is what disambiguates which match an event belongs to.
- **The actor field enables per-player provenance** for replay viewers and anti-cheat audits without having to parse the event body.

---

## Checkpoints at Turn Boundaries

**Pattern.** After every turn-advanced or game-over event, the server saves a full game state snapshot. Reconstruction loads the latest checkpoint plus the event tail after it — not the whole stream from the beginning.

**Where it lives.** The publication module contains the checkpoint logic, and snapshots are keyed by game identifier and turn number. Schema migration runs on both save and load to handle evolving state shapes.

**Why this shape.**

- **Bounded projection cost.** Without checkpoints, reconstructing a 50-turn match requires projecting all 50 turns' worth of events. With per-turn checkpoints, reconstruction only needs at most one turn's worth of tail events.
- **Turn boundaries, not every event.** Checkpointing on every event would multiply storage writes by roughly ten with no recovery benefit — a turn's events are a natural atomic unit.
- **Non-atomic with event append is benign.** A crash between the checkpoint save and the event append leaves a stale checkpoint, but the event tail covers the gap. Correctness never depends on both writes committing together.

---

## Publication Pipeline (Single Writer)

**Pattern.** Every state-changing action runs through one function that appends events, checkpoints at turn boundaries, verifies parity, writes the match archive on game-over, restarts the turn timer, and broadcasts. Not six separate helpers — one pipeline.

Calling the publication pipeline with a result from an engine call is equivalent to running all of these steps in sequence: appending events, optionally checkpointing, verifying projection parity, optionally archiving, restarting the turn timer, and broadcasting the result.

**Where it lives.** The publication module is called by the game Durable Object's action handler for client-to-server actions, and by the turn timeout handler for alarm-driven timeouts.

**Why this shape.**

- Any new action automatically gets event persistence, checkpoint cadence, parity verification, archive-on-end, timer management, and broadcasting — for free. There is no way to forget a step.
- Tests stub one collaborator at a time — storage, broadcast, or archive — and assert on the whole pipeline's behavior.

---

## Discriminated Union Messages (Client-to-Server and Server-to-Client)

**Pattern.** All WebSocket messages are TypeScript discriminated unions keyed by a type field. Runtime validation produces typed values; TypeScript's exhaustive checking catches missing handlers.

The client-to-server union has variants for actions like submitting astrogation orders, submitting combat attacks, and skipping ordnance. A dispatch map on the server side maps each action type to its handler, and TypeScript enforces that every variant has a corresponding handler at compile time. A separate auxiliary message type covers non-state-mutating traffic like chat, pings, and rematch requests.

**Where it lives.** The message types are defined in the shared protocol types module. Runtime validation lives in the shared protocol module. The dispatch map lives in the game Durable Object's actions module.

**Why this shape.**

- **Single source of truth.** Client and server share the union; neither can send a message shape the other does not understand.
- **Compile-time exhaustiveness.** Adding a new client-to-server variant fails to compile on the server until a handler is added.
- **Clean rate-limit boundary.** The auxiliary message type lets the Durable Object route chat and pings separately from game-state actions without re-parsing the message.

---

## Single State-Bearing Message per Action

**Pattern.** Every state-mutating action produces exactly one server-to-client message that carries the full updated game state. Clients replace their state wholesale — no delta patching, no optimistic updates.

When the server processes a movement action, it broadcasts one message containing the movements, the events, and the complete new game state. The client receives that message and replaces its local state entirely. The game-over message is intentionally separate and sent after the final state-bearing message.

**Where it lives.** The stateful server message union in the shared protocol types covers game start, state update, movement result, combat result, and single combat result. Message builders live in the game Durable Object's message builders module.

**Why this shape.**

- **Reconnection is trivial.** A returning client gets one state update message — no need to replay a sequence of deltas.
- **No ordering bugs.** With delta patching, mis-ordered or dropped frames desynchronize the client from the server. With wholesale state replacement, the latest message is always the truth.
- **Bandwidth cost is acceptable.** A typical game state is a few kilobytes and messages are turn-paced.

---

## Viewer-Aware Filtering

**Pattern.** Before any state goes to a socket, it passes through a filter function that strips hidden information per viewer. Players keep full visibility into their own state; unrevealed enemy ships have their identity stripped; spectators receive a spectator-safe projection.

When broadcasting, the server iterates over all open WebSockets. For each socket it retrieves the viewer identifier — which is zero, one, or the string "spectator" — and sends a version of the message with the state filtered for that specific viewer.

**Where it lives.** The filter function lives in the shared movement resolution module. The broadcast function that applies it lives in the game Durable Object's broadcast module. Sockets are tagged with their viewer identity at the time of the WebSocket upgrade handshake.

**Why this shape.**

- **Server-authoritative hidden state.** In the Escape scenario, the fugitive ship's identity field is stripped before the message reaches any opponent's socket — the filter runs on the server, not the client.
- **Early-return optimization.** When no ship has identity fields and the scenario does not use hidden-identity rules, the filter returns the original state by reference with no allocation.
- **Same filter for replays and live spectators.** A spectator-tagged socket and a replay timeline both pass through the same filter code. There is no parallel "filter for replay" implementation to keep in sync.

---

## Hibernatable WebSocket

**Pattern.** The Durable Object uses Cloudflare's hibernation API instead of classic event listeners. The Durable Object can hibernate between messages — no in-memory state survives a wake.

When upgrading a connection, the server accepts the WebSocket with a tag identifying the player. Later, when the Durable Object wakes on an incoming message, it recovers the player's tags from the socket itself and reloads game state from storage rather than from memory.

**Where it lives.** The main game Durable Object module handles the accept call and the message and close callbacks. Supporting modules handle hibernation entry points, the welcome and reconnect flow, and the disconnect grace period.

**Why this shape.**

- **Cost.** Hibernation lets a Durable Object idle without tearing down its sockets. Alarm-driven wake-ups stay cheap.
- **Tags replace an in-memory socket map.** Looking up sockets by tag eliminates the need to maintain a separate map from player identifier to WebSocket that could fall out of sync.
- **Per-socket data survives wake cycles.** Cloudflare preserves WebSocket objects across hibernation, so per-socket rate limits and replaced-socket tracking remain valid within a wake.

---

## Single-Alarm Multi-Deadline Scheduling

**Pattern.** One alarm per Durable Object, rescheduled after each state change. Three independent deadlines — a 30-second disconnect grace period, a 2-minute turn timeout, and a 5-minute inactivity timeout — are tracked in storage. A helper computes the nearest deadline; a discriminated action type tells the alarm handler which deadline fired.

**Where it lives.** The alarm module contains the logic that resolves which action fired, returning one of three variants: disconnect expired, turn timeout, or inactivity timeout. The disconnect grace constant is defined in the session module. The inactivity timestamp is cached in memory and flushed to storage at most once every 60 seconds to avoid write amplification from frequent pings.

**Why this shape.**

- **Single alarm slot.** Durable Objects have one alarm. Storing three deadlines and taking the minimum is the only clean way to multiplex them.
- **Discriminated action type.** The handler dispatches with an exhaustive switch statement; there is no guesswork about which deadline fired.
- **Flush throttling.** Inactivity pings happen often; each one does not need a storage write. An in-memory cache with a 60-second flush keeps writes bounded.

---

## Cross-Pattern Flow

A single client-to-server action threads all of these patterns in order.

When a client sends a WebSocket message, the Durable Object wakes from hibernation and uses the socket's tags to identify the player. The message passes through rate limiting and runtime validation. The game state action handler calls the engine and gets back a list of engine events.

Next, the publication pipeline takes over. It appends the events to chunked storage. If the action crossed a turn boundary, it saves a checkpoint. It verifies projection parity. If the game ended, it writes the match archive to long-term storage. It restarts the turn timer. Finally, it broadcasts the result — applying viewer-aware filtering per socket before sending.

Every step has a single owner, a single reason to exist, and a single place to look when debugging.
