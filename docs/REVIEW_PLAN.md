# Cross-Cutting Review Plan

This document is a **sequenced checklist** for reviewing aspects of Delta-V that are not fully covered by day-to-day feature work. Work through **one section at a time**; each section lists scope, concrete steps, and what to record when done.

**Related docs:** [ARCHITECTURE.md](./ARCHITECTURE.md), [SECURITY.md](./SECURITY.md), [BACKLOG.md](./BACKLOG.md), [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md).

**How to use**

1. Pick the next numbered review (order below is **recommended**, not mandatory).
2. Complete the steps; capture findings in [ARCHITECTURE.md](./ARCHITECTURE.md), [SECURITY.md](./SECURITY.md), or other `docs/` files as appropriate, and update [BACKLOG.md](./BACKLOG.md) when new work is identified.
3. Mark the section with a date and owner in a short footer table at the bottom of this file (or in your tracker).

---

## 1. CI and local development friction

**Goal:** Reliable pre-commit and CI without skipping hooks; clear expectations for contributors.

**Scope**

- Husky pre-commit: lint, `typecheck:all`, coverage, e2e, simulation.
- Vitest coverage temp-file failures (`ENOENT` under `coverage/.tmp`).
- Playwright vs occupied `8787` during pre-commit.

**Steps**

1. Reproduce coverage failure locally (`npm run test:coverage` repeatedly; clean `coverage/` between runs).
2. Check Vitest/coverage provider version and open issues; consider `coverage.clean` or stable `reportsDirectory` options.
3. Document options: run e2e only in CI; use `reuseExistingServer`; or document “stop dev server before commit.”
4. Align [README.md](../README.md) “Quick start” / contributor note with the chosen policy.

**Deliverables**

- Short note in [CONTRIBUTING.md](./CONTRIBUTING.md) or README: **when hooks run, what to do if they fail**.
- Optional BACKLOG item if a code/config fix is needed.

---

## 2. Observability end-to-end

**Goal:** Understand what you can know in production and whether it is enough for incidents and balance.

**Scope**

- Worker / DO logs, D1 `events` schema and queries, client telemetry payload shapes.
- `anonId`, `ip_hash`, UA storage — fit to any stated privacy posture.

**Steps**

1. Read `src/server/index.ts` (`insertEvent`), `migrations/`, and client `telemetry.ts`.
2. List **event types** written today and sample queries you’d run for “error spike” or “join failures.”
3. Check Cloudflare dashboard: Workers analytics, log search, D1 usage.
4. Decide gaps: alerts, sampling, extra dimensions (room code hash only, never raw code, etc.).

**Deliverables**

- One-page **“Observability map”** ([OBSERVABILITY.md](./OBSERVABILITY.md) or adjacent `docs/` note): sources, retention, PII stance, recommended dashboards.

---

## 3. Data lifecycle and retention

**Goal:** D1 and R2 growth are bounded by policy, not accident.

**Scope**

- D1 `events` and `match_archive` tables.
- R2 `matches/{gameId}.json` objects.
- DO storage (ephemeral vs long-lived keys).

**Steps**

1. Inventory tables and R2 key patterns from `migrations/` and `match-archive.ts`.
2. Estimate growth (rows per active user per day, average match archive size).
3. Define policy: retain forever, time-based purge, or manual ops playbook.
4. If purge is needed: Workers cron, D1 `DELETE` batches, R2 lifecycle rules.

**Deliverables**

- **Retention and deletion** in [SECURITY.md](./SECURITY.md#data-retention-d1-r2-do); update if user data commitments change.

---

## 4. Accessibility (DOM surfaces)

**Goal:** Menus, HUD, fleet builder, chat, and critical flows are usable with keyboard and assistive tech where feasible.

**Scope**

- `src/client/ui/`, `dom.ts`, focusable controls; not full Canvas gameboard (note limitations).

**Steps**

1. Tab through create/join/play/game-over without a mouse.
2. Run **axe** or Lighthouse accessibility on static routes (or Playwright + axe).
3. File concrete fixes: missing `label`, `button` vs `div`, focus trap in modals, live regions for toasts if needed.

**Deliverables**

- BACKLOG tasks per major gap; optional `docs/A11Y.md` if you want a standing checklist.

---

## 5. Bundle weight and client runtime

**Goal:** Know cost of load and long sessions; avoid surprise regressions.

**Scope**

- `esbuild.client.mjs` output, main chunk size, optional breakdown.
- Long-session memory (devtools heap snapshot after many turns).

**Steps**

1. Run production build; record **main bundle KB** (gzip/brotli if available).
2. Chrome Performance: one cold load + one mid-game interaction window.
3. Compare after large renderer or dependency changes.

**Deliverables**

- Baseline numbers in [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene) (bundle table); ties to [BACKLOG.md](./BACKLOG.md) priority **11** (renderer baseline).

---

## 6. Supply chain and release hygiene

**Goal:** Predictable upgrades and vulnerability response.

**Scope**

- `package.json` / lockfile, `npm audit`, Wrangler and Node versions.

**Steps**

1. `npm audit` (document accept vs fix policy).
2. Confirm local and CI Node versions match [README.md](../README.md), [`.nvmrc`](../.nvmrc), and `.github/workflows/ci.yml`.
3. Document **D1 migration rollback** story (restore from backup vs forward-only fixes).

**Deliverables**

- Short **dependency & upgrade policy** in [CODING_STANDARDS.md](./CODING_STANDARDS.md) or [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene).

---

## 7. Protocol and client compatibility

**Goal:** Safe evolution of C2S/S2C when server and client deploy at different times.

**Scope**

- `shared/types/protocol.ts`, `shared/protocol.ts` validation, feature flags if any.

**Steps**

1. Sketch **single-version** assumption today (SPA + Workers deploy together).
2. If you ever split deploys: additive fields, `unknown` message handling, min client version header or build hash.
3. Align with `GameState.schemaVersion` playbook in [BACKLOG.md](./BACKLOG.md) priority **9**.

**Deliverables**

- If you commit to **staggered deploys**, document explicitly in [ARCHITECTURE.md](./ARCHITECTURE.md); today the doc states **same-version deploy** (coordinated Worker + SPA).

---

## 8. Replay and projection parity

**Goal:** After engine or archive changes, replay stays trustworthy.

**Scope**

- `event-projector`, `archive.ts`, `projection.ts`, existing parity tests.

**Steps**

1. Read existing tests (`game-do` parity, `event-projector` tests).
2. Define **when** to run full parity (e.g. every engine PR touching persistence, or nightly).
3. After large refactors, run simulation + targeted replay fixtures.

**Deliverables**

- Note in CODING_STANDARDS or ARCHITECTURE: **“Engine/archive changes require … tests.”**

---

## 9. Internationalization (i18n)

**Goal:** Know the cost if you localize.

**Scope**

- All user-visible strings in client UI, errors surfaced from server messages.

**Steps**

1. Grep / inventory string literals in `client/ui`, `client/game`, toast copy.
2. Decide: **explicit non-goal** vs **extract to message map** vs full i18n library later.

**Deliverables**

- [ARCHITECTURE.md](./ARCHITECTURE.md#6-current-decisions-and-planned-shifts) (i18n stance) and/or [BACKLOG.md](./BACKLOG.md): **non-goal** vs **phase 1 string extraction** when priorities change.

---

## 10. Privacy, compliance, and trust

**Goal:** Public statements match implementation (telemetry, tokens, chat).

**Scope**

- What is stored (D1, logs, R2), cookie/PWA behavior, user-generated chat text.

**Steps**

1. Cross-check implementation vs any public privacy copy (site, repo).
2. If EU or other strict regions matter: legal review of telemetry and retention.
3. Ensure [SECURITY.md](./SECURITY.md) remains the technical source of truth; add user-facing FAQ if needed.

**Deliverables**

- Privacy policy / in-app notice updates **outside** this repo as required; technical appendix can reference SECURITY.

---

## Review log

Initial documentation and tooling pass **2026-03-24**: configs fixed where safe; maps and prose docs updated; **manual** follow-ups (Lighthouse/axe tab-through, legal counsel) remain for humans.

| #   | Area                    | Reviewed (date) | Owner | Notes / link                                                                                                   |
| --- | ----------------------- | --------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| 1   | CI / local dev friction | 2026-03-24      | —     | `test:coverage` + `--no-file-parallelism`; pre-commit dynamic `E2E_PORT`; [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 2   | Observability           | 2026-03-24      | —     | [OBSERVABILITY.md](./OBSERVABILITY.md)                                                                         |
| 3   | Data lifecycle          | 2026-03-24      | —     | [SECURITY.md](./SECURITY.md#data-retention-d1-r2-do)                                                           |
| 4   | Accessibility           | 2026-03-24      | —     | [A11Y.md](./A11Y.md) — **manual audit still due**                                                              |
| 5   | Bundle / runtime        | 2026-03-24      | —     | [Bundle baseline](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene); Chrome profiling optional           |
| 6   | Supply chain / release | 2026-03-24      | —     | `npm audit` clean at review; D1 rollback in [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene) |
| 7   | Protocol compatibility | 2026-03-24      | —     | [ARCHITECTURE.md](./ARCHITECTURE.md) intro + [section 6](./ARCHITECTURE.md#6-current-decisions-and-planned-shifts) |
| 8   | Replay / parity         | 2026-03-24      | —     | [CODING_STANDARDS.md](./CODING_STANDARDS.md) Testing bullet                                                    |
| 9   | i18n                    | 2026-03-24      | —     | [English-only stance](./ARCHITECTURE.md#6-current-decisions-and-planned-shifts)                                |
| 10  | Privacy / compliance    | 2026-03-24      | —     | [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) — **legal review out of band**                                  |

---

## Suggested order (summary)

1. CI / local dev — removes daily friction.
2. Observability — informs everything operational.
3. Data lifecycle — cost and compliance foundation.
4. Accessibility — user impact and risk reduction.
5. Bundle / runtime — performance baseline.
6. Supply chain / release — security and deploy confidence.
7. Protocol compatibility — only urgent before split deploys.
8. Replay / parity — ongoing with engine changes.
9. i18n — product decision.
10. Privacy / compliance — legal calendar, can parallelize with 2–3.

Open follow-up tasks from each review area are tracked in [BACKLOG.md](./BACKLOG.md) (items marked **Human**, and the numbered list overall).

## What this review pass does *not* guarantee

- **Completeness:** The backlog captures major, agreed themes — not every possible bug, edge case, or future product idea.
- **Permanent factual truth:** Numbers in [ARCHITECTURE.md](./ARCHITECTURE.md) (bundle table, Node version) and similar are **baselines**; they go stale until someone updates them after meaningful changes.
- **Legal or compliance sign-off:** Technical docs (including [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md)) are not policies; counsel and public notices stay outside this repo unless you add them.
- **Manual QA:** DOM accessibility and keyboard flows still need a human pass per [A11Y.md](./A11Y.md) and [BACKLOG.md](./BACKLOG.md).

When behavior or ops reality changes, update the relevant `docs/` file in the same PR as the code when practical.

A link to this file is in [README.md](../README.md) under the documentation guide.
