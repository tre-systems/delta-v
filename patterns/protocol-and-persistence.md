# Protocol & Persistence

Patterns governing the event-sourced persistence layer and the WebSocket protocol between client and server. The architecture doc covers the high-level event-sourcing model and action path; this document focuses on implementation specifics, gaps, and cross-pattern interactions.

## Event Stream + Checkpoint Recovery (31)

Key files: `src/server/game-do/archive.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/projection.ts`, `src/shared/engine/event-projector/index.ts`, `src/server/game-do/archive-compat.ts`

Checkpoints fire only at turn boundaries (`turnAdvanced` or `gameOver` events), triggered centrally in `checkpointIfNeeded` from the single `runPublicationPipeline` function. Schema migration runs both on save (`normalizeArchivedGameState`) and load (`normalizeArchivedStateRecord`).

Gap: checkpoint save and event append are separate `storage.put` calls, not a single atomic batch. A crash between them leaves a stale checkpoint, but this is benign since tail replay covers the gap.

Gap: no checkpoint pruning for completed matches. Old checkpoints persist until DO eviction.

Recovery serves two paths: live state (`getProjectedCurrentStateRaw` -- checkpoint + tail) and replay timeline (`getProjectedReplayTimeline` -- full stream with checkpoint fallback). Both handle missing checkpoints by falling back to full replay.

## Parity Check (32)

Key files: `src/server/game-do/publication.ts`, `src/server/game-do/telemetry.ts`, `src/server/game-do/projection.ts`

Runs on every incremental publication (not just turn boundaries). Reconstructs state via the same checkpoint-plus-tail path used for reconnection, then compares against live state using `JSON.stringify` equality after normalization.

Normalization gap: production strips only `player.connected`, but some test comparisons also filter `ready` and `detected`. If those fields are legitimately non-replayable, production and test normalization should be aligned.

Design choice: observability-only. Mismatches log + write to D1 telemetry but do not halt the match. `JSON.stringify` comparison is order-sensitive and produces coarse mismatch output -- structured diffs would improve debugging.

## Chunked Event Storage (33)

Key files: `src/server/game-do/archive-storage.ts`, `src/server/game-do/archive-compat.ts`

Chunk size: `EVENT_CHUNK_SIZE = 64`. A typical match generates 100-300 events (2-5 chunks). Each chunk is roughly 6-32 KB, well within the 128 KB DO storage value limit. All writes (modified chunks + chunk count + seq counter) go in a single `storage.put(entries)` call for atomicity.

Lazy legacy migration: `migrateLegacyEventStreamIfNeeded` converts old single-key streams to chunked format on first access via `ensureArchiveStreamCompatibility`.

Tail read formula: `startChunkIndex = Math.floor(afterSeqExclusive / EVENT_CHUNK_SIZE)` may read one extra chunk at exact boundaries, but per-envelope `seq` filtering ensures correctness.

Performance note: `readChunkedEventStream` loads chunks sequentially with `await` per iteration. `Promise.all` would parallelize, but most matches produce fewer than 5 chunks so the impact is minimal.

## Discriminated Union Messages (47)

Key files: `src/shared/types/protocol.ts`, `src/shared/protocol.ts`, `src/server/game-do/actions.ts`, `src/server/game-do/ws.ts`

C2S and S2C are discriminated unions on a `type` string field. Compile-time exhaustiveness is enforced on the action handler map via `satisfies Record<GameStateActionType, unknown>`. `AuxMessage = Exclude<C2S, { type: GameStateActionType }>` cleanly separates chat/ping/rematch from state-mutating actions.

Asymmetry: `validateServerMessage` casts via `as unknown as S2C` rather than constructing a fresh typed object (intentional -- server is authoritative). Neither validator uses a `never` default case for compile-time exhaustiveness; both fall through to `default: return invalid(...)`.

Gap: no `satisfies Record<...>` equivalent for S2C broadcast paths. A new S2C type can be added to the union without a guaranteed broadcast implementation.

The `emplaceBase` C2S variant lacks a `skipEmplacement` counterpart (unlike ordnance/combat/logistics), because emplacement is optional within the astrogation phase. Domain-correct but breaks the visual symmetry of the protocol.

## Single State-Bearing Message (48)

Key files: `src/shared/types/protocol.ts`, `src/server/game-do/message-builders.ts`, `src/server/game-do/actions.ts`, `src/server/game-do/broadcast.ts`, `src/server/game-do/publication.ts`

Every state-mutating action produces exactly one S2C message with a full `state: GameState` field. The `StatefulServerMessage` type unifies `gameStart`, `stateUpdate`, `movementResult`, `combatResult`, and `combatSingleResult`. Clients replace local state wholesale on receipt -- no delta patching, no optimistic updates.

Design trade-off: bandwidth-heavy for large fleets, but eliminates sync bugs from partial/out-of-order deltas. Reconnection requires only a single `stateUpdate` message.

`gameOver` is intentionally separate: `broadcastStateChange` sends the state message first, then `gameOver` as a follow-up. The state message still contains the terminal state.

## Viewer-Aware Filtering (49)

Key files: `src/shared/engine/resolve-movement.ts`, `src/server/game-do/broadcast.ts`, `src/shared/engine/viewer-filter.test.ts`

`filterStateForPlayer` strips unrevealed ship identities based on `ViewerId` (player number or `'spectator'`). Early-return optimization: when no ships have identity fields and the scenario does not use hidden identity rules, the original state is returned by reference (zero allocation).

Per-viewer broadcast in `broadcastFilteredMessage` uses DO socket tags (`player:0`, `player:1`, `spectator`) to route filtered copies.

Limitation: only handles `identity` stripping. Fog-of-war (hiding ship positions) would need extension, but the single-chokepoint design makes this straightforward.

No spectator delay: spectators see the same timing as players, which could be exploited in competitive contexts.

Replay timelines also pass through filtering, ensuring archived games do not leak hidden state.

## Hibernatable WebSocket (50)

Key files: `src/server/game-do/game-do.ts`, `src/server/game-do/ws.ts`, `src/server/game-do/socket.ts`, `src/server/game-do/fetch.ts`, `src/server/game-do/session.ts`, `src/server/game-do/alarm.ts`

Uses Cloudflare DO WebSocket Hibernation: `ctx.acceptWebSocket(server, tags)` during upgrade, then `webSocketMessage` / `webSocketClose` callbacks on wake. No in-memory state survives hibernation -- player identity comes from socket tags, game state from storage projection.

`WeakMap<WebSocket, RateWindow>` for rate limits and `replacedSockets` WeakSet survive within a single wake cycle (runtime preserves WebSocket objects) but are lost on full DO eviction. This is acceptable given the short rate-limit windows (1 second).

Alarms (`ctx.storage.setAlarm()`) handle turn timeouts, disconnect grace periods, and inactivity cleanup. The alarm handler is hibernation-safe (reads state from storage).

Cost of hibernation: every action reads current state via `getProjectedCurrentStateRaw` (checkpoint + event tail projection). Checkpoints amortize this cost.

## Cross-Pattern Interactions

The persistence and protocol layers form a tight feedback loop:

1. Action arrives via hibernatable WebSocket (50) -> rate-limited (60) -> validated (47/58)
2. Engine produces next state -> single state-bearing message built (48)
3. Events appended to chunked stream (33) -> checkpoint saved at turn boundaries (31)
4. State filtered per viewer (49) -> broadcast via tagged sockets (50)
5. Parity check (32) reconstructs state from checkpoint + tail and compares against live state

The main unresolved cross-cutting concern is normalization consistency between parity checks and viewer filtering -- both transform `GameState` before comparison/broadcast, but their normalization logic is maintained independently.
