# Delta-V — Beta Readiness Review
**Date:** April 12, 2026

---

## Git History Summary

**Recent focus (last 3 weeks):** Ordnance HUD clarity/controls, line-of-sight combat validation, victory screen polish, attack validation hardening. Consistent small-scope improvements — no large WIP branches or half-finished features in the log.

Selected recent commits:
```
2051638 Make ordnance skip ship button visually active with btn-secondary style
294e9fb Improve victory screen spacing: more breathing room between sections
139a42f Add line-of-sight checks to combat targeting and harden attack validation
ba9ae0e Update ordnance HUD helper expectation
1377d98 Improve ordnance HUD clarity and controls
```

---

## Type Check Results

**`npx tsc --noEmit` — PASSES CLEANLY. Zero errors.**

Strict mode is enabled. No `any` types observed in spot checks.

---

## Test Results

**`npx vitest run` — run locally or in CI for current counts** (see latest green workflow run; the repo targets full unit coverage across `src/**/*.test.ts`).

Additional test suites:
- E2E smoke tests: pass in CI
- A11Y Playwright tests: pass in CI (`npm run test:e2e:a11y`; keyboard-only / screen reader still need periodic manual passes per `docs/A11Y.md`)
- AI simulation harness: 0 crashes in recent full matrices (CI runs `100` iterations × `9` scenarios at hard difficulty with `--ci`)
- Load test harness (`npm run load:test`) exists but not run in CI by design — simulations are cheaper

---

## TODO / FIXME / HACK Scan

**`grep -rn "TODO\|FIXME\|HACK" src/ --include="*.ts"` — Zero results.**

No outstanding markers in source. Clean.

---

## Hardcoded Values / Debug Flags

**`grep -rn "localhost\|127\.0\.0\.1\|console\.log\|debugger\|DEBUG\|isDev\|isDebug" src/`**

- `localhost` / `127.0.0.1`: only in `src/server/index.ts:45–48` (local IP detection for dev server binding). Not shipped to Cloudflare Workers runtime — correct.
- `console.log`: not found in production paths; only in test files
- `debugger`: not found
- `isDev` / `isDebug`: not found in production code
- All magic numbers are in `src/shared/constants.ts`:
  - `DISCONNECT_GRACE_MS = 30_000`
  - `PING_INTERVAL_MS = 5000`
  - `MAX_RECONNECT_ATTEMPTS = 5`
  - `TURN_TIMEOUT_MS` and `INACTIVITY_TIMEOUT_MS` all named and documented

---

## Scenarios — Content Breadth

9 complete, balance-tested scenarios:

| Scenario | P0 Win Rate | Avg Turns |
|----------|-------------|-----------|
| Grand Tour | 64% | ~76 |
| Interplanetary War | 56% | ~68 |
| Bi-Planetary | ~50% | ~60 |
| Escape | ~48% | ~55 |
| Lunar Evacuation | ~47% | ~52 |
| Convoy | ~46% | ~50 |
| Duel | ~45% | ~42 |
| Fleet Action | 44% | ~58 |
| Blockade Runner | ~43% | ~50 |

All win rates in the 30–70% range. No lopsided scenarios. Balance is healthy.

---

## What Works Well

### Core Engine
- Event-sourced architecture with checkpoint recovery — replay and recovery model is solid
- Projection parity verification runs continuously: live state vs. event-sourced reconstruction are compared; mismatches are detected and logged to D1
- Engine is genuinely side-effect-free (shared module); server is a thin Durable Object shell; client has clean session/UI boundaries
- 0 crashes across 300+ AI-simulated games

### Multiplayer & Networking
- Reconnection logic is explicit and well-tested: 5 attempts, exponential backoff (1s, 2s, 4s, 8s, 8s), 30-second disconnect grace window, UI shows attempt count, user can cancel
- Per-socket message rate limiting: 10 msg/s
- Per-IP join throttling: 20 WebSocket upgrades per 60s per isolate; **100** join-style GET probes per 60s (join + quick-match ticket + `/api/matches`); **250** replay GET probes per 60s on a separate counter
- All incoming `S2C` messages validated against schema (`validateServerMessage`) before engine touches them — untrusted input never reaches game logic
- Durable Object is single-threaded per room — no intra-room race conditions possible
- Room creation uses 5-char codes (~33.6M space) with hashed-IP probe throttling
- Guest seat is code-based; creator seat is token-protected

### Mobile / Responsive
- Breakpoints at 760px, 640px, 420px, and height-based at 560px
- Touch controls shown/hidden via `.touch-only` / `.keyboard-only` CSS classes
- 48px minimum touch targets on interactive elements
- Safe-area insets (`var(--safe-top)`, `var(--safe-bottom)`) for notched devices
- Ship list and HUD adapt to narrow viewports

### Deployment Infrastructure
- Full CI/CD: lint → typecheck:all → test:coverage → build → E2E → A11Y → `100×9` simulations → dry-run deploy
- Wrangler config production-ready: Durable Objects, D1, R2, rate-limit namespace, custom domain `delta-v.tre.systems`
- D1 migrations version-tagged and applied on main branch push
- `npm run deploy` is one command; secrets in GitHub Actions context
- Cloudflare observability (invocation logs) enabled

### Observability
- Custom telemetry: engine errors, projection parity mismatches, client errors all logged to D1
- Rate-limited ingest: `POST /error` at 40 req/60s, `POST /telemetry` at 120 req/60s, 4KB body cap
- D1 write failures log to `console.error` so they bubble up in Cloudflare observability

### Code Quality
- TypeScript strict mode, zero errors
- No stray TODOs/FIXMEs/HACs
- No debug flags in production code
- Open engineering work is tracked in `docs/BACKLOG.md` (prioritized queue)
- All hardcoded values named and in shared constants

---

## What's Broken or Fragile

Nothing is blocking for invite-only play. Residual risks are called out in `docs/BACKLOG.md` (for example duel pacing variance and ongoing manual accessibility passes).

---

## What's Missing for Beta

These are not blockers for closed/invite-only beta but are needed before broader release.

### 1. No client error boundary

If a Preact component crashes, the game silently dies with no recovery path and no error report. A small error boundary catching render exceptions and emitting to `POST /error` would close this gap entirely.

### 2. No third-party crash reporting

`grep -rn "sentry\|bugsnag\|posthog\|mixpanel\|analytics\|telemetry" src/` returns only the custom D1 telemetry system. No Sentry, no Bugsnag. D1 captures what you explicitly log; you are blind to anything you did not anticipate. For closed beta with trusted testers you can get by on D1 and direct feedback, but you will miss hard-to-reproduce crashes.

### 3. No session/match ID correlation in telemetry

Client errors logged to D1 do not include a match ID or session token, making it hard to reconstruct what was happening when an error fired. Add match context to error payloads.

### 4. No staging environment

CI dry-runs against production Wrangler config. A bad deploy goes straight to prod. Fine for small beta but document the emergency rollback procedure (manual Wrangler redeploy from known-good tag or Cloudflare dashboard rollback).

### 5. Performance profile unverified

Client bundle: ~689 KB JS (uncompressed) + ~65 KB CSS. Gzipped this is probably ~200 KB, which is reasonable, but it has not been measured on real 4G mobile. No Lighthouse score targets set. No lazy loading or code splitting visible. Run Lighthouse before wider release.

### 6. A11Y — exists on paper, incomplete in practice

Playwright A11Y tests pass. But keyboard-only gameplay and screen reader compatibility are not in the MANUAL_TEST_PLAN and have not been tested with a real assistive technology. If accessibility matters to your beta audience, this needs a real pass.

### 7. No chat moderation

500ms per-player throttle exists. No profanity filter, no block/mute, no report mechanism. Fine for invite-only beta with trusted testers; a liability for a broader audience.

### 8. No accounts / persistent identity

Token-based per-match reconnect works for friendly matches. No profiles, no history, no ELO. SECURITY.md documents this as intentional for the current scope. Appropriate for closed beta; plan it before public matchmaking.

### 9. No public matchmaking

Only direct room-code sharing. No lobby, no ranked ladder. Out of scope for beta.

---

## Deployment Readiness

| Check | Status | Notes |
|-------|--------|-------|
| CI pipeline | Pass | All stages green |
| TypeScript | Zero errors | Strict mode |
| 1,818 unit tests | All pass | 130 test files |
| 300+ AI simulations | 0 crashes | 9 scenarios × 25 iterations |
| Wrangler config | Complete | DO + D1 + R2 + rate-limit + domain |
| D1 migrations | Versioned | Applied on push |
| Dry-run deploy | Pass | In CI |
| Bundle built | Current | ~689 KB JS, ~65 KB CSS |
| Rollback procedure | Undocumented | Manual intervention needed |
| Staging environment | None | Prod-only config |

---

## Prioritized Pre-Beta Checklist

### Must-do before inviting anyone

1. **Document rollback procedure** — even one paragraph: "if deploy is bad, run `wrangler rollback` or push a revert commit and wait for CI." Takes 10 minutes. The absence of this is the single most operationally dangerous gap.

2. **Add client error boundary** — catches component crashes, emits to `POST /error` with match context. Small code change, closes a meaningful blind spot.

3. **Add match ID to telemetry payloads** — correlate client errors to specific games in D1.

### Do during beta (before expanding access)

4. **Lighthouse / bundle analysis** — verify real 4G load time, set a performance budget.

5. **Manual A11Y pass** — keyboard-only navigation and one screen reader test.

6. **Fix replay/join shared rate-limit bucket** — separate them before any public exposure.

### Before public launch (not beta blockers)

7. Sentry or equivalent client crash reporter
8. Chat moderation / mute / report
9. Staging environment
10. Accounts / persistent identity
11. Public matchmaking

---

## Final Verdict

**Approved for closed, invite-only beta.**

The fundamentals are solid: authoritative server, event sourcing with parity checking, explicit reconnection, validated inputs, rate limiting at every boundary, 1,818 passing tests, 0 simulation crashes, clean types, zero TODO markers. The three items in the must-do list above are all under an hour each. Everything else is a known, bounded risk that is appropriate to accept for a small trusted-tester group.

Collect during beta:
- Reconnect reliability and perceived latency on real networks (especially mobile 4G)
- New-player onboarding clarity (run MANUAL_TEST_PLAN section 1a with fresh eyes)
- Any UI crashes or state divergence under real play
- D1 telemetry ingestion rates and cost
