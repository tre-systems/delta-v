# Exploratory Testing

A toolkit and technique catalogue for discovery-oriented testing — open-ended probes designed to surface bugs, documentation inconsistencies, edge cases, and ergonomics issues that pre-defined checklists miss.

This is not a release-gate checklist. For release verification use the manual test plan. For automated AI-versus-AI sweeps and load tests use the simulation testing guide. For recurring architecture and security review cycles use the review plan. For Cloudflare Worker and database internals when a probe surfaces something to triage, see the observability guide.

## When to run an exploratory pass

Run one after a milestone or significant refactor that changes user-visible surface — user interface, Model Context Protocol, or public application programming interface. Run one before a release when a feature crosses subsystem boundaries, for example fleet building combined with matchmaking and a leaderboard write. Run one on a quarterly cadence even when nothing has changed, to catch production drift, third-party breakage, and documentation rot. And run one whenever a real user report hints at a class of issues worth probing more broadly.

A pass typically takes sixty to a hundred and twenty minutes of agent or human time and should produce five to fifteen backlog entries — or none, if the surface is genuinely tight.

## Toolkit

Each vantage is a separate way to look at the running system. Use several per pass — single-vantage sessions miss too much.

The Browser MCP vantage, through Claude in Chrome or the Playwright preview, drives the single-page application as a real user would. It lets you inspect the DOM, the console, and the network. Connect the browser extension and open the production site.

The Local Agent MCP vantage uses standard input and output. It drives a seat programmatically and lets you inspect the raw observation, candidates, and tactical hints. You start it with the local MCP run script, as described in the MCP reference.

The Hosted Agent MCP vantage calls the same tools via streamable HTTP. It is useful for probing the deployed adapter and the agent-token flow. You mint an agent token through the token-issue endpoint, then send it as a bearer header on every Model Context Protocol call. The endpoint requires clients to accept both application JSON and text event-stream content types.

The Play skill is a higher-level autonomous play loop that sits on top of the agent Model Context Protocol. It is useful for smoke runs — but not for probing, as noted in the anti-patterns section.

The curl vantage hits public endpoints directly. Use it to probe the HTTP application programming interface surface, validation behaviour, and error shapes. The set of documented endpoints is in the well-known agent manifest.

The D1 query vantage uses Wrangler's database-execute command in remote mode. It lets you inspect or mutate the four main tables: events, match archive, player, and match rating. It authenticates through Wrangler's interactive login. For headless runs, set a Cloudflare application programming interface token with database edit scope.

The Worker tail vantage streams live Cloudflare Worker and Durable Object logs in JSON format, including Cloudflare metadata. It also authenticates through Wrangler login. Important: the tail output captures real client IP addresses, geolocation data, and TLS fingerprints, so never paste the raw output anywhere shared.

The Cloudflare dashboard logs view shows historical persisted logs — observability is enabled in the Wrangler configuration. You reach it through dashboard access. Wrangler version four has no command-line interface for historical queries, so the dashboard is the canonical path.

The R2 object inspection vantage uses Wrangler's R2-object-get command on the match archive bucket to read replay JSON and archive payloads. Bulk listing is not a command-line primitive in Wrangler version four, so use the dashboard or a throwaway Worker route instead.

Tooling is layered: confirm something looks wrong from one vantage, then triangulate with another. A bug confirmed by browser observation and agent Model Context Protocol observation and a Worker tail log line is dramatically less likely to be a misread than any single source.

## Lenses (what to look for)

A lens is a question to keep mentally active while exploring. Strong lenses force you to notice things you would otherwise filter out. The ten lenses that have produced the most findings:

Validation gaps. Does every input boundary actually validate? Probe with empty, oversize, wrong-type, unknown-enum, and Unicode payloads.

Documentation versus behaviour drift. Do the well-known agent manifest, the agent playbook, the agents page, the play skill, and the manual test plan all say the same thing the engine actually does?

State invariants under failure. What happens if the WebSocket drops mid-phase? If the wait-for-turn call times out? If the user navigates away mid-game? If both seats disconnect?

Ergonomics for agents. Can a large language model agent parse the response without re-deriving geometry? Are error shapes self-describing? Are there enough labelled candidates to choose from?

Personally identifiable information and privacy surface. What user-typed strings end up in public application programming interfaces, logs, replays, and archives? Are IP addresses hashed where they should be? Is anything inadvertently long-lived?

Cost and abuse surface. Are rate limits enforced where the documentation says they are? Can a single client churn Durable Objects, fill R2, or spam telemetry?

Cross-vantage consistency. Does the browser heads-up display show the same turn, phase, and active player as the Model Context Protocol observation, the database row, and the tail log line at the same instant?

Mobile and accessibility. Does the single-page application reflow at a three-hundred-and-seventy-five-pixel viewport? Does prefers-reduced-motion or prefers-contrast actually take effect? Can keyboard-only users complete a turn?

Recovery surface. Reload mid-game — does state restore correctly? Two tabs on the same player — what wins? A stale share-code query parameter — graceful?

Public-discovery surprises. Is anything indexable, cacheable, or Wayback-archivable that shouldn't be?

## Probe recipes

Concrete techniques. Combine freely — most yield more findings when chained.

### R1. Public API surface scan

Sweep documented and undocumented paths in one shot. Look for unexpected two-hundred responses, which indicate leakage. Look for unexpected four-oh-four responses, which indicate broken documentation. Look for verbose error bodies, which indicate information disclosure. A small shell loop that issues head requests against roughly a dozen candidate paths — the agent manifest, the playbook, the agents page, the how-to-play page, the leaderboard, the sitemap, the robots file, the manifest, the favicon, the metrics endpoint, the health-check endpoints, and so on — prints a status code next to each path for quick eyeballing.

### R2. Endpoint filter and validation probing

For every documented query parameter, send a deliberately wrong value and check the response. Silent acceptance is the bug. Probe the match list endpoint with a nonsense scenario or an absurd limit. Probe the token-issue endpoint with a mis-prefixed player key.

For state-changing POST endpoints, test rate limits and payload validation as a pair — they are often filed together because both sides of the same boundary are involved. A burst test issues thirty concurrent requests and counts successes versus four-twenty-nines, comparing against the documented limit. A payload-validation test sends empty bodies, fake values, and five-kilobyte strings.

Cloudflare's rate-limits binding is per-edge-colo and best-effort — observed limits will exceed the documented per-IP cap by five to ten times, sometimes more. That is a documentation bug worth filing whenever the gap is large. If the application programming interface silently coerces, ignores, or accepts garbage, log a finding.

### R3. Doc-consistency sweep

Compare the same fact across all sources of truth. Check the agent manifest's scenarios list against the lobby's scenario select and against the simulation harness's all-scenarios run. Check the playbook's phase-action map — specifically whether each phase is simultaneous — against the play skill's "I go, you go" claims and against observed activePlayer cycling. Check the manual test plan's release-gate phrasing against current actual behaviour. And fetch every badge, screenshot, and link in the main readme to confirm they still return a two-hundred.

### R4. Database and object-storage cross-check during a session

Open one terminal with the Worker tail in JSON format, and in another re-run a short SQL snapshot query a few times during and after a match. The snapshot query counts event types in the last ten minutes and orders by frequency.

Then play one match end-to-end via the browser or through Model Context Protocol. Watch three things. Telemetry counts should climb in the order the engine emits them — create, join, game-started, action-submitted, and so on — as described in the observability event catalogue. The Worker tail should emit a request line per HTTP call and a Durable Object line per console-log output; quiet phases that should be busy, or vice versa, are findings. After game-over, exactly one match-archive row should appear, at most one match-rating row, and an R2 object at the matches prefix keyed by the game identifier.

Discrepancies — missing rows, double writes, mismatched counts, log lines that don't correspond to any event — are findings.

### R5. MCP edge cases

Run against a connected session, or with a fabricated session identifier to exercise rejection paths. Send actions with: unknown ship identifiers, wrong phase, malformed orders array, oversize cargo, empty attacker identifiers. Send a chat with a text field of five hundred characters — it should be rejected at the two-hundred-character limit. Send a get-observation call with a nonsense session identifier — check the error shape. Send a quick-match-connect call with a nonsense scenario — see if validation happens at queue time. After a wait-for-turn timeout, call get-state with the same session identifier — verify the session is still queryable, or, if the current behaviour drops it, verify that is intentional versus a footgun worth a backlog entry.

### R6. MCP-versus-browser pairing without disturbing real users

The public quick-match queue contains real humans. Two intended pair-mates can be split across other players. Two safer options: pair the Model Context Protocol and browser seats on a less popular scenario like grand tour or interplanetary war, where the queue is usually empty — still not guaranteed. Or use a private match by code — better, but not currently exposed by the local Model Context Protocol, as tracked in the backlog under match-isolation flag. Until that lands, prefer Play-versus-AI for any test that doesn't strictly require a second human-driven seat.

When you must use the public queue, time-box it to one match, surrender immediately if you accidentally pair with a real user, and never run automated turn loops against unknown opponents.

### R7. Browser scenario sweep via Play-versus-AI

For each scenario in the agent manifest, open the lobby, pick Play-versus-AI, pick Easy, and click the scenario card. Confirm the game launches without console errors. Step through one full turn — astrogation digit-1 plus Enter, then phase confirms — and watch for missing buttons, locked heads-up display, soft-locks, or layout overflow. Compare the objective copy, for example "Land on Mars" or "Destroy all enemies", against the scenario description in the manifest. Differences in objective phrasing or missing controls per scenario type are findings.

A tooling caveat for the Chrome Model Context Protocol console: the read-console-messages tool only captures messages emitted after the tool is first called in the session; messages from page load are missed. Workaround: call read-console-messages once with a throwaway pattern to start the listener, reload the page, then call again with the real pattern.

Another tooling caveat for long synchronous JavaScript loops: driving five or more scenario launches in one JavaScript-tool call frequently times out the Chrome DevTools Protocol with a forty-five-second timeout. Drive each scenario in a separate tool call instead.

### R8. Live observation during a paired match

In one window, run the Worker tail in JSON format filtered to Durable Object entries. In another, drive a match. Look at three things. Durable Object console-log lines — names, frequency, payload size; anything noisy is a performance or cost finding, and anything containing user-typed strings is a privacy finding. Exception traces — even ones that don't break gameplay. Durable Object request paths — do internal routes leak in any way?

### R9. Reconnect and disconnect surface

Mid-match in a browser tab: hard refresh — does the single-page application restore the same turn, phase, and selected ship? Open the same match universal resource locator in a second tab — what wins? Does the server enforce one socket per player token? Toggle airplane mode for thirty seconds, then reconnect — does the WebSocket auto-recover, or does the user have to reload? For the Model Context Protocol: kill the standard-input-output server, restart it, try get-state with the old session identifier.

### R10. Mobile and accessibility triangulation

Resize the browser to three-hundred-and-seventy-five by eight-hundred-and-twelve pixels — an iPhone 13 viewport — and re-run the scenario sweep on at least one scenario. In DevTools Rendering, emulate prefers-contrast more and prefers-reduced-motion. Tab-only navigate through the lobby and one full astrogation phase. Cross-reference with the accessibility document and any open contrast-audit items in the backlog.

### R11. Fresh-start: wipe persisted data between runs

For a clean baseline — for example before measuring whether a regression introduces ghost rows, or after a destructive test — confirm no live matches first, then truncate the D1 tables and the R2 archive bucket. Production-only. Confirm scope with the operator first; everything below is destructive and irreversible.

First, check that the live-matches endpoint returns an empty array. Then execute a single SQL block that deletes every row from match-rating, match-archive, player, and events.

R2 has no object-list subcommand in Wrangler version four — purge via the Cloudflare dashboard's delete-all-objects action on the bucket, via a temporary Worker route that uses the binding, or via rclone configured with R2 S3 credentials.

After the wipe, verify with the same snapshot query from the database-cross-check recipe — all four tables should report zero rows — and confirm the match-list, leaderboard, and live-match endpoints all return empty.

### R12. Doc-link fetch sweep

Walk every universal resource locator referenced from the main readme, the docs directory, the agent manifest, the playbook, and the agents page. Fetch each and confirm a two-hundred. Broken outbound links and four-oh-fours on documented internal paths — the original symptom that surfaced the missing health-check and sitemap endpoints in the first pass — are documentation-rot findings even when the underlying behaviour is unchanged.

### R13. Worker-tail exception triage

This was the single highest-yield probe in the April pass. Run the Worker tail in JSON format for the duration of a paired-match session, then post-filter for any chunk with a non-empty exceptions array. A short Python snippet splits the concatenated JSON stream by newlines between close-braces and open-braces, parses each chunk, and for each chunk prints every exception's name, message, and stack.

Even outcomes that look successful from the client side — game completed, archive landed — can mask thrown exceptions in Durable Object close handlers, alarm handlers, or async logging paths. The April pass surfaced a type error — "The Durable Object's code has been updated, this version can no longer access storage" — only because of this filter. Continuous delivery means every exploratory pass should include this recipe: a deploy may have just landed.

Also worth grepping for: any exception name other than expected error classes; any stack with async frames into archive, match-archive, or live-registry modules; any chunk with an exception outcome.

### R14. Client-side state audit

Open the single-page application in a fresh browser profile, complete one matchmaking-paired game and one Play-versus-AI game, then enumerate everything the client persisted: local-storage keys, session-storage keys, cookies, IndexedDB databases, Cache Storage entries, the registered service worker script, and the web manifest.

For each persisted blob, ask: who owns it? When does it get pruned? What happens if the device is shared? Does it contain anything user-typed — callsign, real-name pattern? Is any authentication credential stored in plaintext local-storage? The April pass surfaced unbounded growth of the match-tokens cache and a player-profile entry storing the raw callsign indefinitely.

### R16. Simulation-harness balance sweep

The simulation AI-versus-AI engine harness, as described in the simulation testing document, is the cheapest way to surface scenario-balance regressions without playing a hundred games by hand. Three representative runs: all scenarios at thirty games each under continuous-integration gates; a specific scenario at a hundred games for tighter signal; the same specific scenario with randomised starting seats to check seat-balance independence.

Read the per-scenario block: player-zero win percentage, player-one win percentage, draws or timeouts, and average turns. Useful triage rules. A player-zero or player-one win-rate outside the forty-to-sixty-percent band at a hundred games is a balance issue — the continuous-integration gate fires at forty-five to eighty-five percent for player zero, deliberately wide, but tighter thresholds catch real drift earlier. A timeout rate above five percent means the AI is stalemating — either the scenario lacks pressure or the turn cap is too short. An average-turn count below five means the scenario is being decided too quickly to be interesting; first-player edge dominates. Any engine-crash count above zero is a fail-closed result to file under architecture correctness.

The April sweep surfaced evacuation at ninety-six to three and duel at sixty to forty from this single command. Run before any AI heuristic change, and before any release.

### R15. Post-game pipeline cross-check

After each completed paired match, verify the data landed in all four persistence stores within about thirty seconds. First, capture the game identifier — from the live-match response or the close-loop send-action result. Then run four database and object-storage checks: match metadata in the match-archive table, Glicko-2 rating delta in the match-rating table, updated rows in the player table for anyone who played in the last two minutes, and the full event-stream archive in R2 at the matches prefix.

Plus the public surfaces: the match-list endpoint for recent matches, and the leaderboard endpoint including provisional players.

Any of these returning empty for a game that completed in the user interface is a finding — most likely a thrown exception from the Worker-tail triage recipe interrupted the archive cascade. The April pass found the match-archive row appeared eventually — after about ninety seconds, once the alarm path reconciled. Eventual archival is acceptable but worth measuring; missing archival is a bug.

## Workflow: probe, finding, backlog

The standard loop has seven steps. First, probe: run a recipe, or invent one. Capture the exact reproduction — universal resource locator, payload, response, console line, screenshot, game identifier. Second, triangulate: confirm from at least one other vantage. A finding seen from only one tool is one self-edit away from being a tool bug, not an app bug. Third, classify: correctness, ergonomics, privacy, performance, documentation rot, or interesting-but-not-actionable. Drop the last category. Fourth, decide on actionability: if a thirty-second inline fix exists and is clearly safe, fix it instead of filing. Otherwise, file. Fifth, file an entry in the backlog — most exploratory findings land in the agent and Model Context Protocol ergonomics section or the cost and abuse hardening section; pick by primary impact. Each entry needs a short noun-phrase heading, one to three paragraphs on what was observed and why it matters and suggested fixes, and a files line listing the likely files to edit. Sixth, cross-reference: if the finding came from a recipe, name the recipe in the entry — for example, "found via the endpoint validation probing recipe". This builds confidence that the recipe is worth keeping. Seventh, close the loop: when a backlog entry ships, the commit message should reference the recipe or finding, so future passes can reuse the technique.

For high-stakes findings — security, data loss, public personally identifiable information leak — surface them to the operator immediately rather than only filing.

## Anti-patterns

Things that have wasted exploratory time in past passes — don't repeat them.

Running on the public quick-match queue without time-boxing. You will pair with real users and disturb their match.

Using Worker-tail output verbatim in commits or chat. It contains real client IP addresses, geolocation data, and TLS fingerprints. Sanitise or summarise.

Trusting a single tool's observation. When the browser shows one thing and the agent Model Context Protocol shows another, confirm via Worker tail or the database before deciding which is wrong.

Letting the play skill drive a session you're observing. The skill is the system under test. If it makes a decision that masks a bug, you'll miss it. For probing, use raw send-action calls.

Long blocking wait-for-turn calls when the other seat may be slow. Local Model Context Protocol sessions can be sensitive to timeouts; prefer short timeouts — thirty seconds or less — and explicit retries, and check current behaviour in the backlog before committing to a long block.

Speculative git commits after exploratory edits. Exploratory passes usually shouldn't change source — only documentation, plus the occasional recipe-driven inline fix. If you find yourself editing engine code mid-pass, you switched modes; commit those changes separately, ideally on a dedicated branch.

Mass-purging production data without a paired live-matches check. The fresh-start recipe destroys real matches if any are in flight. Always verify zero live matches first, and confirm scope with the operator.

Adding interesting-but-not-actionable entries to the backlog. They drown out real items. If you can't write a fix, you don't have a finding yet — keep probing.

Forgetting that exploratory identities still persist in the database. Use the reserved non-public prefixes — QA, Bot, or Probe — for test callsigns. The leaderboard now filters them, but they remain queryable in operator tables and logs.

## Pass log

Append a one-line entry per pass recording the date, whether the operator was an agent or human, the scope of the pass, and the count of new backlog entries filed.

On the eighteenth of April 2026, an agent pass on Model Context Protocol and browser pairing, public application programming interface surface, scenario sweep, and documentation consistency filed nine new backlog entries.

On the nineteenth of April 2026, a series of agent passes produced further entries. A rate-limit verification, payload validation, and health-check audit pass filed five. A listing-endpoint silent-caps, leaderboard validation, join-metadata, auth-failure log silence, and validation shape consistency pass filed five. An end-to-end paired-match-to-leaderboard verification pass filed four, surfacing the Durable Object deploy-eviction crash, a misleading surrender error, a matchmaker double-pair, and leaderboard test pollution. A follow-up pass tracing the Durable Object eviction and auditing the progressive web app, tutorial, and local-storage filed three more, including favicon gaps and on-device personally identifiable information. A spectator and join-flow security pass filed four — unauthenticated seat-hijack, missing spectator mode, local-game reload loss, and partial filter validation. A combat and ordnance rules-conformance pass combined with a simulation balance sweep filed four — the evacuation imbalance, the duel and biplanetary first-player edge, and the grand-tour and fleet-action timeout rates. An AI-difficulty stratification and matchmaker-seat-assignment pass filed three. A post-fix sweep confirming evacuation rebalance and the seat-shuffle ship, plus a security-header and cross-origin audit, filed two. A match-history replay-link probe filed one. A final lobby-flows pass filed one.
