# Security & Competitive Integrity Review

This chapter describes the current security posture of Delta-V with emphasis on competitive multiplayer and abuse resistance.

## Current protections

The core invariant is simple: the server is authoritative.

WebSocket actions are validated and resolved on the server against the shared engine. Hidden-identity data is filtered per viewer before broadcast. Room creation is authoritative, scenario choice is locked at creation time, and room-code collisions are rejected.

The room creator receives a reserved reconnect token for seat zero. Guest-seat claiming is still room-code based in the default friendly-match flow, but once a seat is claimed the reconnect flow is token-based and seat reclamation is keyed to player identity.

Malformed client-to-server WebSocket messages are rejected at runtime before any engine handler executes. After a socket is accepted, per-socket rate limiting caps message flood at ten messages per second before closing the socket, and chat is separately throttled to at most one accepted message every five hundred milliseconds per player.

Room codes come from a cryptographically strong random-number generator rather than a non-cryptographic helper.

Join-style probes, replay fetches, leaderboard reads, WebSocket upgrades, telemetry, error reporting, and hosted Model Context Protocol requests all sit behind rate limits. The Worker also applies a shared response-hardening header baseline, and public read endpoints intentionally expose explicit wildcard cross-origin headers because they are read-only surfaces meant for browser embedding and tooling.

All user-originating rate limits are keyed per salted hashed IP. The client IP address is never stored in plaintext — it is hashed together with a production secret, and that secret is the key material used to bucket requests. The Worker fails closed when the secret is missing: hosted endpoints refuse to sign or hash rather than falling back to a predictable placeholder in production.

## Remote MCP token model

The hosted Model Context Protocol flow uses two credentials.

The first is the agent token. It is the long-lived identity credential, lasts twenty-four hours, travels in the Authorization header, and is minted by the agent-token endpoint.

The second is the match token. It is a per-match credential, lasts four hours, and is returned by hosted matchmaking or session-listing flows. It is then used on later hosted tool calls.

The important security property is that the match token is bound to the issuing agent token. Hosted MCP requires the matching bearer token on every request that uses a match token or the compatibility alias session identifier. That means a leaked match token alone is not enough to replay a hosted session.

Both tokens are signed with a production secret loaded at boot. The Worker fails closed when the signing secret is absent — hosted endpoints return a server-misconfigured error rather than signing with a placeholder. The same secret is also the salt used when hashing client IP addresses, unless a dedicated IP-hash salt secret is configured. Local development can opt into deterministic placeholders through the development-mode variable, but production never loads that override.

Hosted MCP no longer accepts raw room-code and player-token tool arguments. The expected path is: mint an agent token, start or discover a hosted session, receive a match token, then use that match token on later hosted tool calls.

Token revocation is still coarse. Rotating the signing secret invalidates all outstanding tokens at once.

## Remaining competitive risks

The first remaining risk is guest-seat claiming. The creator seat is protected, but the open guest seat is still claimed through the room code or a copied room link. That is acceptable for friendly matches and weak for public matchmaking.

The second remaining risk is room secrecy. Five-character room codes are intentionally short and easy to share, which makes them appropriate for friends and weak for open public play. The alphabet has thirty-two characters, which gives roughly thirty-three million combinations — collision-checked at creation time.

## Rate limiting architecture

Delta-V uses three rate-limit layers.

At the edge, Cloudflare rate-limit bindings protect create-class routes, telemetry, error reporting, and hosted Model Context Protocol traffic.

Inside the Worker, in-memory per-isolate buckets cover WebSocket upgrades plus join, replay, match-list, and leaderboard probes, and also act as the strict first line for create-class requests.

Inside the game Durable Object, per-socket limits cap post-upgrade message flood and chat cooldown.

All user-originating route limits are keyed per salted hashed IP rather than by the raw address.

The route budgets are as follows. Create, agent-token, quick-match, and claim-name are limited to five requests per minute per salted hashed IP, using both the strict per-isolate bucket and the Cloudflare create rate limiter binding. WebSocket upgrades are limited to twenty per minute per salted hashed IP in the per-isolate bucket. Join-style reads — including join, quick-match ticket polling, match-list, leaderboard, and per-player leaderboard lookup — share a budget of one hundred per minute per salted hashed IP. Replay fetches have a separate bucket of two hundred fifty per minute per salted hashed IP so replay traffic cannot exhaust the join budget. Telemetry allows one hundred twenty per minute per salted hashed IP with a four-kilobyte body cap, backed by the Cloudflare telemetry limiter with in-memory fallback. Error reporting allows forty per minute per salted hashed IP with the same body cap, backed by the error limiter. Hosted MCP allows twenty per minute keyed by agent-token hash or salted hashed IP, with a sixteen-kilobyte body cap. Post-upgrade WebSocket messages are capped at ten per second per socket, and chat is limited to one accepted message every five hundred milliseconds per player.

The practical caveat is that in-memory per-isolate limits are not global across all edge locations. If distributed abuse becomes real, WAF rules or additional edge rate-limit namespaces are the escalation path.

## Cost-abuse surface

Some risks are more about billing than about competitive cheating.

Telemetry and error reporting are still vulnerable to distributed callers bypassing per-isolate fallback paths when edge bindings are absent, although accepted bodies are small and the events table has a rolling thirty-day purge.

Hosted MCP is rate-limited and body-capped, but long-poll or polling-heavy patterns can still hold game rooms warm within the allowed budget.

The matchmaker queue still depends on a single serialized queue state with a practical size ceiling. Enough queued heartbeat pressure could still break quick match globally.

Orphaned create-only rooms still exist for up to the inactivity window, but the cleanup path now purges match-scoped event and checkpoint residue instead of leaving it behind forever.

Replay fetches still pay full projection cost on uncached live timelines, while terminal-state replays benefit from caching.

## Bot challenge protection

If automated room creation becomes a real problem, Cloudflare Turnstile can be added with a narrow integration surface: the lobby UI would collect a token, the create request would carry it, and the server would verify it before room creation continues.

## Lower-risk notes

The hidden-information filtering model is sound for the currently shipped fugitive-style scenarios, but any expansion toward more complex hidden-information mechanics would merit another audit.

Randomness is server-controlled, which is the anti-cheat property that matters here.

Frontend HTML injection is confined behind a narrow trusted-HTML boundary. Today only internally generated markup passes through it. If freeform user text is ever allowed into those surfaces, sanitization belongs inside that boundary rather than being scattered across callers.

## Competitive readiness summary

Delta-V is well hardened for private matches between friends.

Rules authority is good. Reconnect and seat-hijack resistance are good. Host-seat integrity is good. Guest-seat integrity is acceptable for the current room-code model. Match availability under hostile payloads is good. Rate limiting is good for the current product shape. Cross-site-scripting posture is good. Public-matchmaking secrecy remains weak because the room codes are short and some probe controls are still only per isolate.

The remaining steps for public matchmaking or tournament-grade play are longer opaque identifiers, stronger global probe throttling if guessing becomes measurable, and optional bot-challenge protection.

## Future security work

If the product scope expands, the next likely steps are longer room identifiers, Turnstile on room creation, account binding for organized play, stronger global join and replay throttling, and cross-edge WAF-backed protection for any path where per-isolate limits stop being enough.

## Data retention

The events table has a thirty-day rolling purge run by a daily scheduled cron.

The match-archive metadata table and the paired R2 match-JSON objects have a one-hundred-eighty-day rolling purge tied to the same scheduled cleanup path, which deletes both the database row and the archive object together.

The player table, match-rating table, and some remaining Durable Object storage do not have automatic time-to-live behavior beyond the room-archive lifecycle.

Operationally, the available levers are database export and delete operations, R2 lifecycle policies, and documented runbooks for any future user-erasure process. Erasure requests can be correlated by anonymous identifier for the events table within the thirty-day window, by player key for the player and match-rating tables, and by game identifier or room code for match-archive rows and R2 archives.

## Operational references

The observability document explains the logging and database side in detail. The technical privacy summary explains what the stack stores. Cloudflare's own documentation covers WAF rate limiting and Turnstile. OWASP references cover cross-site scripting and DOM-based cross-site scripting prevention.
