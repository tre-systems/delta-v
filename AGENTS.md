# Delta-V Coding Agent Guide

This file is for coding agents working in this repository. It is not the game
agent integration guide; that lives in [docs/AGENTS.md](./docs/AGENTS.md).

Use this as the entry point, then follow the owner docs linked below. Do not
duplicate long explanations here when a canonical doc already owns the topic.

## First Steps

- Run `git status --short --branch` before making changes. The worktree may
  contain user edits; preserve anything you did not create.
- Use `rg` / `rg --files` for codebase search.
- Read the smallest relevant owner doc before editing. If prose and code
  disagree, treat code as authoritative and update the doc in the same change.
- Keep edits scoped to the request. Avoid drive-by refactors and unrelated
  formatting churn.
- Do not commit, push, deploy, run destructive Cloudflare operations, or delete
  data unless the user explicitly asks.

## Where To Look

| Task | Read first |
| --- | --- |
| Setup, hooks, verification | [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) |
| System shape, Durable Objects, persistence | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Coding conventions and refactoring rules | [docs/CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) |
| Pattern rationale | [patterns/README.md](./patterns/README.md) |
| Game rules, scenarios, victory conditions | [docs/SPEC.md](./docs/SPEC.md) |
| HTTP, WebSocket, state contracts | [docs/PROTOCOL.md](./docs/PROTOCOL.md) |
| Built-in AI and simulation tuning | [docs/AI.md](./docs/AI.md), [docs/SIMULATION_TESTING.md](./docs/SIMULATION_TESTING.md) |
| Browser/manual/exploratory QA | [docs/MANUAL_TEST_PLAN.md](./docs/MANUAL_TEST_PLAN.md), [docs/EXPLORATORY_TESTING.md](./docs/EXPLORATORY_TESTING.md) |
| Cloudflare data, logs, telemetry, privacy | [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md), [docs/SECURITY.md](./docs/SECURITY.md) |
| External game agents and MCP | [docs/AGENTS.md](./docs/AGENTS.md), [docs/DELTA_V_MCP.md](./docs/DELTA_V_MCP.md), [AGENT_SPEC.md](./AGENT_SPEC.md) |
| Playing via MCP as a test agent | [.claude/skills/play/SKILL.md](./.claude/skills/play/SKILL.md), [docs/DELTA_V_MCP.md](./docs/DELTA_V_MCP.md) |
| Current work queue | [docs/BACKLOG.md](./docs/BACKLOG.md) |

## Project Shape

- `src/shared/` is the side-effect-free rules engine and shared data model. No
  DOM, network, storage, logging, or non-injected randomness belongs there.
- `src/server/` is the Cloudflare Worker, Durable Objects, leaderboard,
  telemetry, archive, and MCP-hosted surface.
- `src/client/` is the browser client: Canvas renderer, DOM UI, reactive state,
  audio, input, tutorial, and local AI wiring.
- `patterns/` explains why the code is shaped this way. Prefer existing
  patterns over new abstractions.

## Commands

Install with `npm install` after `nvm use`. Common checks:

```bash
npm run check:doc-links
npm run lint
npm run typecheck:all
npm test
npm run build
npm run test:e2e:smoke
npm run test:e2e:a11y
npm run simulate -- all 60 --ci
npm run verify:quick
npm run verify
```

Use the narrowest check that proves the change:

- Documentation-only: `npm run check:doc-links`. Also run an external link
  check when changing outbound URLs, and `npm run diagrams` when changing any
  `docs/diagrams/*.dot` source (commit the re-rendered PNG alongside it).
- Shared rules or AI: targeted Vitest, then relevant `npm run simulate -- ...`
  scorecards.
- UI changes: targeted Vitest where available, then Playwright or browser
  verification at desktop and mobile breakpoints.
- Protocol, archive, leaderboard, or Cloudflare data paths: unit tests plus the
  relevant manual probes from `docs/EXPLORATORY_TESTING.md`.
- Release-level confidence: `npm run verify`.

If port 8787 is already in use for Playwright, set `E2E_PORT`, for example:

```bash
E2E_PORT=8788 npm run test:e2e:smoke
```

## Coding Rules

- Keep `src/shared/` deterministic and side-effect-free. Engine randomness must
  come from injected `rng` parameters.
- Use existing factories and managers (`createXxx`) unless the platform requires
  a class. `GameDO extends DurableObject` is the main required class boundary.
- Use DOM helpers from [src/client/dom.ts](./src/client/dom.ts). Do not assign
  `innerHTML` outside that helper module; use `setTrustedHTML()` or text nodes.
- Add or update tests for behavior changes. Prefer direct unit tests for rules,
  simulation for long game behavior, and Playwright for real browser/storage/
  WebSocket behavior.
- Update canonical docs when behavior, routes, schemas, commands, or operating
  procedures change.
- Keep public protocol changes additive unless the user is explicitly doing a
  coordinated release. Follow [docs/CONTRIBUTING.md#coordinated-releases](./docs/CONTRIBUTING.md#coordinated-releases)
  for schema or protocol version changes.

## Data And Operations

- Treat production Cloudflare data as sensitive. `wrangler tail` can include
  real IPs, geolocation, and TLS metadata; summarize or sanitize output.
- Do not run D1/R2 cleanup, migrations, destructive SQL, or deploy commands
  without explicit user instruction.
- For data audits, use the query recipes in [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md)
  and [docs/EXPLORATORY_TESTING.md](./docs/EXPLORATORY_TESTING.md). Preserve
  Reyes, Kepler, and other named player history unless the user gives a clear
  cleanup rule.

## MCP Play Skill

The repo includes [.claude/skills/play/SKILL.md](./.claude/skills/play/SKILL.md)
for MCP-capable hosts that can call the Delta-V tools. Prefer the deterministic
paired-local flow in that skill when testing agent behavior; it avoids the
public quick-match queue and proves both seats can connect, observe, act, and
finish turns.

## Documentation Maintenance

- One owner doc per topic. Link instead of duplicating.
- If you add or rename Markdown docs, update [README.md](./README.md), this file
  if relevant, and `scripts/check-doc-links.mjs`.
- Keep [docs/BACKLOG.md](./docs/BACKLOG.md) limited to active or future work.
  Move shipped work into "Verified Not Active" or rely on `git log`.
