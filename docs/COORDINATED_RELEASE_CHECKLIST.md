# Coordinated release checklist

Delta-V ships the **Worker and static assets as one version line** ([ARCHITECTURE.md](./ARCHITECTURE.md)). Use this list whenever you bump **`GameState.schemaVersion`**, change **S2C/C2S protocol** shapes, alter **replay projection** semantics, or run a D1 migration that touches live tables.

1. **Engine & protocol**
   - Update `src/shared/types/domain.ts` (`schemaVersion`) and any dependent validators in `src/shared/protocol.ts`.
   - Run `npm run typecheck:all` and `npm run test:coverage`.

2. **Replay & recovery**
   - Extend or adjust `src/server/game-do/` projector / archive tests if the event stream meaning changed.
   - Manually spot-check one archived match (`/replay/…` or R2 export) if checkpoints or envelope layout changed.

3. **Agents & MCP**
   - Refresh `static/agent-playbook.json` and agent-facing docs if legal actions or phase rules changed.
   - Run MCP / bridge smoke (`docs/AGENTS.md` quick start) against a local or staging Worker.

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
