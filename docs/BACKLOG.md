# Delta-V Backlog

Remaining work only. Completed items are in git history.

**How this list is ordered**

1. **Gameplay & content** — Roughly **dependency order**: passenger rescue before scenario expansion that relies on it; spectator mode is an independent product track alongside those.
2. **Security & abuse hardening** — Nothing here is required for private friend matches. Sequence is **cost/defense first** (telemetry and probing), then **bot abuse**, then **product-shaped** changes (longer room IDs).
3. **Platform & maintainability** — Hygiene and observability that reduce future drift or bad optimizations; pick by team capacity.
4. **Reviews & compliance (human)** — Checklists and policy work that **you** (or counsel) must execute; tools and ADRs from the 2026 review plan do not replace these.

---

## Gameplay & content

### Passenger rescue mechanics

Add passenger-specific transfer / rescue rules for
rescue scenarios.

Fuel and cargo transfer are already implemented; the
remaining work is passenger state, rescue objectives,
and the related UI / log presentation.

**Depends on:** nothing below (foundational for some future scenarios).

**Files:** `src/shared/engine/logistics.ts`,
`src/shared/engine/victory.ts`, `src/shared/types/`,
`src/client/game/logistics-ui.ts`,
`src/client/ui/game-log-view.ts`

### Spectator mode — client UI and live stream

Server-side spectator transport is complete: viewer-
aware filtering, spectator replay delivery, spectator-
tagged broadcasts, and WebSocket boundary enforcement
are all wired and tested. Live spectator WebSocket
joins are explicitly rejected (501) for now.

Remaining work is client-side: a spectator join flow,
real-time spectator state display during live games,
and the protocol extension to accept live spectator
WebSocket connections.

**Depends on:** nothing in this section (can ship in parallel with passenger work).

**Files:** `src/server/game-do/game-do.ts`,
`src/server/protocol.ts`,
`src/client/game/client-kernel.ts`, client spectator UI

### Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present
yet: concealment / dummy counters, passenger rescue,
fleet mutiny triggers, and more advanced reinforcement
waves.

**Depends on:** passenger rescue and other mechanics above (do not start as a thin reskin).

**Files:** `src/shared/map-data.ts`,
`src/shared/engine/`, client scenario presentation

---

## Security & abuse hardening

These items complement [SECURITY.md](./SECURITY.md). None of them block the current friendly-match product model; prioritize if traffic is public, adversarial, or unexpectedly expensive.

### Rate-limit reporting endpoints (`/telemetry`, `/error`)

`POST /telemetry` and `POST /error` accept small JSON bodies (4KB cap) and write to D1 via `waitUntil`, but there is **no application-level per-IP rate limit**. A distributed client could inflate D1 rows and Worker CPU.

**Why first in this section:** clearest unbounded cost vector with no product UX change.

**Mitigations (pick one or combine):** Cloudflare WAF or rate-limiting rules on those paths; a Workers rate-limit binding keyed on hashed IP (same pattern as `CREATE_RATE_LIMITER`); or sampling / caps in `src/server/index.ts` before `insertEvent`.

**Files:** `src/server/index.ts`, `wrangler.toml`, Cloudflare dashboard

### Optional throttle on `GET /join/:code` and `GET /replay/:code`

Unauthenticated HTTP probes can wake DOs and run replay projection without joining. Add edge or app limits if metrics show abuse or material cost.

**Why next:** cheap defensive layer if scans appear; still no player-visible feature work.

**Files:** `src/server/index.ts`, optional `[[ratelimits]]` or WAF rules

### Optional Turnstile on `POST /create`

Bot-driven room creation can spin many Durable Objects and archive writes. Turnstile validation on `/create` is described in [SECURITY.md](./SECURITY.md).

**Why after HTTP probes:** needs UI + server verification; address when automated create spam is observed.

**Files:** client create-game UI, `src/server/index.ts` (`handleCreate`), Turnstile siteverify call

### Public matchmaking prep (longer room identifiers)

If the product moves beyond shared short codes, implement longer opaque IDs or signed invites (see [SECURITY.md](./SECURITY.md) competitive risks).

**Why last here:** largest product and protocol surface change in this group.

**Files:** `src/server/protocol.ts`, client lobby/join UX, any link/share format

---

## Platform & maintainability

### Architecture decision records (ADRs)

Cross-cutting choices (protocol shapes, auth model,
replay policy) have historically drifted across prose
docs. **Started:** [docs/decisions/README.md](./decisions/README.md)
indexes ADRs 0001–0004 (retention, deploy/protocol, bundle/supply chain, i18n scope).
Add new numbered ADRs when a decision is likely to be revisited.

**Files:** `docs/decisions/`, links from [ARCHITECTURE.md](./ARCHITECTURE.md)

### `GameState` schema version and replay compatibility

`GameState` carries `schemaVersion`. When bumping it,
document the migration path: projector behavior,
replay of older archived matches, and any client
assumptions. Add or extend tests around
`event-projector` and recovery paths when versions
change.

**Files:** `src/shared/types/domain.ts`,
`src/shared/engine/event-projector.ts`,
`docs/ARCHITECTURE.md` or ADR, relevant tests

### Renderer performance baseline before major Canvas work

Capture measured frame cost (Chrome Performance or
equivalent, optional per-frame timing hooks) before
large renderer refactors or layer caching. Drive
optimization from data, not guesswork (see
[ARCHITECTURE.md](./ARCHITECTURE.md) “Next improvements”).

**Files:** `src/client/renderer/renderer.ts`, profiling notes in `docs/` or ADR

### Trusted HTML path for user-controlled content (when needed)

Today markup is internal/trusted. If chat, player names,
or modded scenarios ever render as HTML, add a single
sanitizer boundary (e.g. DOMPurify inside `dom.ts`) per
[SECURITY.md](./SECURITY.md) and [CODING_STANDARDS.md](./CODING_STANDARDS.md).

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

---

## Reviews & compliance (human)

These are **not** automated in CI. The [REVIEW_PLAN.md](./REVIEW_PLAN.md) log marks which areas had a first documentation pass; the tasks below are the **remaining actions**.

### Run DOM accessibility audit

Execute [A11Y.md](./A11Y.md): Lighthouse (or axe) on the SPA shell, manual **keyboard-only** pass through create/join/play/game-over for **DOM** controls (menus, HUD chrome, fleet builder, chat input). The Canvas board remains pointer-first unless product mandates otherwise.

**Owner:** maintainer / QA. **Deliverable:** fix obvious issues or file scoped tasks; update A11Y checklist with dates.

### Legal and user-facing privacy (if applicable)

[PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) describes what the code stores; it is **not** a privacy policy. Before broad public launch or regulated regions, have **legal review** and publish whatever notices or consents are required. Align marketing/site copy with telemetry and retention ([ADR 0001](./decisions/0001-data-retention.md)).

**Owner:** you + counsel.

### Observability dashboards and alerts

[OBSERVABILITY.md](./OBSERVABILITY.md) maps data sources but does not configure Cloudflare. Optionally add: saved D1 queries, Workers log filters, or alerts on spikes in `client_error`, `engine_error`, or `projection_parity_mismatch`.

**Owner:** you / ops.

### Re-baseline client bundle size

After large renderer or dependency changes, re-measure `dist/client.js` (raw + gzip) and update [ADR 0003](./decisions/0003-bundle-and-supply-chain-baseline.md) or append a dated row.

**Owner:** whoever ships the change.

### Windows-friendly pre-commit (if needed)

Husky uses POSIX `E2E_PORT=8788` before e2e. If **Windows CMD** users cannot commit, add `cross-env` or document **Git Bash / WSL** in [CONTRIBUTING.md](./CONTRIBUTING.md).

**Owner:** you when the first report lands.

---
