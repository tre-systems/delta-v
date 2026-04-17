# Contributing

Contributor workflow only. See [README.md](../README.md) for onboarding, [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, and [CODING_STANDARDS.md](./CODING_STANDARDS.md) for conventions.

## Pre-commit (Husky)

[`.husky/pre-commit`](../.husky/pre-commit) runs, in order:

1. `npm run lint`
2. Grep-based boundary checks (fail the commit if any match):
   - `innerHTML` assignment outside `src/client/dom.ts` (use `setTrustedHTML()`)
   - `Math.random` in `src/shared/engine/` (use injected RNG)
   - `console.log/warn/error` in `src/shared/` (shared layer must be side-effect free)
3. `npm run typecheck:all`
4. `npx wrangler d1 migrations apply delta-v-telemetry --local`
5. Fresh `coverage/` directory, then `npm run test:coverage`
6. `DELTAV_PRE_COMMIT_E2E=1 npm run test:e2e` (Playwright browser smoke)
7. `DELTAV_PRE_COMMIT_E2E=1 npm run test:e2e:a11y` (Playwright + axe baseline)
8. `npm run simulate all 60 -- --ci` (headless AI sweep across all 9 scenarios)

CI runs the same list except for local D1 setup — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### Coverage

`test:coverage` uses `--no-file-parallelism` so Vitest's v8 merger does not race on `coverage/.tmp/*.json`. If coverage fails unexpectedly, remove `coverage/` and retry.

Both `npm test` and `npm run test:coverage` set `NODE_OPTIONS=--localstorage-file=/tmp/deltav-vitest-localstorage` to silence Node 25+ experimental web-storage warnings.

### Playwright ports

The default Playwright port is **8787** ([`playwright.config.ts`](../playwright.config.ts)).

- **CI** runs `npm run test:e2e` on port 8787.
- **Pre-commit** picks a free TCP port via Node, sets `E2E_PORT`, and sets `DELTAV_PRE_COMMIT_E2E=1` so Playwright does **not** reuse an existing server. This avoids attaching to a dev server on a fixed port.
- To run e2e manually while `npm run dev` holds 8787: `E2E_PORT=8788 npm run test:e2e` (any free port).

### Windows

The pre-commit hook is a POSIX shell script. Use **Git Bash**, **WSL**, or similar.

### Skipping hooks (emergency only)

```bash
git commit --no-verify
```

Prefer fixing the underlying issue — `--no-verify` skips all the checks that CI will then fail on.

## Full verification

```bash
npm run verify
```

Runs the local release gate: lint, typecheck (app + tools), coverage, build, e2e, a11y e2e, and `simulate all 40 -- --ci`. Pre-commit and CI use 60 iterations; `verify` uses 40 to stay responsive when invoked by hand.

## Documentation

One owner doc per topic (see [README.md](../README.md#-documentation)). Update docs when behavior or architecture decisions materially change — prefer anchored sections over new files. Recurring review cadence lives in [REVIEW_PLAN.md](./REVIEW_PLAN.md); open work lives in [BACKLOG.md](./BACKLOG.md).
