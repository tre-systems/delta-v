# Contributing

Contributor workflow only. See [README.md](../README.md) for onboarding, [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, and [CODING_STANDARDS.md](./CODING_STANDARDS.md) for conventions.

## Pre-commit (Husky)

[`.husky/pre-commit`](../.husky/pre-commit) is now the cheap local gate.

If the staged diff is **documentation-only** (`README.md`, `AGENTS.md`, `AGENT_SPEC.md`, `docs/`, `patterns/`, `.claude/skills/`), it runs only:

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

If the pushed diff is **documentation-only** (`README.md`, `AGENTS.md`, `AGENT_SPEC.md`, `docs/`, `patterns/`, `.claude/skills/`), it runs only:

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

## Coordinated releases

Delta-V ships the **Worker and static assets as one version line** ([ARCHITECTURE.md](./ARCHITECTURE.md)). Use this checklist whenever you bump **`GameState.schemaVersion`**, change **S2C/C2S protocol** shapes, alter **replay projection** semantics, or run a D1 migration that touches live tables.

1. **Engine & protocol**
   - Update `src/shared/types/domain.ts` (`schemaVersion`) and any dependent validators in `src/shared/protocol.ts`.
   - Run `npm run typecheck:all` and `npm run test:coverage`.

2. **Replay & recovery**
   - Extend or adjust `src/server/game-do/` projector / archive tests if the event stream meaning changed.
   - Manually spot-check one archived match (`/replay/…` or R2 export) if checkpoints or envelope layout changed.

3. **Agents & MCP**
   - Refresh `static/agent-playbook.json` and agent-facing docs if legal actions or phase rules changed.
   - Run MCP / bridge smoke ([AGENTS.md](./AGENTS.md) quick start) against a local or staging Worker.

4. **D1 migrations (forward-only)**
   - Add any new migration as `migrations/000N_description.sql`; the filename ordering is authoritative.
   - Apply locally: `npx wrangler d1 migrations apply delta-v-telemetry --local` (the CI job + pre-push hook already do this).
   - The `deploy` job runs `wrangler d1 migrations apply delta-v-telemetry --remote` **before** the Worker deploys. Remember: rollback is "redeploy previous Worker on a compatible schema", not automatic down-migration.

5. **Client bundle**
   - Run `npm run build` so `dist/version.json` picks up a new **`assetsHash`** (see `/version.json` on the deployed host).
   - Confirm `index.html` query-string cache busts reference the new hash.

6. **Deploy**
   - Deploy Worker + assets together (`npm run deploy` or CI deploy job).
   - After deploy, hit `https://<host>/version.json` and confirm `packageVersion` / `assetsHash` match the release you expect.

If old HTML is cached at the edge, **`assetsHash`** mismatched against server behavior is a strong hint; correlate with D1 `client_error` / telemetry spikes.

## Documentation

One owner doc per topic (see [README.md](../README.md#-documentation)). Update docs when behavior or architecture decisions materially change — prefer anchored sections over new files. Recurring review cadence lives in [REVIEW_PLAN.md](./REVIEW_PLAN.md); open work lives in [BACKLOG.md](./BACKLOG.md).

Run `npm run check:doc-links` after doc edits — it walks every `[text](path#anchor)` link under `README.md`, `AGENTS.md`, `AGENT_SPEC.md`, `docs/`, `patterns/`, and `.claude/skills/`, verifying files exist and anchors match heading slugs.

Diagrams are Graphviz `.dot` sources in [docs/diagrams/](./diagrams/README.md) with committed PNG renders (color conventions in that folder's README). After editing a `.dot` file, run `npm run diagrams` (requires `brew install graphviz`) and commit the re-rendered PNG. CI runs `npm run check:diagrams` to verify every source still renders and has its PNG.
