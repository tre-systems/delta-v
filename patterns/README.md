# Delta-V Pattern Catalogue

A comprehensive catalogue of 65 design patterns used throughout the Delta-V codebase. Each pattern document includes intent, real code examples, consistency analysis, completeness checks, and cross-references.

## Architectural (7)

| # | Pattern | Intent |
|---|---------|--------|
| [01](01-event-sourcing.md) | Event Sourcing | Persist state as append-only event streams for replay, audit, and recovery |
| [02](02-cqrs.md) | CQRS | Separate command (write) paths from query (read) paths |
| [03](03-layered-architecture.md) | Layered Architecture | Enforce dependency direction: shared < server, shared < client |
| [04](04-composition-root.md) | Composition Root | Wire all dependencies at a single entry point via factory functions |
| [05](05-hexagonal-architecture.md) | Hexagonal Architecture | Abstract transport so client works with WebSocket or local engine |
| [06](06-srp-choke-points.md) | SRP Choke Points | Funnel cross-cutting flows through single owning functions |
| [07](07-stateless-pure-engine.md) | Stateless Pure Engine | All game logic as pure functions with no I/O or global state |

## Behavioral (8)

| # | Pattern | Intent |
|---|---------|--------|
| [08](08-command-pattern.md) | Command Pattern | Decouple user input interpretation from execution |
| [09](09-state-machine.md) | State Machine | Compile-time validated phase transitions for client and engine |
| [10](10-reactive-signals.md) | Reactive Signals | Fine-grained reactivity with automatic dependency tracking |
| [11](11-strategy-config-scoring.md) | Strategy (Config Scoring) | AI difficulty as pure data weights, not code branches |
| [12](12-derive-plan-pattern.md) | Derive/Plan | Pure "derive" functions return plans, "apply" functions execute them |
| [13](13-builder-pattern.md) | Builder | Construct complex objects (views, orders, maps) from parts |
| [14](14-visitor-event-projection.md) | Visitor (Event Projection) | Dispatch on event type to specialized projection handlers |
| [15](15-pipeline-pattern.md) | Pipeline | Compose ordered stages for publication, input, and rendering |

## Structural (4)

| # | Pattern | Intent |
|---|---------|--------|
| [16](16-adapter-pattern.md) | Adapter | Adapt local engine and WebSocket to common transport interface |
| [17](17-facade-pattern.md) | Facade | Hide subsystem complexity behind narrow API |
| [18](18-proxy-lazy-evaluation.md) | Proxy / Lazy Evaluation | Defer dependency resolution with getter-based late binding |
| [19](19-composite-pattern.md) | Composite | Compose independent render layers into a single frame |

## Creational (3)

| # | Pattern | Intent |
|---|---------|--------|
| [20](20-factory-functions.md) | Factory Functions | Return typed capability objects without `new` |
| [21](21-builder-game-setup.md) | Builder (Game Setup) | Construct full GameState from scenario, purchases, and RNG |
| [22](22-multiton-preset-registries.md) | Multiton (Presets) | Controlled set of scenario and AI config instances |

## Type System & Data Flow (8)

| # | Pattern | Intent |
|---|---------|--------|
| [23](23-discriminated-unions.md) | Discriminated Unions | Type-safe narrowing via `type`/`kind` discriminant fields |
| [24](24-result-type.md) | Result\<T, E\> | Type-safe error handling without exceptions |
| [25](25-engine-error-return.md) | Engine Error Return | `{ state } \| { error }` with `'error' in result` narrowing |
| [26](26-guard-clause-validation.md) | Guard Clause | Fail-fast validators returning `EngineError \| null` |
| [27](27-branded-types.md) | Branded Types | Prevent string mixing with phantom brand fields |
| [28](28-data-driven-lookup-tables.md) | Data-Driven Lookup Tables | Game data as indexed Records, not scattered conditionals |
| [29](29-cond-condp.md) | Cond/Condp | Clojure-style declarative branching as data |
| [30](30-utility-type-patterns.md) | Utility Type Patterns | `Pick`, `ReturnType`, `Readonly` for narrowed signatures |

## Persistence & State (5)

| # | Pattern | Intent |
|---|---------|--------|
| [31](31-event-stream-checkpoint.md) | Event Stream + Checkpoint | Recover state from checkpoint + event tail replay |
| [32](32-parity-check.md) | Parity Check | Verify projected state matches live state after publish |
| [33](33-chunked-event-storage.md) | Chunked Event Storage | Fixed-size chunks bound per-key storage size |
| [34](34-deterministic-rng.md) | Deterministic RNG | All randomness injected as `rng` parameter, seeded per action |
| [35](35-mutable-clone.md) | Mutable Clone | `structuredClone` on entry, mutate internally, return result |

## Client-Specific (11)

| # | Pattern | Intent |
|---|---------|--------|
| [36](36-disposal-scope.md) | Disposal Scope | Explicit lifecycle cleanup via scoped disposables |
| [37](37-planning-store.md) | Planning Store | Accumulate local planning mutations before submission |
| [38](38-session-model.md) | Session Model | Single reactive aggregate root for all session state |
| [39](39-smart-dom-helpers.md) | Smart DOM Helpers | `el()`, `visible()`, `text()`, `cls()` with signal support |
| [40](40-trusted-html-boundary.md) | Trusted HTML Boundary | All innerHTML through reviewed `setTrustedHTML` helper |
| [41](41-input-pipeline.md) | 3-Layer Input Pipeline | Raw DOM -> InputEvent -> GameCommand -> dispatch |
| [42](42-canvas-renderer.md) | Canvas Renderer Factory | Layered scene/entity/overlay rendering via factory |
| [43](43-camera-viewport.md) | Camera/Viewport Transform | Pan/zoom with screen-world coordinate mapping |
| [44](44-animation-manager.md) | Animation Manager | Stateful interpolator separate from game state |
| [45](45-string-key-serialization.md) | String-Key Serialization | Value objects serialized to branded strings for Map keys |
| [46](46-record-type-mapping.md) | Record-Based Type Mapping | `Record`/`Map` over arrays for O(1) lookups |

## Protocol & Communication (4)

| # | Pattern | Intent |
|---|---------|--------|
| [47](47-discriminated-union-messages.md) | Discriminated Union Messages | C2S/S2C protocol with `type` field dispatch |
| [48](48-single-state-message.md) | Single State-Bearing Message | One action produces exactly one state update |
| [49](49-viewer-aware-filtering.md) | Viewer-Aware Filtering | Per-player state filtering before broadcast |
| [50](50-hibernatable-websocket.md) | Hibernatable WebSocket | Cloudflare DO socket hibernation with tag routing |

## Testing (7)

| # | Pattern | Intent |
|---|---------|--------|
| [51](51-co-located-tests.md) | Co-Located Tests | `*.test.ts` next to implementation files |
| [52](52-property-based-testing.md) | Property-Based Testing | Fast-check fuzzing for universal invariants |
| [53](53-data-driven-tests.md) | Data-Driven Tests | `it.each` for parameterized input-output pairs |
| [54](54-contract-fixtures.md) | Contract Fixtures | `__fixtures__/` for stable protocol shape assertions |
| [55](55-mock-storage.md) | Mock Storage | In-memory DO storage for infrastructure-free tests |
| [56](56-deterministic-rng-tests.md) | Deterministic RNG in Tests | Fixed/seeded RNG for reproducible test outcomes |
| [57](57-coverage-thresholds.md) | Coverage Thresholds | Enforced coverage gates prevent backsliding |

## Validation & Error Handling (3)

| # | Pattern | Intent |
|---|---------|--------|
| [58](58-multi-stage-validation.md) | Multi-Stage Validation | Protocol -> server -> engine validation layers |
| [59](59-error-code-enum.md) | Error Code Enum | Typed error codes for structured engine errors |
| [60](60-rate-limiting.md) | Rate Limiting | Per-socket, per-room, per-endpoint throttling |

## Scenario & Configuration (3)

| # | Pattern | Intent |
|---|---------|--------|
| [61](61-scenario-rules-feature-flags.md) | Scenario Rules as Feature Flags | Toggle gameplay features via `ScenarioRules` |
| [62](62-config-driven-scenarios.md) | Config-Driven Scenarios | Declarative scenario definitions as data |
| [63](63-data-driven-maps.md) | Data-Driven Maps | Pure map construction from body/gravity/base definitions |

## Library Stance (2)

| # | Pattern | Intent |
|---|---------|--------|
| [64](64-zero-dependency-reactive.md) | Zero-Dependency Reactive | Custom 214-line signals library, no framework |
| [65](65-minimal-framework.md) | Minimal Framework | Canvas + raw DOM + factory composition, no React/Vue |
