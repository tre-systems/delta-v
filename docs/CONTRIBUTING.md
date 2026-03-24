# Contributing

## Pre-commit (Husky)

The hook runs, in order:

1. `npm run lint`
2. `npm run typecheck:all`
3. `npm run test:coverage`
4. `npm run test:e2e` (Playwright)
5. `npm run simulate all 25 -- --ci`

### Coverage (`test:coverage`)

Coverage uses **`--no-file-parallelism`** so Vitest’s v8 merger does not race on `coverage/.tmp/*.json` (intermittent `ENOENT` when many test files run in parallel).

If coverage still fails, remove `coverage/` and retry: `rm -rf coverage && npm run test:coverage`.

### Playwright / port 8787

Pre-commit sets **`E2E_PORT=8788`** when running e2e so Playwright’s `webServer` can start Wrangler on **8788** while you keep **`npm run dev`** on **8787**.

- **CI** (`.github/workflows/ci.yml`) runs `npm run test:e2e` without `E2E_PORT`, so Playwright uses **8787** and starts its own Wrangler via `webServer`.
- To run e2e manually alongside dev on 8787: `E2E_PORT=8788 npm run test:e2e`

If e2e fails with a port error, check nothing else is bound to the chosen port.

### Windows

Pre-commit uses `E2E_PORT=8788` in shell form. Use **Git Bash**, **WSL**, or a POSIX shell. If you need **CMD** support, track [BACKLOG.md](./BACKLOG.md) “Windows-friendly pre-commit” or add `cross-env` locally.

### Skipping hooks (emergency only)

```bash
git commit --no-verify
```

Prefer fixing the underlying issue; **CI** still runs the full pipeline.

## Full verification

```bash
npm run verify
```

Matches release expectations: lint, typecheck (app + tools), coverage, build, e2e, simulation.

## Documentation

See [REVIEW_PLAN.md](./REVIEW_PLAN.md) for cross-cutting review areas, [CODING_STANDARDS.md](./CODING_STANDARDS.md) for code style, and [ARCHITECTURE.md](./ARCHITECTURE.md) for system design.
