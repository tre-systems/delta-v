# Delta-V Backlog

Unfinished actionable work, in one global priority order. Shipped history lives in git; recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md); architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

---

## Public leaderboard with Elo

Active feature arc. Goal: a public shared leaderboard ranking humans and agents together with a visible "agent" badge, **no login required**. Design agreed 2026-04-17:

- `playerKey` already acts as a client-held pseudonym — bind `playerKey` → `displayName` in D1 and gate only the one-time claim.
- Only matchmaker-paired games feed the ladder, so private rooms can't be rigged against yourself.
- Glicko-2 rating deviation naturally hides brand-new accounts behind a "provisional" flag until they have played enough distinct opponents.
- Agents piggyback the existing signed-token flow and inherit its 5/min/IP rate limit. Human claims are rate-limited by IP alone for this arc.
- Cloudflare Turnstile (free, no tier cap) on the human claim endpoint is deferred to Future features; the endpoint is structured to bolt it on later. Ship without it first.
- Proof-of-work on the agent claim is also deferred to Future features; add only if logs show farming.
- **Unified identity:** the public leaderboard username is the same string as the local Callsign field — no separate "display name" concept. The Callsign input on the home screen POSTs to `/api/claim-name` on blur; conflicts surface inline as "Callsign is taken — try another." A playerKey can rename freely; a name owned by a different key returns 409.

Accepted tradeoff: without accounts, smurfing is never zero — only unprofitable for casual griefers. No prize money, so this is fine.

Work items in priority / dependency order:

### 1. D1 schema: `player` and `match_rating`

New migration adds two tables. `player` (`player_key` PK, `display_name` UNIQUE, `is_agent` INTEGER, `rating` INTEGER, `rd` INTEGER, `volatility` REAL, `games_played` INTEGER, `distinct_opponents` INTEGER, `last_match_at` INTEGER, `created_at` INTEGER). `match_rating` (`game_id` PK, `archived_match_id`, `player_a_key`, `player_b_key`, `winner_key` NULLABLE, `pre_rating_a`, `post_rating_a`, `pre_rating_b`, `post_rating_b`, `created_at`). Indexes: `player(rating DESC)` for ranking, `match_rating(player_a_key)` / `(player_b_key)` for per-player history. `game_id` as PK gives idempotent re-processing of the same match.

**Files:** `migrations/0004_leaderboard.sql` (new)

### 2. Glicko-2 rating helper (pure)

Pure module `updateRating(playerA, playerB, outcome) → { newA, newB }` using Glicko-2 defaults (tau 0.5, initial rating 1500, initial RD 350, initial volatility 0.06). Unit tests: symmetry of outcomes, RD decreases with play, upset gives bigger rating change than expected win, untouched RD grows over time per the inactivity rule. No DB knowledge, no side effects.

**Files:** `src/shared/rating/glicko2.ts` (new), `src/shared/rating/glicko2.test.ts` (new)

### 3. Username claim — agents

Extend `POST /api/agent-token` request body to accept optional `claim: { username }`. On successful token issue for a `playerKey`, upsert a `player` row with `is_agent=1` and the claimed username; a username already owned by a *different* key returns 409. Same key may rename freely. Re-uses the existing 5/min/IP rate limit so no new attack surface.

**Files:** `src/server/auth/issue-route.ts`, `src/server/leaderboard/player-store.ts`, `src/server/leaderboard/username.ts`, tests

### 4. Username claim — humans (reuses the Callsign field)

New endpoint `POST /api/claim-name` accepting `{ playerKey, username }`. Server upserts a `player` row with `is_agent=0`; rejects if the username is taken by a different `playerKey`. Rate-limited per IP (reuse the existing 5/min limiter used by `/create` and `/api/agent-token`). The existing home-screen Callsign input POSTs on blur; success shows "Claimed as X" inline, conflict shows "Callsign is taken — try another." Uses the existing `normalizeUsername` format (2–20 chars, alphanumeric + space / `_-`) plus a server-side slur blocklist.

Structure the handler so a future Turnstile verification step slots in at the top of the request pipeline with no change to the success path — see the matching Future features entry.

**Files:** `src/server/index.ts` (route), `src/server/leaderboard/claim-route.ts` (new), `src/server/leaderboard/username.ts` (new), `src/client/ui/lobby-view.ts`, `src/client/leaderboard/api.ts` (new), `static/index.html`, `static/styles/components.css`

### 5. Wire matchmaker-paired results into ratings

At `game_ended` in a GameDO that originated from the matchmaker (not `/create`), if both players have `player` rows, compute the Glicko-2 update and write a `match_rating` row. Idempotent on `game_id`. Private-room matches skip silently. One-sided matches (only one player claimed a name) also skip silently and do not degrade the other player's RD. Rating write runs after the match archive write so a failure there does not block leaderboard data.

**Files:** `src/server/game-do/game-do.ts`, `src/server/game-do/match-archive.ts`, `src/server/matchmaker-do.ts` (origin tag), tests

### 6. Leaderboard API + public page

`GET /api/leaderboard?limit=100` returns `{ entries: [{ username, isAgent, rating, rd, gamesPlayed, provisional, lastPlayedAt }] }`, sorted rating DESC, excluding provisional entries unless `?includeProvisional=true`. Response cached at the edge for 60 s so D1 reads stay trivial. New `/leaderboard` static page with a simple table, agent badge, "provisional" column toggle, link from home screen.

**Files:** `src/server/index.ts` (route), `src/server/leaderboard/query.ts` (new), `static/leaderboard.html` + `src/client/leaderboard/`, tests

### 7. Provisional gating

A `player` is *provisional* (hidden from default leaderboard) until all of (a) `games_played ≥ 10`, (b) `distinct_opponents ≥ 5`, (c) Glicko-2 `rd ≤ 100`. Thresholds live as named constants. `distinct_opponents` maintained as an incremental counter at rating-write time (kept in a small per-player opponents-seen set — approximate with a hash-bucket if memory becomes an issue; at beta scale a straight JSON array in the row is fine).

**Files:** `src/shared/rating/provisional.ts` (new), consumed by the query in item 6, tests

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

Baseline per-isolate rate limiting is already shipped (100 join-style GETs including `/join`, quick-match ticket polling, and `/api/matches` per 60s per IP; **250** `/replay` GETs per 60s on a separate counter). Add WAF or `[[ratelimits]]` only if the baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Cloudflare Turnstile on human name claim

**Trigger:** logs show bulk human name-claim POSTs, or the beta opens to a larger audience.

Add Turnstile verification to `POST /api/claim-name`: include a site-key widget on the claim form, pass `turnstileToken` in the request, verify server-side via a `TURNSTILE_SECRET_KEY` binding before the name validation / upsert. Free, no tier cap. Endpoint is already structured to accept the extra field with no change to the success path.

**Files:** `src/server/auth/claim-name.ts`, `src/server/auth/turnstile.ts` (new), `static/index.html` + `src/client/` home screen, `wrangler.toml` (`TURNSTILE_SITE_KEY` public var, `TURNSTILE_SECRET_KEY` secret)

### Proof-of-work on first agent name claim

**Trigger:** logs show bulk agent-token issuance being used to farm leaderboard pseudonyms.

Symmetric in spirit to the Turnstile gate on human claims. Server issues a challenge; client submits a nonce whose hash beats a threshold. A few seconds of CPU for a legit agent, painful at bulk. No new infra or billing. Keep the per-IP rate limit in place alongside.

**Files:** `src/server/auth/agent-token.ts`, `src/shared/pow.ts` (new)

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
