# ADR 0003: Client bundle and supply-chain baseline (2026-03)

## Context

The client is built with **esbuild** (`esbuild.client.mjs`). Dependencies are intentionally minimal.

## Decision — bundle (recorded at review time)

| Artifact                    | Raw bytes | Gzip (approx.) |
| --------------------------- | --------- | -------------- |
| `dist/client.js` (main app) | ~525 KB   | ~107 KB        |

Re-measure after large renderer or dependency changes; compare to this row.

## Decision — supply chain

- Run **`npm audit`** before releases; **0 vulnerabilities** was the state at this review.
- **Upgrade policy:** use `npm run update-deps` judiciously; run `verify` after bumps.
- **D1 migrations:** treat as **forward-only** unless Cloudflare backup/restore is used; document rollback as **redeploy previous Worker + compatible schema**, not automatic down-migration.

## Consequences

- Performance work should be **evidence-based** (see [BACKLOG.md](../BACKLOG.md) renderer baseline).
- CI uses **Node 25** (see `.github/workflows/ci.yml` and README).
