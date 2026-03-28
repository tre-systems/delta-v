# Security & Competitive Integrity Review

This document describes the current security posture of Delta-V with emphasis on competitive multiplayer. It distinguishes protections that are already enforced from the risks that still remain if the game were exposed to untrusted public players.

Use it as an implementation-level security baseline for engineering decisions. It is not a legal policy document.

Related docs: [ARCHITECTURE](./ARCHITECTURE.md), [BACKLOG](./BACKLOG.md) (security and abuse tasks), [MANUAL_TEST_PLAN](./MANUAL_TEST_PLAN.md).

## Current Protections

Delta-V now has a materially stronger authoritative-server boundary than the original prototype:

- WebSocket actions are still resolved server-side against the authoritative game engine.
- Hidden-identity state is filtered per player before broadcast, so the fugitive flag itself is not sent to the opponent.
- Room creation is now authoritative: `/create` initializes the room, locks the scenario up front, and rejects room-code collisions.
- The room creator receives a reserved player token for seat 0.
- The guest seat is shared by room code or copied room link — anyone with the 5-character code can claim the open seat.
- Reconnects require the stored player token, and seat reclamation is keyed to player identity even if the previous WebSocket has not finished closing yet.
- Client-to-server WebSocket messages are runtime-validated before any engine handler executes, and malformed payloads are rejected instead of being trusted structurally.
- After a WebSocket is accepted, **per-socket message rate limiting** (10 messages per second, then close with code 1008) caps garbage traffic to the Durable Object. Chat is also throttled in-memory (minimum 500ms between accepted chat messages per player).
- Room codes are generated from a cryptographically strong RNG rather than `Math.random()` (see `generateRoomCode` in `src/server/protocol.ts`).
- `GET /join/:code` and `GET /replay/:code` have combined hashed-IP probe throttling in the Worker (100 requests / 60s, per isolate), reducing casual room-scan and replay-probe abuse.
- `POST /telemetry` and `POST /error` are JSON-only with a 4KB cap and hashed-IP window limits, limiting abuse and D1 write amplification in the default path.

These changes make private multiplayer substantially safer than before, especially for host-seat integrity, reconnect safety, and server authority.

## Remaining Competitive Risks

### 1. Guest-seat claiming is still code/link based in the default flow

Current status: **acceptable for friendly matches, weak for public matchmaking**

- The creator seat is token-protected.
- The guest seat is still usually claimed through possession of the 5-character room code or the copied `/?code=ROOM1` link.
- Room-code guest joins are the deliberate product model for now — designed for friends sharing codes in conversation.

Implications:

- Anyone who gets the room code before the intended guest can still occupy seat 1.
- This is weaker than authenticated accounts, signed invites, or tournament admin tooling, but appropriate for the current friendly-match scope.

Recommended next step:

- For public matchmaking or tournament play, add longer opaque room identifiers or authenticated invite links.

### 2. Room secrecy is limited by short codes

Current status: **acceptable for friendly matches, weak for public matchmaking**

- Room codes are collision-checked and cryptographically generated from **32** characters (`A–Z` excluding **I** and **O**, plus digits `2–9`): **32⁵ ≈ 33.6M** combinations (`src/server/protocol.ts`, `CODE_CHARS`).
- Short codes are a deliberate product choice — designed for voice/chat sharing between friends.
- For public matchmaking or tournament play, longer opaque identifiers would be needed to prevent code guessing.

### 3. Rate limiting architecture

The worker enforces a two-tier rate limit on `POST /create`:

**Tier 1 — Cloudflare edge binding (production):**
The checked-in production `wrangler.toml` binds
`CREATE_RATE_LIMITER` via Cloudflare's first-class
`[[ratelimits]]` config. This enforces limits across all
edge locations, not just within a single isolate.

```toml
[[ratelimits]]
name = "CREATE_RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 5, period = 60 }
```

**Tier 1.5 — Match archive storage (production):**
The checked-in production config also binds
`MATCH_ARCHIVE` to the `delta-v-match-archive` R2 bucket
so completed rooms can persist replay/support data after
the Durable Object goes inactive.

```toml
[[r2_buckets]]
binding = "MATCH_ARCHIVE"
bucket_name = "delta-v-match-archive"
```

**Tier 2 — In-memory fallback (development / missing binding):**
When no binding is configured, the worker uses a per-isolate in-memory map (5 creates per hashed IP per 60s window, stale entries evicted when map exceeds 1000 entries). This protects a single isolate but does not enforce globally across Cloudflare's edge.

**What's enforced vs. what's not:**

| Control                                 | In-memory fallback                                                                  | Edge binding                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Per-IP create throttle                  | per-isolate only                                                                    | global                                                     |
| WebSocket **connection** / join storm   | not app-rate-limited                                                                | not app-rate-limited (two seats cap abuse impact per room) |
| WebSocket **messages** (after connect)  | 10 msg/s per socket (DO)                                                            | same                                                       |
| `POST /telemetry` and `POST /error`     | **120** / **40** posts per hashed IP per 60s (per isolate); body capped at 4KB JSON | add **WAF** or `[[ratelimits]]` for global / stricter caps |
| Bot challenge (Turnstile)               | not present                                                                         | configurable via CF dashboard                              |
| `GET /join/:code` / `GET /replay/:code` | **100** combined GETs per hashed IP per 60s (per isolate)                           | optional WAF for global / stricter caps                    |
| Room-code guessing                      | 5-char codes, ~33.6M space, only per-isolate join/replay probe throttling by default | same unless extra global controls are configured           |

**Deployment recommendation:**
Treat the checked-in `wrangler.toml` as the production
baseline. If the `delta-v-match-archive` bucket does not
exist yet, `wrangler deploy` should fail until it is
created rather than silently shipping without replay
storage. Lower environments may still choose local
simulation or intentionally omit remote resources, but
public-facing production should keep the rate-limit and
archive bindings enabled. **Cloudflare WAF** (or extra `[[ratelimits]]` namespaces) can still cap
`POST /telemetry`, `POST /error`, and join/replay probes **across all edge
isolates** if per-isolate limits are not enough. Add a **Turnstile** challenge
on `/create` if automated room creation becomes a problem. WebSocket **upgrades** are not
message-throttled at the edge; abuse is partly mitigated
by two seats per room and by **per-socket message** limits
once connected.

### 4. Bot challenge protection (optional)

Cloudflare Turnstile can be added to the room creation flow with a narrow integration surface:

1. Add a Turnstile widget to the client's "Create Game" UI
2. Include the Turnstile token in the `POST /create` body
3. Validate the token server-side via the Turnstile `/siteverify` API before proceeding

This is not currently implemented but the integration surface is narrow — only the `/create` handler and the lobby UI need changes. See [Cloudflare Turnstile docs](https://developers.cloudflare.com/turnstile/).

## Lower-Risk Notes

### Hidden information

The current hidden-identity filtering is sound for the implemented Escape-style fugitive mechanic, because the hidden `hasFugitives` flag is stripped before broadcast. If the game expands toward dummy counters, concealed movement, or more scenario-specific secrets, that filtering layer will need another audit.

That becomes more important as the project moves toward
event-sourced match history. Raw internal event streams
should be treated as authoritative private data, not as
safe spectator or replay payloads. Replay and spectator
APIs should serve filtered projections or explicitly
redacted event views rather than exposing the internal
event log directly. **Live spectator WebSockets** follow the
same rule in practice: clients receive **filtered `GameState`
JSON** (same `filterStateForPlayer(..., 'spectator')` path as
broadcasts), not the append-only event stream.

### Randomness

Random outcomes are server-controlled, which is the key anti-cheat requirement here. The code no longer relies on client-provided randomness, but it should still be described as server-controlled rather than as a cryptographically audited randomness system.

### Frontend XSS posture

All `innerHTML` writes are now confined behind
`setTrustedHTML()` and `clearHTML()` in `src/client/dom.ts`.
No production code outside that file touches `innerHTML`
directly, making the boundary grep-able and auditable.

Today all callers pass internally generated markup (game
state, static constants, computed display strings) — no
user input or external content flows through this path.

If chat, player names, modded scenarios, or other freeform
text are added later, add a sanitizer such as `DOMPurify`
inside `setTrustedHTML()` rather than scattering raw
`innerHTML` writes. For plain text, prefer `textContent`
or the `el()` helper's `text` prop.

## Competitive Readiness Summary

Current assessment:

- **Rules authority:** good
- **Reconnect / seat hijack resistance:** good
- **Host-seat integrity:** good
- **Guest-seat integrity:** acceptable for friendly matches (room-code model is deliberate)
- **Match availability under hostile payloads:** good
- **Rate limiting:** good for `/create` in the checked-in production config, per-isolate only in lower environments without the binding; WebSocket **message** flood capped per socket; **telemetry/error** and **join/replay** HTTP probes have per-isolate hashed-IP windows (see table above); optional WAF for global caps
- **XSS posture:** good (trusted HTML boundary, no user-generated content)
- **Room secrecy / public matchmaking readiness:** weak (short codes; default join/replay throttles are per-isolate, not global)

Delta-V is well-hardened for private matches between
friends. For public matchmaking, tournament play, or open
lobbies, the remaining gaps are longer room identifiers,
join throttling if guessing becomes real, and optional
bot challenge protection.

## Future Security Work

If the product scope expands beyond friendly matches:

- Longer opaque room identifiers for public matchmaking
- Turnstile integration on `/create` for bot protection
- Account binding for organized competitive play
- Stronger join / replay HTTP throttling if room-code guessing or DO wake abuse becomes measurable (global controls, not just per-isolate windows)
- Optional **global** (cross-edge) rate limits via WAF / `[[ratelimits]]` for reporting and join/replay if needed (see [BACKLOG.md](./BACKLOG.md) priorities **1**, **8**)

Concrete abuse-hardening follow-ups: [BACKLOG.md](./BACKLOG.md) priorities **1**, **8** (optional edge), **12**, **15** (product-shaped).

## Data retention (D1, R2, DO)

What persists today:

- **D1** `events` (telemetry/errors), `match_archive` (metadata index).
- **R2** (when bound) `matches/{gameId}.json` full archives.
- **Durable Object storage** — live match chunks, checkpoints, room config; evicted when the DO is inactive (plus optional R2 archive at match end).

**Default policy:** retain telemetry and match archives until an explicit operations policy says otherwise; there is **no automatic TTL** in application code. Growth is unbounded by default in code.

**Operational control:** Cloudflare D1 export/backup, R2 lifecycle rules (tiering or delete after N days), and manual SQL (`DELETE` batches) when a retention window is mandated.

**User deletion requests:** if a jurisdiction requires erasure, use **`anon_id`** and time windows in `events`; match archives may require **gameId/room_code** correlation — document a runbook when needed. Automated purge or stricter programs are [BACKLOG.md](./BACKLOG.md) ops/engineering work when the product requires it.

## Operational References

- [OBSERVABILITY.md](./OBSERVABILITY.md) — D1 schema, sample queries, what is logged.
- [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) — what the stack stores (not legal advice).
- [Cloudflare WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
- [OWASP XSS overview](https://owasp.org/www-community/attacks/xss/)
- [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
