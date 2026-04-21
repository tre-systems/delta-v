# Delta-V MCP Reference

This document is the Model Context Protocol server and tool reference only.

For onboarding and workflow, refer to the agents quick-start and tuning workflow guide, and to the deep protocol and architecture specification at the repo root.

## Transports

Delta-V exposes three transports for MCP. The local stdio server runs as a subprocess per agent and speaks JSON-RPC over standard input and standard output; it is stateful and manages per-session WebSockets plus a buffered event stream through its list-sessions, get-events, and close-session helpers. The hosted HTTP endpoint receives POST requests at the MCP path on the production domain, serves streamable-HTTP JSON-RPC responses without server-sent events, and is stateless per request, using a layered scheme of long-lived agent tokens as bearer credentials and short-lived match tokens passed as tool arguments. Finally, a local HTTP variant reproduces the hosted flow through Wrangler dev, which is useful when you want to validate the hosted path without deploying. The security document covers the full token model, including HMAC-SHA-256 signing with the agent-token secret.

## Discovery endpoints

The Delta-V server exposes three discovery endpoints. Agents can find the server at the agents listing path, the well-known agent descriptor path, and the agent playbook path, all hosted under the main Delta-V domain.

## Running the local MCP server

To start the local MCP (Model Context Protocol) server, run the package's MCP start script from the project root. By default the server connects to the hosted Delta-V service. To point it at a local instance instead, set the server URL environment variable to your local address before running the same script.

## MCP host config

The repository includes a Cursor editor configuration file that sets up an stdio MCP server with the working directory pointed at the project folder. Open the project folder in Cursor and enable that MCP server if it is not picked up automatically.

The preferred host configuration names the server "delta-v-mcp", runs the package manager's MCP script, and sets the working directory to the project root. A fallback configuration is available for hosts that ignore the working directory setting — it passes the project path as a prefix argument to the package manager instead.

## Tool catalog

All tools accept a session identifier unless otherwise noted. The following tools are available.

The quick-match connect tool queues and connects a seat. It accepts a scenario name, a username, and an optional player key, and returns a session identifier, a room code, a player identifier, a player token, and a status value.

The list sessions tool returns a list of active local sessions and takes no arguments.

The get state tool returns the raw authoritative game state along with the latest event identifier, given a session identifier.

The get observation tool returns an agent observation payload. In addition to the session identifier, it accepts optional flags to include a summary, legal action information, tactical data, a spatial grid, and candidate labels. It returns an object compatible with the agent turn input format.

The wait for turn tool blocks until an actionable turn window is available. It accepts the same session identifier and optional include flags as the observation tool, and returns an observation payload. It throws on timeout and may also return or reject when the game reaches a game-over state.

The get events tool reads from the buffered event stream. It accepts a session identifier and optional arguments to start after a given event identifier, limit the number of results, and clear the buffer. It returns a list of events and a count of remaining buffered events.

The send action tool submits a client-to-server action. It accepts a session identifier and an action object, and returns the action type along with a richer action result when that feature is enabled.

The send chat tool sends a chat message. It accepts a session identifier and a text value (also aliased as "message") and returns the sent text.

The close session tool closes a local MCP session. It accepts a session identifier and returns a confirmation.

Next, a few notes on the catalog. The wait-for-turn tool throws on timeout and may return or reject when the game reaches game-over. The get-events, list-sessions, and close-session tools are local-session helpers that follow the stdio MCP ownership model. The get-observation tool is the preferred read surface for most agents; the get-state tool is the lower-level alternative.

## Rate limits and body caps

Both the hosted MCP endpoint and the HTTP APIs your session uses are throttled at Cloudflare's edge and inside the Workers. The canonical numbers — per route, per window, per scope, and what the server does on exceed — live in the security document. A few highlights agents should internalize. The hosted MCP path allows twenty requests per minute, keyed on the bearer token hash when present or the hashed client IP otherwise, with a sixteen-kilobyte JSON body cap checked before any JSON-RPC dispatch. The quick-match and agent-token endpoints share a per-IP bucket of five requests per minute in production. After a WebSocket connects, the Durable Object enforces ten messages per second per socket; exceeding that closes the socket with protocol code one-thousand-eight. Local stdio MCP inherits the same limits once it opens a WebSocket to the server. In practice, agents should space out their tool calls rather than learn the limits from 429 responses or size rejections.

## The send action tool — payload examples

The send action tool accepts different action types depending on the current game phase.

For astrogation, you supply an action of type "astrogation" along with a list of orders. Each order names a ship by identifier and specifies a burn value and an overload value.

To skip the ordnance phase, you supply an action of type "skipOrdnance" with no additional fields.

For combat, you supply an action of type "combat" along with a list of attacks. Each attack names one or more attacker ship identifiers and a single target ship identifier.
