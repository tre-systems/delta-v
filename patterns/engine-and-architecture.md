# Engine & Architecture Patterns

This document complements [ARCHITECTURE.md](../docs/ARCHITECTURE.md) by consolidating gap analyses, consistency findings, known weaknesses, and implementation details that the main architecture doc does not cover. It draws from the individual pattern analyses in this directory. For the canonical system description, layer diagrams, module inventories, and data flow, see ARCHITECTURE.md.

---

## Event Sourcing & Projection Gaps

### Event Model Completeness
Key files: `src/shared/engine/engine-events.ts`, `src/server/game-do/publication.ts`, `src/shared/engine/event-projector/`

Known gaps in the event model:

- **Game creation is a special case.** The server emits `gameCreated` and `fugitiveDesignated` events outside the normal engine-action return path. Initial game creation in `match.ts` still uses its own direct publication path rather than `runPublicationPipeline`.
- **`turnAdvanced` under-specifies mutations.** `advanceTurn()` applies reinforcements and fleet conversion in memory, but the projector's `turnAdvanced` handler replays only player rotation and damage recovery. The next improvement is to make turn-advance side effects explicit in the event model or share the mutation logic between engine and projector.
- **Setup randomness is not fully reproducible from events.** The event model carries `matchSeed` on `gameCreated`, but the current setup path does not use that seed to rebuild initial randomized state. The projector reconstructs setup with `createGame(..., () => 0)` and relies on follow-up events like `fugitiveDesignated` to correct hidden-identity state.

### Parity and Projection
Key files: `src/server/game-do/projection.ts`, `src/server/game-do/archive.ts`

- The server's `getCurrentGameState` reconstructs state from events on every read via `getProjectedCurrentStateRaw`. There is no in-memory read model cache, so high-frequency reads (e.g., during WebSocket close handling) re-project from storage each time. Checkpoints help, but a cached projection would be more efficient.
- `projection.ts` calls `buildSolarSystemMap()` at module scope, creating a module-level singleton. Not an engine purity violation, but it is static state.

---

## CQRS Boundary Analysis

### Local Transport Blurs the Boundary
Key files: `src/client/game/transport.ts`

The local transport (`createLocalTransport`) runs the engine directly on the client and applies state via `applyGameState`. There is no event persistence or projection for local games -- the command result is immediately applied as the query model. Local games therefore lack replay and event-sourced recovery. This is intentional for single-player.

### Missing Client-Side Command Validation
All commands are validated by the engine before state mutation, but there is no client-side command validation or optimistic locking. Invalid commands result in server error responses rather than being prevented locally.

### Auxiliary Message Channel
Chat and ping messages (`AuxMessage`) bypass the command pipeline but can trigger state-adjacent effects (opponent status, latency tracking). Not strictly a CQRS violation but a parallel communication channel worth noting.

---

## Layer Boundary Enforcement

### Automated vs Convention-Based Boundaries
Key files: `src/server/import-boundary.test.ts`

Current enforcement status:

| Boundary | Enforcement |
|---|---|
| server never imports client | Automated test in CI |
| client never imports server | Convention only (grep-verified, no test) |
| shared never imports client/server | Convention only (grep-verified, no test) |
| shared/engine imports only shared utilities | No enforcement |

Recommendations:
- Add bidirectional boundary tests for client-to-server and shared-to-platform directions.
- ESLint `no-restricted-imports` rules would catch violations at the IDE level before tests run.
- A granular boundary test for `shared/engine/` would verify it only imports from shared utility and type modules, not from potentially impure shared modules.

---

## Composition Root Weaknesses

### Client Temporal Coupling
Key files: `src/client/game/client-kernel.ts`

`createGameClient` uses mutable closure variables (`let applyGameState`, `let setState`, `let transitionToPhase`, `let replayController`) to resolve circular dependencies between the session shell and client kernel. These variables are assigned after construction, creating temporal coupling that obscures the dependency graph.

### Hard Platform Dependencies
Key files: `src/client/game/connection.ts`, `src/client/game/session-api.ts`

Two modules bypass dependency injection for platform seams:
- `connection.ts` creates `new WebSocket(...)` directly inside `connect()` rather than receiving a WebSocket factory through deps.
- `session-api.ts` calls `fetch()` directly rather than through an injected HTTP client.

Both could be injected for full unit testing without browser globals.

### Server Deps Boilerplate
The `GameDO` class has 13+ `create*Deps` methods, each manually mapping `this.method` to deps fields. While explicit and testable, the repetition suggests the class might benefit from a shared deps-building utility.

---

## Hexagonal Architecture Gaps

### Transport Adapter Inconsistencies
Key files: `src/client/game/transport.ts`

- `submitSurrender` on the local transport is a no-op. `sendChat` is also empty. These violate Liskov Substitution -- callers cannot rely on all commands having effect regardless of adapter.
- `submitEmplacement` on the local transport calls `processEmplacement` directly rather than going through the `dispatchLocalResolution` pattern used by all other commands. Emplacement error handling therefore differs from other actions.

### Missing Symmetric Ports
- No server-side equivalent of `GameTransport`. The server receives commands as raw WebSocket messages routed through `actions.ts`. A `GameCommandPort` interface would formalize the contract and enable non-WebSocket command sources (HTTP admin tools, test harnesses).
- No `GameNotificationPort` on the client. State updates arrive through raw WebSocket messages processed by the session shell.
- The archive module takes `DurableObjectStorage` directly. Extracting a minimal `EventStore` interface would make event-sourcing testable without DO mocks.

---

## Pure Engine Invariants & Risks

### Internal Mutators Are Exported
Key files: `src/shared/engine/turn-advance.ts`, `src/shared/engine/victory.ts`

- `advanceTurn` does NOT clone its input -- it mutates state directly. Safe because it is always called on an already-cloned state within a parent engine function, but it breaks the self-contained purity rule if called directly on uncloned state. The clone-on-entry test does not cover `advanceTurn` as a standalone entry point.
- `checkGameEnd` and `applyCheckpoints` in `victory.ts` also mutate in place. They are exported and could theoretically be called unsafely by external code.
- Consider making these module-private or extracting them into an `internal` sub-module with restricted exports.

### Compile-Time Enforcement
The mutable-clone pattern is convention, not a type-system guarantee. A new engine function could forget the `structuredClone` call. TypeScript `Readonly<GameState>` (deeply applied) would make the immutability contract compile-time enforced but would require pervasive type changes.

### Double Cloning
Some call chains clone more than once: `saveCheckpoint` clones the state, and the publication pipeline calls it after the engine entry point already produced a cloned result. Each clone is individually necessary (engine protects input, checkpoint protects live state from storage reference sharing), but the cost is worth noting if state grows.

---

## Deterministic RNG Gaps

### Setup Path Not Fully Seeded
Key files: `src/shared/engine/game-creation.ts`, `src/server/game-do/match.ts`

- `createGame` still has `rng: () => number = Math.random` as default. The production match-initialization path (`initGameSession`) currently calls it without threading the allocated `matchSeed`.
- `getActionRng` falls back to `Math.random` when no `gameId` or `matchSeed` is available. If legacy unseeded matches no longer matter, this fallback should become an error instead of a silent determinism downgrade.

### Projector Workaround
The `gameCreated` projector path reconstructs setup with `createGame(..., () => 0)` and relies on corrective follow-up events. Until `matchSeed` is threaded through initial game creation, action replay is deterministic but initial setup reproducibility is only partially enforced.

---

## Derive/Plan Pattern Notes

### Engine vs Client Convention Split
Key files: `src/client/game/phase.ts`, `src/shared/engine/victory.ts`, `src/shared/combat.ts`

Engine-side `apply*` functions (`applyDamage`, `applyResupply`, `applyCheckpoints`) mutate their `GameState` argument in place for performance. Client-side `apply*` functions use dependency injection and do not mutate inputs. This dual convention is undocumented and could confuse contributors.

### Nested Derive Inside Apply
`applyClientStateTransition` calls `deriveClientStateEntryPlan` internally, so the derive is nested inside the apply rather than being done by the caller. The caller does not see the entry plan. A minor deviation from the pattern's intent.

---

## Pipeline Pattern Notes

### Publication Pipeline Bypass
Key files: `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`

Initial game creation in `match.ts` still uses its own direct publication path. This is the most frequently cited gap across multiple pattern analyses. Routing initial creation through `runPublicationPipeline` (or extracting a first-publication variant) would close the bypass.

### Input Pipeline Bypass
Drag panning intentionally bypasses command dispatch and calls `camera.pan()` directly. This is correct -- continuous high-frequency interactions should not go through the command pipeline.

---

## Engine Error Return Consistency

### Mixed Construction Styles
Key files: `src/shared/engine/combat.ts`, `src/shared/engine/util.ts`

`processCombat` mixes `engineFailure()` helper calls with inline `{ error: { code, message } }` construction. About 10 occurrences in combat use the inline form. The helper should be preferred everywhere.

### Repeated Validation Boilerplate
Every engine entry point repeats:
```typescript
const phaseError = validatePhaseAction(state, playerId, 'combat');
if (phaseError) return { error: phaseError };
```

A combined `validatePhaseOrFail` returning `{ error } | null` would eliminate the wrapping.

### Implicit Type Narrowing Invariant
The `'error' in result` check works because no success result type has an `error` field. This is an implicit invariant -- adding an `error` field to any success type would break narrowing. Consider a more explicit discriminant if the types grow.

---

## Cross-Cutting Findings

### Recurring Theme: Initial Game Creation
The most frequently cited architectural gap across event sourcing, SRP choke points, pipeline, deterministic RNG, and pure engine patterns is that initial game creation follows a separate code path from incremental game actions. Consolidating this would address gaps in five patterns simultaneously.

### Server Write Choke Point Is Conventional
`broadcastStateChange` remains available as a lower-level callback inside DO wiring, so the publication choke point is conventional rather than structurally impossible to bypass. Keeping lower-level publication helpers private to the owning module would prevent new code from skipping the choke point accidentally.

### SRP Choke Point Coverage
- Server incremental writes: converge on `runPublicationPipeline` (one exception: `initGameSession`).
- Server command execution: all websocket game-state commands share `runGameStateAction`.
- Client authoritative writes: `applyClientGameState` owns all authoritative state updates. `clearClientGameState` is a second, intentionally minimal entry point for session teardown.
