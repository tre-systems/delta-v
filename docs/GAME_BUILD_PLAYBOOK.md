# Game Build Playbook (Domain and Events First)

This is a practical, end-to-end guide for building a turn-based multiplayer game with the same strengths as Delta-V:

- Domain-first type system
- Event-first architecture (replayable and auditable)
- Deterministic simulation
- Strong testing and release gates

Use this as your startup checklist for a new project.

This file is intentionally generic. For the live Delta-V codebase, treat [README.md](../README.md), [SPEC.md](./SPEC.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [BACKLOG.md](./BACKLOG.md) as the current source of truth.

---

## Quick reference checklist

- [ ] Product brief written; turn loop explainable in 60 seconds
- [ ] Domain types: no `any`, every action is a typed union member
- [ ] Engine is pure: no network, DOM, or clock calls; all randomness via injected PRNG
- [ ] Event projector: live state == projected state from events
- [ ] Protocol types are versioned and runtime-validated
- [ ] Server delegates all rule evaluation to shared engine
- [ ] Engine error/recovery strategy decided and documented
- [ ] Reconnect/stale-tab behavior deterministic and tested
- [ ] `npm run verify` pipeline passes (unit, property, parity, E2E, a11y)
- [ ] Simulation runs are evidence-based; pinned regression seed set exists
- [ ] Observability, rate limits, and telemetry active before launch

---

## 0) Outcome and constraints first (before coding)

Define these in writing, in one page:

- Core fantasy: what players do and why it is fun.
- Match shape: 1v1, team, co-op, solo, async or live.
- Session length target: median and max acceptable.
- Rules fidelity target: strict adaptation vs game-inspired.
- Platform constraints: browser only, mobile, offline, PWA.
- Non-goals: what is explicitly out of scope in v1.

Deliverable:

- `docs/PRODUCT_BRIEF.md` (one page).

Exit criteria:

- You can explain a full turn loop in 60 seconds.

---

## 1) Model the domain in TypeScript before engine code

Design types to express meaning and invalid states as much as possible.

### 1.1 Core nouns and identifiers

Define branded IDs so you cannot mix entities by accident:

- `MatchId`, `PlayerId`, `ActorId`, `TeamId`, `WeaponId`, `EffectId`

Use branded primitives:

- `type ActorId = string & { readonly __brand: 'ActorId' }`

### 1.2 Domain state and value objects

Create immutable or readonly-first state types:

- `MatchState`
- `PlayerState`
- `ActorState` (stats, wounds, morale, inventory, position)
- `RoundState` / `PhaseState`
- `ScenarioState`

Use explicit value objects:

- `HitPoints`, `ActionPoints`, `Initiative`, `RangeBands`, `CoverLevel`

### 1.3 Action and event unions

Use discriminated unions with `kind`:

- `PlayerAction` (input intent)
- `EngineEvent` (facts that happened)
- `SystemEvent` (timeout, disconnect, reconnect, rematch)

Never use untyped string payloads for actions/events.

### 1.4 Phase-legal action gating

Model phase-specific legality in types and validators:

- Planning phase accepts movement/stance actions.
- Attack phase accepts attack and reaction actions.
- End phase accepts cleanup only.

Do both:

- Static type narrowing where possible.
- Runtime guard for untrusted network input.

Deliverables:

- `src/shared/types/domain.ts`
- `src/shared/types/actions.ts`
- `src/shared/types/events.ts`
- `src/shared/types/phase.ts`

Exit criteria:

- No `any` in domain types.
- Every user action is represented as a typed union member.

---

## 2) Define rules as pure functions

Design the engine as pure deterministic transforms.

Recommended core API:

- `createInitialState(seed, scenarioConfig): MatchState`
- `validateAction(state, playerId, action): ValidationResult`
- `applyAction(state, playerId, action, rng): { state, events }`
- `advancePhase(state, rng): { state, events }`
- `checkVictory(state): VictoryResult | null`
- `projectPlayerView(state, playerId): PlayerView`

Rules:

- No network, DOM, storage, or clock calls in engine layer.
- All randomness via injected seeded PRNG.
- `validateAction` must be side-effect-free and must never consume RNG state — consuming RNG in validation is a subtle source of divergence bugs.
- State transitions emit events; UI does not invent outcomes.
- AI opponents consume the same `validateAction` / `applyAction` API as human players — no separate rule path.

Deliverables:

- `src/shared/engine/*`
- `src/shared/prng.ts`

Exit criteria:

- Same seed + same actions always produce same events and state.

---

## 3) Event-first architecture from day one

Treat events as source of truth, not optional logs.

### 3.1 Event schema discipline

Each event should include:

- `kind`
- `matchId`
- `turn` / `phase`
- Actor IDs involved
- Rule-relevant numbers (damage, modifiers, roll totals)
- Optional `causationId` / `correlationId`
- Timestamp only at boundary layers if needed

### 3.2 Event projector

Build an event projector that reconstructs match state:

- `project(initialState, events[]): MatchState`

Use this for:

- Replay
- Recovery
- Parity testing
- Debugging

### 3.3 Event compatibility

Version event schema deliberately:

- Additive changes preferred.
- Avoid mutating meaning of existing fields.
- Add migration strategy for major breaks.

Deliverables:

- `src/shared/engine/event-projector.ts`
- `src/shared/types/events.ts` with version notes
- `docs/EVENT_MODEL.md`

Exit criteria:

- Live state and projected state parity tests pass.

---

## 4) Protocol contract (client/server boundary)

Define protocol after domain/events, not before.

Protocol shape should carry:

- Commands from client (intent)
- State updates from server (authoritative state/view)
- Event bundles (optional but highly useful for logs and replay UX)
- Session lifecycle messages (welcome, reconnect, spectator, game over)

Rules:

- Runtime validate all inbound messages.
- Reject unknown/invalid payloads safely.
- Keep protocol types in shared package.
- Version protocol schema deliberately, independently of event schema — the two can drift if not tracked together.

Deliverables:

- `src/shared/types/protocol.ts`
- `src/shared/protocol.ts` (validation/parser)
- protocol fixtures in tests

Exit criteria:

- Protocol fixtures are versioned and tested.
- Breaking protocol changes increment a version field; old clients receive a clear rejection, not silent corruption.

---

## 5) Server runtime and room orchestration

Keep server responsibilities narrow:

- Session/auth token handling
- Room/match ownership
- Turn timers and disconnect grace
- Persistence/replay storage
- Broadcast projected views per player role

Do not duplicate game rules on server orchestration layer. The server calls into `src/shared/engine` for all rule evaluation — it does not reimplement checks.

Recommended boundaries:

- Transport layer (`/create`, `/join`, websocket, replay endpoints)
- Match runtime (owns authoritative state and applies actions)
- Persistence adapter (DB/object storage)
- Telemetry adapter

Deliverables:

- `src/server/index.ts`
- `src/server/game-do/*` (or equivalent room runtime)

### 5.1 Engine error handling

Decide before shipping what the server does when `applyAction` throws:

- **Abort match** — safest; guaranteed consistent state but terminates the session.
- **Skip action, emit error event** — match continues; requires AI/client to handle no-op turns gracefully.
- **Roll back to last snapshot** — most complex; requires periodic snapshotting with copy-on-write or immutable state.

Document the chosen strategy in `docs/ARCHITECTURE.md`. Whichever you pick, never silently swallow the error — always emit a telemetry event and log context.

Exit criteria:

- Reconnect and stale-tab behavior are deterministic and tested.
- Engine error handling strategy is documented and tested.

---

## 6) Client architecture: rendering is a projection, not authority

Client should:

- Send typed intents.
- Render server-authoritative projected view.
- Maintain local UI-only state (selection, panel visibility, hover).

Do not allow client-only rule outcomes.

Good separation:

- `client/game/`: session, networking, message handling
- `client/ui/`: DOM controls and accessibility surfaces
- `client/renderer/`: canvas visuals and effects

Deliverables:

- Minimal vertical slice UI (one scenario, one full turn loop)

Exit criteria:

- Refresh/reconnect does not desync outcome state.

---

## 7) Persistence, replay, and recovery

Persist enough to rebuild and inspect matches:

- Snapshot strategy: periodic or phase-based
- Event stream append
- Archive format for completed matches

Replay should support:

- Turn/phase stepping
- Event list inspection
- End-state verification

Deliverables:

- `docs/REPLAY_MODEL.md`
- replay endpoint and UI controls

Exit criteria:

- Archived match can be replayed to same final state.

---

## 8) Testing strategy (in this order)

### 8.1 Type and rule unit tests

- Every major rule path and edge case.
- Invalid action rejection tests.

### 8.2 Parity tests

- Runtime state == projector(state from events).
- These are cheap to write and catch a broad class of bugs early — run these before investing in property-based fuzzing.

### 8.3 Property-based tests

- Invariants (no negative HP, no illegal phase transitions, etc.).
- Fuzz action sequences within legal action space.

### 8.4 E2E smoke tests

- Boot, create/join, one full turn, reconnect, game over.

### 8.5 Accessibility checks

- Automated axe baseline.
- Manual keyboard/focus pass for DOM surfaces.

### 8.6 Simulation tests

- Bulk AI-vs-AI runs.
- Crash detection.
- Outcome distribution and timeout signals.

Deliverables:

- `npm run verify` equivalent that runs all gates.

Exit criteria:

- All gates pass locally and in CI.

---

## 9) Observability, security, and abuse controls

Ship with minimum operational clarity:

- Structured telemetry event types
- Error endpoint with bounded payload size
- Basic per-IP and per-route limits
- Saved queries for key failures (join fail, projection mismatch, engine error)

Security baseline:

- Input validation on all boundaries
- Rate limiting for create/join/replay probes
- Privacy minimization (hash where possible, avoid raw PII)

Deliverables:

- `docs/OBSERVABILITY.md`
- `docs/SECURITY.md`
- `docs/PRIVACY_TECHNICAL.md`

Exit criteria:

- You can answer "what failed?" within minutes during incident triage.

---

## 10) Content and balance workflow

Separate content data from engine logic:

- Scenario configs in data files
- Rule toggles in scenario flags
- AI heuristics configurable per scenario

Balance loop:

1. Hypothesis (what should improve)
2. Simulate at scale
3. Review distribution and timeout rates
4. Apply targeted changes
5. Re-run with same pinned seed suite

Maintain a pinned regression seed set: a small collection of seeds that previously exposed crashes or degenerate outcomes. Grow it over time. Re-running the same seeds after rule changes catches regressions that random sampling may miss.

Deliverables:

- `docs/SIMULATION_TESTING.md`
- AI/balance scripts and reports

Exit criteria:

- Balance changes are evidence-driven, not anecdotal.

---

## 11) Release hygiene and quality bar

Before each release candidate:

- Run full verify pipeline.
- Run manual experience pass from test plan.
- Re-baseline bundle/runtime metrics after large renderer changes.
- Confirm replay compatibility if schema or event changes occurred.

Deliverables:

- `docs/MANUAL_TEST_PLAN.md`
- `docs/REVIEW_PLAN.md`
- `docs/BACKLOG.md` kept current

Exit criteria:

- No "known unknown" gaps hidden outside backlog/docs.

---

## 12) Suggested repository starter structure

```text
src/
  shared/
    types/
      domain.ts
      actions.ts
      events.ts
      protocol.ts
      phase.ts
    engine/
      index.ts
      rules/
      event-projector.ts
    prng.ts
  server/
    index.ts
    room-runtime/
    protocol/
    persistence/
  client/
    game/
    ui/
    renderer/
docs/
  PRODUCT_BRIEF.md
  ARCHITECTURE.md         ← engine error strategy, key design decisions
  EVENT_MODEL.md
  SIMULATION_TESTING.md
  OBSERVABILITY.md
  SECURITY.md
  PRIVACY_TECHNICAL.md
  MANUAL_TEST_PLAN.md
  REVIEW_PLAN.md
  BACKLOG.md
```

---

## 13) Implementation milestones (suggested order)

### Milestone 1: Domain and engine skeleton

- Finalize domain/action/event types.
- Implement core phase loop and two key actions.
- Add deterministic PRNG and initial rule tests.

### Milestone 2: Vertical slice

- Server room runtime + websocket flow.
- Minimal client to play one complete match path.
- Replay/event log basic plumbing.

### Milestone 3: Reliability and observability

- Reconnect/disconnect handling.
- Telemetry/error events and basic dashboards.
- E2E smoke + accessibility baseline.

### Milestone 4: Balance and polish

- AI baseline and simulation runs.
- Scenario expansion.
- Manual test pass and release checklist.

---

## 14) Decision checklist before adding complexity

Ask these before introducing new mechanics:

- Does it belong in domain state, event stream, or UI-only state?
- Can it be represented as a typed action and typed event?
- Is it deterministic under seeded simulation?
- Can replay/projector reproduce it exactly?
- Do tests cover both legal and illegal paths?

If any answer is "no", pause and fix architecture first.

---

## 15) Anti-patterns to avoid

- Building UI flow before domain model is stable.
- Encoding rules in client view code.
- Mutating state without emitting events.
- Using untyped JSON blobs for protocol/actions/events.
- Deferring replay until late project phases.
- Relying only on manual playtests for balance.

---

## 16) Minimum launch criteria

Do not launch publicly until all are true:

- Domain, action, event, and protocol unions are versioned and validated.
- Deterministic engine tests pass.
- Replay parity tests pass.
- E2E smoke and a11y baseline pass.
- Rate limits and telemetry are active.
- Manual test plan was executed and findings are logged in backlog.

---

## 17) How to use this document for your next project

1. Copy this playbook into the new repo.
2. Create the listed docs as empty shells on day 1.
3. Implement sections 1-4 before investing in rich UI.
4. Keep `BACKLOG.md` strict: status, remaining work, evidence, owner.
5. Re-run review cadence after each major architecture or rules shift.

If you stay disciplined on domain types and events early, almost every later decision gets cheaper and safer.
