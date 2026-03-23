# Security & Competitive Integrity Review

This document describes the current security posture of Delta-V with emphasis on competitive multiplayer. It distinguishes protections that are already enforced from the risks that still remain if the game were exposed to untrusted public players.

Related docs: [ARCHITECTURE](./ARCHITECTURE.md), [BACKLOG](./BACKLOG.md), [MANUAL_TEST_PLAN](./MANUAL_TEST_PLAN.md).

## Current Protections

Delta-V now has a materially stronger authoritative-server boundary than the original prototype:

- WebSocket actions are still resolved server-side against the authoritative game engine.
- Hidden-identity state is filtered per player before broadcast, so the fugitive flag itself is not sent to the opponent.
- Room creation is now authoritative: `/create` initializes the room, locks the scenario up front, and rejects room-code collisions.
- The room creator receives a reserved player token for seat 0.
- The guest seat is shared by room code or copied room link — anyone with the 5-character code can claim the open seat.
- Reconnects require the stored player token, and seat reclamation is keyed to player identity even if the previous WebSocket has not finished closing yet.
- Client-to-server WebSocket messages are runtime-validated before any engine handler executes, and malformed payloads are rejected instead of being trusted structurally.
- Room codes are generated from a cryptographically strong RNG rather than `Math.random()`.

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

- Room codes are collision-checked and cryptographically generated (5 characters from a 28-char alphabet = ~17M combinations).
- Short codes are a deliberate product choice — designed for voice/chat sharing between friends.
- For public matchmaking or tournament play, longer opaque identifiers would be needed to prevent code guessing.

### 3. Rate limiting architecture

The worker enforces a two-tier rate limit on `POST /create`:

**Tier 1 — Cloudflare edge binding (production):**
When `CREATE_RATE_LIMITER` is bound in `wrangler.toml`, the worker delegates to Cloudflare's edge-global rate limiter. This enforces limits across all edge locations, not just within a single isolate.

To enable, add to `wrangler.toml`:

```toml
[[unsafe.bindings]]
name = "CREATE_RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { period = 60, limit = 5 }
```

**Tier 2 — In-memory fallback (development / missing binding):**
When no binding is configured, the worker uses a per-isolate in-memory map (5 creates per hashed IP per 60s window, stale entries evicted when map exceeds 1000 entries). This protects a single isolate but does not enforce globally across Cloudflare's edge.

**What's enforced vs. what's not:**

| Control | In-memory fallback | Edge binding |
|---|---|---|
| Per-IP create throttle | per-isolate only | global |
| WebSocket join throttle | not rate-limited | not rate-limited |
| Bot challenge (Turnstile) | not present | configurable via CF dashboard |
| Room-code guessing | 5-char codes, no join throttle | same — mitigated only by code entropy |

**Deployment recommendation:**
For any deployment exposed to untrusted traffic, configure the edge rate-limit binding and consider adding a Cloudflare Turnstile challenge on the `/create` path. WebSocket joins are implicitly constrained by the room model (two seats per room) and don't need dedicated rate limiting.

### 4. Bot challenge protection (optional)

Cloudflare Turnstile can be added to the room creation flow without changing the game server:

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
event log directly.

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
- **Rate limiting:** good with edge binding configured, per-isolate only without it
- **XSS posture:** good (trusted HTML boundary, no user-generated content)
- **Room secrecy / public matchmaking readiness:** weak (short codes, no join throttle)

Delta-V is well-hardened for private matches between friends. For public matchmaking, tournament play, or open lobbies, the remaining gaps are longer room identifiers, edge-global rate limiting (configurable today, not yet default), and optional bot challenge protection.

## Future Security Work

If the product scope expands beyond friendly matches:

- Longer opaque room identifiers for public matchmaking
- Turnstile integration on `/create` for bot protection
- Account binding for organized competitive play
- Join throttling if room-code guessing becomes a real vector

## Operational References

- [Cloudflare WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
- [OWASP XSS overview](https://owasp.org/www-community/attacks/xss/)
- [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
