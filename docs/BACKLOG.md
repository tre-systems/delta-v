# Delta-V Backlog

Remaining work only. Completed work belongs in git history.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

## How to read this file

Items below are ordered **top-to-bottom by current recommended execution order**. Put the most important or most blocking work near the top. Reorder freely when priorities change.

Write backlog items so an agent can make best-effort progress directly from the repo. If a task still depends on an external decision, approval, or launch condition, make the in-repo draft or implementation work explicit and note the dependency separately.

Each item should use: **Status**, **Remaining**, and, when useful, **Files**, **Trigger**, or **Depends**.

Core architecture work such as the major FSM cleanup, multi-ship E2E coverage, opponent-turn feedback, and FSM-driven UI visibility is complete. The list below starts with the highest-leverage remaining runtime and client-architecture work, then smaller correctness and hygiene tasks, then optional or trigger-based work, then ongoing discipline items.

---

### Continue best-effort DOM accessibility follow-up

**Status:** partial.

**Baseline shipped:** automated Playwright plus axe checks run in `test:e2e:a11y` and `verify`. A best-effort manual pass on **2026-04-03** tightened input naming, live-region semantics, and help-overlay dialog focus handling.

**Remaining:** rerun the checklist in [A11Y.md](./A11Y.md) after major UI changes, verify keyboard flow and DOM semantics for menus, HUD chrome, fleet builder, and chat, fix obvious issues in-repo, and record results. Treat visual contrast and real-device touch behavior as best-effort checks from the available environment, not blockers on their own.

**Files:** `docs/A11Y.md`, `static/index.html`, `static/style.css`, `src/client/ui/`, `e2e/a11y.spec.ts`

### Keep privacy disclosure and copy aligned with actual behavior

**Status:** partial.

**Baseline shipped:** a brief in-product operational disclosure now exists in the main menu clarifying anonymous diagnostics, completed-match archives, and the live-only-by-default chat posture.

**Remaining:** keep user-facing product and repo copy aligned with actual telemetry, retention, and replay behavior; draft plain-language disclosure text from [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) where needed; and avoid launch or site copy that overstates guarantees. If formal legal review is later required, treat that as an approval step on top of drafted copy, not as the backlog task itself.

**Files:** `docs/PRIVACY_TECHNICAL.md`, `README.md`, `static/index.html`, future site or launch copy

### Add global edge limits for join and replay probes if abuse warrants it

**Status:** baseline shipped.

**Baseline shipped:** shared per-isolate window per hashed IP: **100** combined `GET /join/:code` and `GET /replay/:code` per **60s**.

**Remaining:** add WAF or `[[ratelimits]]` only if distributed scans still wake durable objects or cost too much.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Prepare public matchmaking with longer room identifiers

**Status:** not started. Product-dependent.

**Remaining:** if the product moves beyond shared short codes, implement longer opaque room IDs or signed invites and update the join and share UX accordingly.

**Files:** `src/server/protocol.ts`, lobby and join UI, share-link format

### Add a trusted HTML path for any future user-controlled markup

**Status:** not started. Trigger-based.

**Remaining:** if chat, player names, or modded scenarios ever render as HTML, add a single sanitizer boundary, for example DOMPurify inside `dom.ts`, and route all user-controlled markup through it.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### Parallelize chunk reads during event stream recovery if match size grows

**Status:** not started. Optimization.

**Remaining:** `readChunkedEventStream` currently loads chunks sequentially. For long matches with many chunks, `Promise.all` would be faster. Low priority unless archive size or recovery time becomes a real problem.

**Files:** `src/server/game-do/archive-storage.ts`

**Found by:** pattern catalogue: Chunked Event Storage

### Maintain `GameState` schema version and replay compatibility discipline

**Status:** ongoing discipline. Required on schema bumps.

**Remaining:** whenever `GameState.schemaVersion` changes, document the migration path, replay compatibility, projector behavior, and any client assumptions. Extend tests around `event-projector` and recovery paths as part of the same change.

**Files:** `src/shared/types/domain.ts`, `src/shared/engine/event-projector.ts`, `docs/ARCHITECTURE.md`, relevant tests

### 60. Emit or replay turn-advance scenario-rule mutations explicitly

**Status:** not started.

**Remaining:** `advanceTurn()` applies reinforcements and fleet conversion in memory, but the event stream only records `turnAdvanced`, and the lifecycle projector only replays player rotation and damage recovery. Either emit dedicated events for reinforcement arrival and fleet conversion, or refactor the projector to share the same turn-advance mutation logic, so replay and parity remain correct once those scenario rules are used.

**Files:** `src/shared/engine/turn-advance.ts`, `src/shared/engine/engine-events.ts`, `src/shared/engine/event-projector/lifecycle.ts`, related tests
**Trigger:** any scenario enabling `scenarioRules.reinforcements` or `scenarioRules.fleetConversion`
**Found by:** pattern catalogue: Event Sourcing; Visitor Event Projection; Parity Check

