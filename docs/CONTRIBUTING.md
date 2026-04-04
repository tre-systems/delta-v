# Contributing

This file covers contributor workflow only. Use [README.md](../README.md) for project onboarding, [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, and [CODING_STANDARDS.md](./CODING_STANDARDS.md) for implementation conventions.

## Pre-commit (Husky)

The hook runs, in order:

1. `npm run lint`
2. Grep-based boundary checks (fail the commit if any match):
   - `innerHTML` assignment outside `dom.ts` (use `setTrustedHTML()`)
   - `Math.random` in `src/shared/engine/` (use injected RNG)
   - `console.log/warn/error` in `src/shared/` (shared layer must be side-effect free)
3. `npm run typecheck:all`
4. `npx wrangler d1 migrations apply delta-v-telemetry --local`
5. `rm -rf coverage` then `npm run test:coverage` (clean output dir)
6. `DELTAV_PRE_COMMIT_E2E=1 npm run test:e2e` (Playwright; see below)
7. `DELTAV_PRE_COMMIT_E2E=1 npm run test:e2e:a11y` (Playwright + axe baseline)
8. `npm run simulate all 25 -- --ci`

### Coverage (`test:coverage`)

Coverage uses **`--no-file-parallelism`** so Vitest’s v8 merger does not race on `coverage/.tmp/*.json` (intermittent `ENOENT` when many test files run in parallel).

If coverage still fails, remove `coverage/` and retry: `rm -rf coverage && npm run test:coverage`.

### Playwright / ports

Default Playwright port is **8787** (`playwright.config.ts`).

- Accessibility baseline run: `npm run test:e2e:a11y`
- **CI** runs `npm run test:e2e` without `E2E_PORT`, so the web server uses **8787**.
- **Pre-commit** assigns a **free TCP port** via Node, sets `E2E_PORT`, and sets `DELTAV_PRE_COMMIT_E2E=1` so Playwright does **not** reuse an existing server (avoids attaching to the wrong process if a fixed port is busy).
- **Pre-commit** also applies local D1 migrations before coverage/e2e so Wrangler's local database matches the current schema.
- To run e2e manually while **`npm run dev`** holds **8787**: `E2E_PORT=8788 npm run test:e2e` (or any free port).

If e2e fails with a port error, check nothing else is bound to the chosen port.

### Windows

Pre-commit is a POSIX shell script (`rm`, `export`, subshell). Use **Git Bash**, **WSL**, or similar. If you need **CMD** support, add a concrete follow-up item to [BACKLOG.md](./BACKLOG.md) or add `cross-env` locally.

### Skipping hooks (emergency only)

```bash
git commit --no-verify
```

Prefer fixing the underlying issue. **CI** runs lint, typecheck (app + tools), coverage, build, browser smoke (`test:e2e`), and the multi-scenario simulation pass. It does **not** currently run `test:e2e:a11y`. **Pre-commit** and **`npm run verify`** additionally run the Playwright + axe accessibility baseline.

## Full verification

```bash
npm run verify
```

Matches local release expectations: lint, typecheck (app + tools), coverage, build, e2e, a11y e2e, simulation.

## Documentation

See [REVIEW_PLAN.md](./REVIEW_PLAN.md) for cross-cutting review areas, [CODING_STANDARDS.md](./CODING_STANDARDS.md) for code style, and [ARCHITECTURE.md](./ARCHITECTURE.md) for system design.
