# Cross-Cutting Review Plan

A **recurring checklist** for reviewing aspects of Delta-V not covered by day-to-day feature work. Concrete follow-up work belongs in [BACKLOG.md](./BACKLOG.md).

**How to use:** pick a section, run the steps, update the [review log](#review-log) with date and status (**pass**, **fail — [BACKLOG item]**, or **partial**).

**When to run:** after major architecture/protocol/deployment changes, before release candidates, or on a periodic cadence (monthly/quarterly).

**Parallel execution:** all sections are independent and self-contained. They can be run concurrently by separate agents — no ordering dependencies between them.

**Human-only items** are marked with a `[Human]` tag. Everything else is agent-executable.

**Related docs:** [ARCHITECTURE.md](./ARCHITECTURE.md), [SECURITY.md](./SECURITY.md), [BACKLOG.md](./BACKLOG.md), [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md).

---

## 1. CI and local development friction

**Goal:** pre-commit and CI run cleanly; no hooks need skipping.

**Key files:** `.husky/pre-commit`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, [CONTRIBUTING.md](./CONTRIBUTING.md), [README.md](../README.md).

**Steps**

1. Run `npm run verify` end-to-end. **Pass:** exits 0. **Fail:** file a BACKLOG item with the failing step and error.
2. Run `npm run test:coverage` three times in a row. **Pass:** no `ENOENT` or stale-merge failures. **Fail:** check Vitest/coverage provider versions for known issues; consider `coverage.clean` or stable `reportsDirectory`.
3. Run pre-commit with a dev server on port 8787. **Pass:** e2e uses dynamic port, no conflict. **Fail:** check `DELTAV_PRE_COMMIT_E2E` dynamic port logic in `.husky/pre-commit`.
4. Check that [CONTRIBUTING.md](./CONTRIBUTING.md) documents: what the pre-commit hook runs, what to do when it fails, and the `npm run verify` command. **Pass:** all three are covered. **Fail:** update the doc.

---

## 2. Observability, data lifecycle, and privacy

**Goal:** know what is stored, how long it lives, and whether implementation matches docs.

**Key files:** `src/server/reporting.ts` (`insertEvent`), `migrations/`, `src/client/telemetry.ts`, `src/server/game-do/match-archive.ts`, [OBSERVABILITY.md](./OBSERVABILITY.md), [SECURITY.md](./SECURITY.md), [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md).

**Scope:** D1 (`events`, `match_archive`), R2 (`matches/{gameId}.json`), DO ephemeral storage, client telemetry, `anonId`/`ip_hash`/UA, chat text.

**Steps**

1. Read `insertEvent` in `src/server/reporting.ts` and `migrations/`; list every event type written to D1. Cross-check against [OBSERVABILITY.md](./OBSERVABILITY.md). **Pass:** doc lists all event types. **Fail:** update the doc.
2. Read `telemetry.ts`; list every client telemetry payload shape. Cross-check against [OBSERVABILITY.md](./OBSERVABILITY.md). **Pass:** doc lists all payloads. **Fail:** update the doc.
3. Read `match-archive.ts`; confirm R2 key pattern and what data is stored. Cross-check against [SECURITY.md](./SECURITY.md#data-retention-d1-r2-do). **Pass:** retention policy matches implementation. **Fail:** update the doc or file BACKLOG item.
4. Grep for `anonId`, `ip_hash`, `ua`, `user-agent`, and `chat` across `src/`; list where PII or user-generated content is persisted. Cross-check against [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md). **Pass:** no undocumented PII storage. **Fail:** update the doc.

---

## 3. Security posture

**Goal:** rate limiting, input validation, and trust boundaries match what [SECURITY.md](./SECURITY.md) claims.

**Key files:** `src/server/index.ts`, `src/server/game-do/socket.ts`, `src/server/game-do/actions.ts`, `src/server/reporting.ts`, `src/shared/protocol.ts`, `src/client/dom.ts`, [SECURITY.md](./SECURITY.md).

**Steps**

1. Read rate-limit constants in `socket.ts` (`WS_MSG_RATE_LIMIT`, `CHAT_RATE_LIMIT_MS`) and `src/server/reporting.ts` (`CREATE_RATE_LIMIT`, `JOIN_REPLAY_PROBE_LIMIT`, `WS_CONNECT_LIMIT`, `TELEMETRY_RATE_LIMIT`, `ERROR_REPORT_RATE_LIMIT`). Cross-check values against [SECURITY.md](./SECURITY.md). **Pass:** all values match. **Fail:** update the doc or the code.
2. Read `validateClientMessage()` in `src/shared/protocol.ts`. Confirm every C2S message type has validation. **Pass:** no unvalidated message types. **Fail:** add validation or file BACKLOG item.
3. Grep for `innerHTML` usage outside `src/client/dom.ts`. **Pass:** zero hits (pre-commit hook also checks this). **Fail:** move to `setTrustedHTML()`.
4. Grep for `Math.random` in `src/shared/engine/`, excluding tests and injected default RNG fallbacks (`= Math.random`) to match the pre-commit boundary. **Pass:** no remaining hits. **Fail:** replace with injected RNG or narrow the exception intentionally.
5. Read `src/shared/protocol.ts` input-limit constants (`MAX_FLEET_PURCHASES`, `MAX_ASTROGATION_ORDERS`, `MAX_ORDNANCE_LAUNCHES`, `MAX_COMBAT_ATTACKS`). Confirm they are enforced in runtime message validation before engine dispatch (`validateClientMessage()` / DO socket path). **Pass:** all limits are checked before any engine handler runs. **Fail:** add the missing validation or file BACKLOG item.
6. Check room code generation in `src/server/` — confirm it uses crypto RNG, not `Math.random()`. **Pass:** uses `crypto.getRandomValues` or equivalent. **Fail:** fix.

---

## 4. Game engine correctness

**Goal:** engine rules match the spec; simulation doesn't surface logic errors.

**Key files:** `src/shared/engine/` (all files), `src/shared/types/domain.ts`, [SPEC.md](./SPEC.md), [SIMULATION_TESTING.md](./SIMULATION_TESTING.md).

**Steps**

1. Run `npm run simulate all 100 -- --ci`. **Pass:** exits 0, no engine errors in output. **Fail:** investigate error details, file BACKLOG item.
2. Read the current rule-owning engine modules (`astrogation.ts`, `combat.ts`, `logistics.ts`, `ordnance.ts`, `resolve-movement.ts`, `post-movement.ts`, `turn-advance.ts`, `victory.ts`; include `fleet-building.ts` / `game-creation.ts` when scenario setup rules changed). Cross-check phase transitions, post-movement resolution, and victory logic against [SPEC.md](./SPEC.md). **Pass:** no contradictions. **Fail:** file BACKLOG item noting spec vs implementation discrepancy.
3. Run `npm run test:coverage`. Check coverage for executable `src/shared/engine/` modules (ignore type-only / re-export shims such as `engine-events.ts` and `event-projector.ts`). **Pass:** no executable engine module below 80% line coverage. **Fail:** identify untested branches, file BACKLOG item.

---

## 5. Error handling and resilience

**Goal:** disconnects, DO alarm failures, and D1/R2 errors don't crash games or lose state.

**Key files:** `src/server/game-do/ws.ts`, `src/server/game-do/socket.ts`, `src/server/game-do/alarm.ts`, `src/server/game-do/turn-timeout.ts`, `src/server/game-do/match-archive.ts`.

**Steps**

1. Read `alarm.ts` and `turn-timeout.ts`. Confirm every alarm handler has try-catch and reschedules on error rather than crashing. **Pass:** all paths wrapped. **Fail:** add error handling.
2. Read `match-archive.ts`. Confirm R2 put/get and D1 insert failures are caught and don't block gameplay. **Pass:** fire-and-forget with logging. **Fail:** add error handling.
3. Read `ws.ts` and `socket.ts`. Confirm: invalid JSON is caught, rate-limited sockets are closed cleanly (code 1008), unhandled message errors return typed errors to the client. **Pass:** all three hold. **Fail:** add handling.
4. Read disconnect/reconnect logic (`handleGameDoWebSocketClose`, grace period). Confirm a disconnected player can rejoin within the grace window and resume. **Pass:** state is preserved and resent. **Fail:** file BACKLOG item.
5. Run `npm run test -- src/server/game-do --reporter=verbose`. **Pass:** all pass. **Fail:** investigate.

---

## 6. Bundle weight and client runtime

**Goal:** know cost of load; avoid surprise regressions.

**Key files:** `esbuild.client.mjs`, `dist/client.js` (build output), [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene).

**Steps**

1. Run `npm run build`. Record `dist/client.js` size: `ls -la dist/client.js` and `gzip -c dist/client.js | wc -c`. **Pass:** gzip size within 20% of baseline in [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene). **Fail:** investigate new dependencies or dead code; file BACKLOG item.
2. Check for obvious runtime package imports: `rg -n "^import .* from '[^./]" src/client --glob '!**/*.test.ts'` and compare any bare-package hits against `package.json` / lockfile changes since the last review. **Pass:** no unexpected new runtime dependencies in the client bundle path. **Fail:** evaluate if the dependency is justified.

**`[Human]`** Chrome DevTools heap snapshot after 20+ turns — check for unbounded growth. This requires a running game in a browser.

---

## 7. Supply chain and release hygiene

**Goal:** predictable upgrades and vulnerability response.

**Key files:** `package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/ci.yml`.

**Steps**

1. Run `npm audit`. **Pass:** no high/critical vulnerabilities. **Fail:** fix or document accepted risk in BACKLOG.
2. Compare Node version across `.nvmrc`, `package.json` engines (if set), and `.github/workflows/ci.yml`. **Pass:** all match. **Fail:** align them.
3. Run `npm outdated`. Flag any dependencies more than 2 major versions behind. **Pass:** nothing critically outdated. **Fail:** file BACKLOG item for upgrade.

---

## Review log

| #   | Area                        | Reviewed   | Status             | Notes                                                                                            |
| --- | --------------------------- | ---------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | CI / local dev friction     | 2026-04-04 | pass               | `npm run verify` exits 0; pre-commit dynamic port logic confirmed; CONTRIBUTING.md updated to document grep-based boundary checks |
| 2   | Observability / data / privacy | 2026-04-04 | pass            | docs synced to current D1 event names, payload shapes, retention notes, and sample queries        |
| 3   | Security posture            | 2026-04-04 | pass               | all 6 checks pass: rate limits match docs, validation exhaustive, no innerHTML/Math.random leaks, crypto RNG for room codes |
| 4   | Game engine correctness     | 2026-04-04 | pass               | `simulate all 100 --ci` 0 crashes; spec cross-check clean; `combat.ts` 94.01%, `conflict.ts` 91.76% — both above 80% |
| 5   | Error handling / resilience | 2026-04-04 | pass               | `game-do` 134 tests pass; `runGameDoAlarm` now has top-level try-catch with reschedule; 5 error-handling tests added |
| 6   | Bundle / runtime            | 2026-04-04 | partial            | `dist/client.js` 655337 bytes raw / 135583 bytes gzip (~132 KB, within baseline); runtime heap profiling remains `[Human]` |
| 7   | Supply chain / release      | 2026-04-04 | pass               | `npm audit` 0 vulnerabilities; `npm outdated` no packages 2+ major versions behind; Node 25 consistent across `.nvmrc` and CI |

**Decisions already recorded elsewhere (no recurring review needed):**
- **i18n:** English-only — [ARCHITECTURE.md](./ARCHITECTURE.md#6-current-decisions-and-planned-shifts).
- **Protocol compatibility:** same-version deploy — [ARCHITECTURE.md](./ARCHITECTURE.md) sections 1 + 6.
- **Replay/parity:** covered by coding standard — [CODING_STANDARDS.md](./CODING_STANDARDS.md).
- **Accessibility:** `[Human]` — manual keyboard/screen-reader audit per [A11Y.md](./A11Y.md); automated checks via `npm run test:e2e:a11y`.

---

## Caveats

- Numbers in docs (bundle size, Node version) are baselines that go stale — update them alongside meaningful changes.
- Technical docs are not legal or compliance sign-off; counsel and public notices stay outside this repo.
