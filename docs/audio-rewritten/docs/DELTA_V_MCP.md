# Delta-V Model Context Protocol Reference

This chapter is the Model Context Protocol (MCP) server and tool reference. For onboarding and workflow, refer to the agents quick-start and tuning-workflow guide, and to the deep protocol and architecture specification at the repository root.

## Transports

Delta-V exposes three transports for the Model Context Protocol.

The local standard-input-and-output server runs as a subprocess per agent and speaks JSON-remote-procedure-call over standard input and standard output. It is stateful and manages per-session WebSockets plus a buffered event stream through list-sessions, get-events, reconnect, and close-session helpers. Outbound responses are queued so concurrent tool completions cannot corrupt the response framing. Many hosts still invoke tools serially — the next call starts after the previous returns — so two quick-match probes issued in the same assistant step actually run sequentially. For truly concurrent requests from separate processes, prefer the local HTTP variant.

The hosted HTTP endpoint receives requests at the Model Context Protocol path on the production domain, serves streamable-HTTP JSON-remote-procedure-call responses without server-sent events, and is stateless per request. Every call requires a bearer authorization header carrying a long-lived agent token, plus an accept header that includes both JSON and text event-stream types even though the endpoint currently returns the JSON response path. In-match tools accept an opaque per-match token as a tool argument; hosted also accepts a session-identifier alias for the same token. The game Durable Object now persists hosted seat event buffers so list-sessions, get-events, and close-session work without Worker memory, and the read tools accept the same optional compact-state flag as local standard-input-and-output.

The local HTTP variant reproduces the hosted flow through Wrangler dev, which is useful when you want to validate the hosted path without deploying.

The full token model — signed with the agent-token secret using HMAC with SHA-256 — is documented in the security chapter.

### Standard-input-and-output quick-match operational notes

Because many hosts serialize tool calls, queue both seats with the wait-for-opponent flag set to false and then call the pair-quick-match-tickets helper on the two returned tickets. When you need deterministic pairing without touching the public queue, give both seats the same rendezvous code. Use distinct player keys per automated client so queue and pairing telemetry stays unambiguous. If a session lands in an unintended development-mode bot seat, close that session and queue again; for reproducible human-versus-human tests, join via normal lobby or share links rather than racing two anonymous quick-match tickets. If a local session socket drops, use list-sessions to inspect connection status and last-disconnect reason, then call reconnect on the same session identifier rather than re-queueing.

## Hosted match-token flow

An agent mints an agent token by posting a player key to the agent-token endpoint, authorizes every subsequent call with that bearer, initializes the Model Context Protocol session, and calls quick-match. The server returns a match token. The agent then loops: wait for turn with the match token, send the chosen action with the match token, receive the next observation, repeat.

## Discovery endpoints

Delta-V exposes three discovery endpoints under the main domain: an agents listing page, a well-known agent descriptor, and an agent playbook.

## Resource catalog

Eleven resources are advertised on hosted Model Context Protocol. One is a current structured ruleset payload in JSON. Nine are per-scenario structured rules payloads, one per shipped scenario, also JSON. One is the public agent leaderboard snapshot in JSON. Parameterized resource templates, reachable through resource read and resource-template list but not enumerated in the resource listing, cover the current live observation, the buffered append-only event log, and the latest replay timeline for a given match. For local Model Context Protocol, the match identifier is the session identifier or local match-token alias. For hosted, it is the opaque match token.

## Running the local Model Context Protocol server

Start the local server by running the package's script. By default it connects to the hosted Delta-V service. To point it at a local instance, set the server-URL environment variable before running the same script.

## Host configuration

The repository includes a Cursor editor configuration file that sets up a standard-input-and-output server with the working directory pointed at the project folder. Open the project folder in Cursor and enable that server if it is not picked up automatically. The preferred configuration names the server "delta-v-mcp", runs the package manager's script, and sets the working directory to the project root. A fallback configuration is available for hosts that ignore the working directory setting — it passes the project path as a prefix argument to the package manager instead.

## Hosted request shape

Every hosted request sends a JSON content type, an accept header covering JSON and text event-stream, and a bearer authorization header carrying the agent token. Clients initialize once per session, then queue into a match through the quick-match tool — the response contains a match token used on every subsequent tool call. The wait-for-turn tool then blocks for an actionable turn window with optional include flags for summary, legal action metadata, tactical data, a spatial grid, and candidate labels. The send-action tool submits the chosen action with optional flags to wait for the result, include the next observation, and include a summary. The resources-read method reads a resource such as the current rules payload. The close-session tool clears the hosted helper buffer for a match without invalidating the match itself.

## Tool catalog

Local tools accept a session identifier unless otherwise noted. Hosted in-match tools use a match token, and accept a session identifier as a compatibility alias for the same opaque handle.

- The quick-match-connect tool queues and connects a seat. It accepts a scenario, an optional rendezvous code, an optional username, an optional player key, and an optional wait-for-opponent flag. On a local matched response it returns a session identifier, match token, room code, player identifier, player token, and status; on a hosted matched response it returns a match token, session identifier, expiry time, scenario, ticket, and player key; in queued mode it returns a queued status and ticket.
- The quick-match tool is an alias for quick-match-connect on local Model Context Protocol and is the canonical name on hosted.
- The pair-quick-match-tickets tool is a local-only helper that resolves two queued tickets into one match and connects both seats. It takes a left ticket, a right ticket, and an optional server URL.
- The list-sessions tool returns active sessions. Locally this is the in-memory standard-input-and-output sessions; on hosted it is active live matches for the authenticated agent, with fresh match tokens.
- The reconnect tool is local-only and reopens a dropped WebSocket using the stored seat.
- The get-state tool returns raw authoritative state plus the latest event identifier.
- The get-observation tool returns an agent observation payload compatible with the agent-turn input format, with include flags and an optional compact-state flag. Local defaults to compact state; pass false for the full game state.
- The wait-for-turn tool blocks until an actionable turn window is available. It accepts an optional timeout in milliseconds along with the same include flags and compact-state option. It throws on timeout and may return or reject when the game reaches game-over.
- The get-events tool reads the buffered event stream. Hosted returns a Durable-Object-backed seat buffer keyed by match token or session identifier. It accepts an after-event identifier, a limit, and a clear flag.
- The send-action tool submits a client-to-server action. It accepts an action object and optional flags to wait for the result, include the next observation, and include compact state. It returns the action type, and when the richer action result is enabled it includes a guard-status field and an auto-skip-likely field.
- The send-chat tool sends a chat message, accepting a text value — also aliased as "message".
- The close-session tool closes session helper state. Locally it closes the owned WebSocket session; on hosted it clears the Durable-Object-backed helper and event buffer for that seat without invalidating the match itself.

The get-observation tool is the preferred read surface for most agents; get-state is the lower-level alternative.

## Rate limits and body caps

Both the hosted Model Context Protocol endpoint and the HTTP APIs your session uses are throttled at Cloudflare's edge and inside the Workers. The canonical numbers live in the security document. Agents should internalize a few highlights. The hosted Model Context Protocol path allows twenty requests per minute, keyed on the bearer token hash when present or the salted hashed client IP otherwise, with a sixteen-kilobyte JSON body cap checked before any JSON-remote-procedure-call dispatch. The quick-match and agent-token endpoints share a strict Worker-local bucket of five requests per minute per salted hashed IP in production, with an extra Cloudflare rate-limiter edge layer in production as well. After a WebSocket connects, the Durable Object enforces ten messages per second per socket; exceeding that closes the socket with protocol code one-thousand-eight. Local standard-input-and-output inherits the same limits once it opens a WebSocket to the server. In practice, agents should space out their tool calls rather than learn the limits from rejection responses or size rejections.

A few additional notes on behavior. In development mode on the local Worker, the matchmaker may pair a lone quick-match ticket with a synthetic development bot after about ten seconds so one client can reach the matched state without a second player; production still waits for a real opponent. Local read tools default to compact state output, and hosted tools still forward an optional compact-state flag to the game Durable Object. When the send-action wait-for-result response reports auto-skip-likely as true, treat the returned next phase as transient and call wait-for-turn rather than immediately chaining a skip. Accepted send-action responses include a guard-status value of either in-sync or stale-phase-forgiven so agents can tell whether a phase guard was forgiven even though the action went through. The wait-for-turn tool throws on timeout and may also return or reject when the game reaches game-over. The reconnect tool remains local-only; list-sessions, get-events, and close-session now also work on hosted when an agent bearer is present. During fleet-building, always send a fleet-ready action explicitly if the phase is fleet-building — that phase is simultaneous but does not auto-submit on connect. The quick-match tools accept a wait-for-opponent flag to enqueue and return the ticket immediately instead of blocking for a full match, and a rendezvous code that isolates automation traffic into a deterministic pairing bucket — only clients presenting the same scenario-and-rendezvous pair can match each other.

## Send-action payload examples

For astrogation, supply an action of type "astrogation" along with a list of orders. Each order names a ship by identifier and specifies a burn value and an overload value.

To skip the ordnance phase, supply an action of type "skipOrdnance" with no additional fields.

For combat, supply an action of type "combat" along with a list of attacks. Each attack names one or more attacker ship identifiers and a single target ship identifier.
