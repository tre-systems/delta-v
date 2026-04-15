# Delta-V Backlog

Active work items are listed below in one global priority order.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

---

## Active work

### Archived replay viewer (browser-playable)

**Trigger:** the public `/matches` history page surfaces completed matches, but there's no browser-visitable URL to actually watch one. The server exposes `/replay/{code}?viewer=spectator&gameId=…` which returns the full timeline JSON, but no HTML UI consumes it for non-participants.

Wire a new client entry path — e.g. `/?code=X&archivedReplay=GAMEID` — that:
- calls `fetchReplay(code, gameId)` over the existing spectator route (no `playerToken` needed)
- boots the client into a read-only replay state (reuse `replay-controller.ts`, hide lobby/rematch/chat-input)
- uses the last timeline entry's state as the initial snapshot and lets the user scrub turn-by-turn

Gate behind the `spectatorMode` feature flag (currently `false` in `feature-flags.ts`). Flip on once wired.

**Files:** `src/client/game/client-runtime.ts` (`autoJoinFromUrl`), `src/client/game/session-api.ts` (spectator-aware `fetchReplay`), `src/client/game/replay-controller.ts`, `src/client/feature-flags.ts`, `static/matches.html` (re-add the "Replay →" link column once the viewer exists).

---

## Future features (not currently planned)

These items are potential future work that depend on product decisions or external triggers. They are not in the active queue.

### Public matchmaking with longer room identifiers

**Trigger:** product moves beyond shared short codes.

Implement longer opaque room IDs or signed invites and update the join/share UX accordingly.

**Files:** `src/server/protocol.ts`, lobby and join UI, share-link format

### Trusted HTML sanitizer for user-controlled markup

**Trigger:** chat, player names, or modded scenarios render as HTML.

Add a single sanitizer boundary (e.g. DOMPurify inside `dom.ts`) and route all user-controlled markup through it. The trusted HTML boundary (`setTrustedHTML`) already exists for internal strings.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### WAF or Cloudflare rate limits for join/replay probes

**Trigger:** distributed scans wake durable objects or cost too much.

Baseline per-isolate rate limiting is already shipped (100 combined GET /join + /replay per 60s per IP). Add WAF or `[[ratelimits]]` only if the baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Public agent leaderboard with Elo

**Trigger:** account / persistent-identity system exists.

Depends on accounts (out of scope for beta per `BETA_READINESS_REVIEW.md`). When unblocked, expose Elo, win/loss by reason, action-validity and latency metrics per agent `playerKey`. Flag coached matches separately.

**Files:** `src/server/leaderboard/` (new), new `/leaderboard` route, D1 schema additions

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
