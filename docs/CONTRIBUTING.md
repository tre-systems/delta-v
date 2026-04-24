# Contributing

Contributor workflow only. See [README.md](../README.md) for onboarding, [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, and [CODING_STANDARDS.md](./CODING_STANDARDS.md) for conventions.

## Pre-commit (Husky)

[`.husky/pre-commit`](../.husky/pre-commit) is now the cheap local gate.

If the staged diff is **documentation-only** (`README.md`, `AGENT_SPEC.md`, `docs/`, `patterns/`), it runs only:

1. `npm run check:doc-links`

For non-doc changes it runs, in order:

1. `npm run lint`
2. Grep-based boundary checks (fail the commit if any match):
   - `innerHTML` assignment outside `src/client/dom.ts` (use `setTrustedHTML()`)
   - `Math.random` in `src/shared/engine/` (use injected RNG)
   - `console.log/warn/error` in `src/shared/` (shared layer must be side-effect free)
3. `npm run typecheck:all`

## Pre-push (Husky)

[`.husky/pre-push`](../.husky/pre-push) is the fast local push gate by default.

If the pushed diff is **documentation-only** (`README.md`, `AGENT_SPEC.md`, `docs/`, `patterns/`), it runs only:

1. `npm run check:doc-links`

For non-doc pushes it runs, in order:

1. `npm run lint`
2. The same grep-based boundary checks as pre-commit
3. `npm run typecheck:all`
4. `npm run build`
5. `npm run simulate:smoke` only when AI, agent, engine, scenario, or simulation files changed

CI still runs the full verification list — coverage, browser smoke, a11y, `simulate all 60 -- --ci`, deploy dry-run, and deployment checks — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

To run the exhaustive local gate before pushing:

```bash
DELTAV_FULL_PRE_PUSH=1 git push
```

That mode runs the local D1 migration setup, fresh coverage, Playwright smoke, Playwright a11y, and the 60-iteration simulation sweep before allowing the push.

### Coverage

`test:coverage` runs two sequential Vitest coverage passes:
- client tests write reports under `coverage/client`
- server/shared/MCP tests write reports under `coverage/server-shared`

Each pass still uses `--no-file-parallelism`, but the real fix is that the two suites no longer share one `coverage/.tmp/` directory. If coverage fails unexpectedly, remove `coverage/` and retry.

Both `npm test` and `npm run test:coverage` set `NODE_OPTIONS=--localstorage-file=/tmp/deltav-vitest-localstorage` to silence Node 25+ experimental web-storage warnings.

### Playwright ports

The default Playwright port is **8787** ([`playwright.config.ts`](../playwright.config.ts)).

- **CI** runs `npm run test:e2e:smoke` and `npm run test:e2e:a11y` on port 8787.
- **Full pre-push** (`DELTAV_FULL_PRE_PUSH=1`) picks a free TCP port via Node, sets `E2E_PORT`, and sets `DELTAV_PRE_COMMIT_E2E=1` so Playwright does **not** reuse an existing server. This avoids attaching to a dev server on a fixed port.
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

Runs the full local release gate: lint, typecheck (app + tools), coverage, build, Playwright smoke, a11y e2e, and `simulate all 60 -- --ci`. Use `npm run verify:quick` for the fast lint/typecheck/build gate.

## Documentation

One owner doc per topic (see [README.md](../README.md#-documentation)). Update docs when behavior or architecture decisions materially change — prefer anchored sections over new files. Recurring review cadence lives in [REVIEW_PLAN.md](./REVIEW_PLAN.md); open work lives in [BACKLOG.md](./BACKLOG.md).

Run `npm run check:doc-links` after doc edits — it walks every `[text](path#anchor)` link under `README.md`, `AGENT_SPEC.md`, `docs/`, and `patterns/`, verifying files exist and anchors match heading slugs.
