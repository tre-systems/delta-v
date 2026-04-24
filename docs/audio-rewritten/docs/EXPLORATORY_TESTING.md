# Exploratory Testing

A toolkit and technique catalogue for discovery-oriented testing — open-ended probes designed to surface bugs, documentation inconsistencies, edge cases, and ergonomics issues that pre-defined checklists miss.

This is not a release-gate checklist. For release verification use the manual test plan. For automated AI-versus-AI sweeps and load tests use the simulation testing guide. For recurring architecture and security review cycles use the review plan. For Cloudflare Worker and database internals when a probe surfaces something to triage, see the observability guide.

## When to run an exploratory pass

Run one after a milestone or significant refactor that changes user-visible surface — user interface, Model Context Protocol, or public application programming interface. Run one before a release when a feature crosses subsystem boundaries, for example fleet building combined with matchmaking and a leaderboard write. Run one on a quarterly cadence even when nothing has changed, to catch production drift, third-party breakage, and documentation rot. And run one whenever a real user report hints at a class of issues worth probing more broadly.

A pass typically takes sixty to a hundred and twenty minutes of agent or human time and should produce five to fifteen backlog entries — or none, if the surface is genuinely tight.

## Toolkit

Each vantage is a separate way to look at the running system. Use several per pass — single-vantage sessions miss too much.

The Browser MCP vantage, through Claude in Chrome, drives the deployed single-page application as a real user would. It lets you inspect the DOM, the console, and the network. Connect the browser extension and open the production site. Note that Chrome MCP has mobile-viewport limitations, covered in detail under the mobile layout recipe.

The Playwright preview vantage drives the local development server in a headless Chromium that honors viewport resize down to three hundred twenty pixels and respects preference-based media emulation. It is the only reliable way for an agent to exercise the responsive breakpoints at seven hundred sixty, six hundred forty, and four hundred twenty pixels. You start it with the preview-start tool, then use the preview resize, snapshot, screenshot, inspect, evaluate, and click tools. This vantage is essential for the mobile layout recipe.

The Local Agent MCP vantage uses standard input and output. It drives a seat programmatically and lets you inspect the raw observation, candidates, and tactical hints. You start it with the local MCP run script, as described in the MCP reference.

The Hosted Agent MCP vantage calls the same tools via streamable HTTP. It is useful for probing the deployed adapter and the agent-token flow. You mint an agent token through the token-issue endpoint, then send it as a bearer header on every Model Context Protocol call. The endpoint requires clients to accept both application JSON and text event-stream content types.

The Play skill is a higher-level autonomous play loop that sits on top of the agent Model Context Protocol. It is useful for smoke runs — but not for probing, as noted in the anti-patterns section.

The curl vantage hits public endpoints directly. Use it to probe the HTTP application programming interface surface, validation behaviour, and error shapes. The set of documented endpoints is in the well-known agent manifest.

The database query vantage uses Wrangler's database-execute command in remote mode. It lets you inspect or mutate the four main tables: events, match archive, player, and match rating. It authenticates through Wrangler's interactive login. For headless runs, set a Cloudflare application programming interface token with database edit scope.

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

Mobile and accessibility. At each declared breakpoint — seven hundred sixty, six hundred forty, and four hundred twenty pixel widths, plus the five hundred sixty pixel short-height rule — does every floating element stay fully visible and out of every other element's bounding box? That includes the heads-up display bar, the bottom-buttons row, the ship list, the game log, the minimap, the help and sound buttons, the phase alert, the tutorial tip, toasts, and the game-over panel. Can every interactive element be reached by an element-from-point lookup without a decoration stealing the click? Do safe-area inset offsets work on notched devices and in landscape? Do preferences for reduced motion or increased contrast actually take effect? Can keyboard-only users complete a turn?

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

### R10. Mobile layout sweep — overlap, obscuration, and safe-area

Mobile bugs dominate the commit history in this repository and they keep coming back. Every user-interface change is a chance to re-introduce heads-up-display overlap, bottom-bar obscuration, or a button pushed behind a notch. Ship mobile as deliberately as you ship engine rules.

Setup is Playwright preview only. Chrome MCP cannot shrink its window below the host display's minimum — roughly twelve hundred sixty pixels on a fourteen-inch laptop — so the media query for widths up to seven hundred sixty pixels never evaluates true and the responsive breakpoints never fire. Synthetic media-query change events do not route to the change-event handlers either. So: use the Playwright preview MCP or human DevTools device emulation, and never file a mobile finding from Chrome MCP alone.

The core loop is: start preview, evaluate any navigation or state priming, resize the viewport to the target width and height, take a structural snapshot, and take a screenshot for visual proof.

Viewport matrix. At minimum, step through every CSS breakpoint boundary and one real device on each side — missing the boundary misses bugs that live only in the single-pixel band between rules.

The recommended cells include: three hundred twenty by five hundred sixty-eight for the smallest realistic portrait such as the original iPhone SE, which hits the four-twenty, six-forty, and seven-sixty rules. Three hundred sixty by six hundred forty for a common low-end Android, which sits just above four-twenty and hits six-forty and seven-sixty. Three hundred seventy-five by six hundred sixty-seven for an iPhone SE second or third generation or iPhone 8. Three hundred seventy-five by eight hundred twelve for a notched iPhone 13 or 14. Four hundred fourteen by eight hundred ninety-six for iPhone 11 Pro Max. Four hundred nineteen by eight hundred, which is one pixel below the four-twenty rule, to verify the tiny-phone rules. Four hundred twenty-one by eight hundred, which is one pixel above the four-twenty rule, to verify the six-forty rules without tiny overrides. Six hundred thirty-nine by eight hundred, one pixel below the six-forty rule. Six hundred forty-one by eight hundred, one pixel above it, to verify the band where the minimum-width-six-forty-one and maximum-width-seven-sixty rules overlap. Seven hundred fifty-nine by nine hundred for the last narrow layout. Seven hundred sixty-one by nine hundred where desktop layout just kicks in. Eight hundred twelve by three hundred seventy-five for iPhone landscape, which triggers the maximum-height-five-sixty rules. Six hundred forty by four hundred eighty for the narrow-and-short combination. And ten twenty-four by thirteen sixty-six for an iPad portrait regression check, which should still look desktop-like.

Across every cell, run four checks, and paste each failure into the finding with the exact viewport.

Check one is programmatic overlap detection. Run a small script in the preview evaluate tool that collects the bounding rectangles of every heads-up-display floater and interactive element, skipping hidden elements and elements with opacity zero, then flags any pairwise intersection with area greater than two square pixels that isn't a nested containment. Also flag any rectangle entirely outside the viewport. Any overlap entry with a non-trivial area is a finding; any off-screen entry with a non-cosmetic selector is a finding.

Check two is click reachability. For every primary button and heads-up-display control, confirm the visible pixel at its geometric centre routes clicks back to the element itself. A decorative overlay with higher z-index, or a moved safe area, can steal taps and produce a bug that the snapshot won't show. The script iterates each button, takes the centre coordinate of its bounding box, calls element-from-point, and flags any case where the hit target isn't the button or a descendant of it. An empty result means fine. Any entry means a control the user cannot tap.

Check three is safe area on notched and landscape devices. Playwright's Chromium does not produce real safe-area insets, but you can force them by setting CSS custom properties for top, bottom, left, and right insets directly on the root element. Then re-run checks one and two. Any new overlap or off-screen element at three seventy-five by eight hundred twelve is a finding: it will reproduce on a real iPhone even though you saw no bug at zero inset.

Check four is the virtual-keyboard and URL-bar collapse. iOS Safari and Android Chrome shrink the viewport when the address bar hides and again when a text input is focused. Simulate it by resizing the preview to the portrait height minus about one hundred to one hundred twenty pixels — for instance three seventy-five by seven hundred for iPhone 13 with the keyboard up. The lobby callsign input, chat input, and join-code input must remain visible and must not be covered by the heads-up-display bottom bar or phase alert.

Scenario and flow coverage. Per viewport, walk at minimum: the home menu through scenario select and difficulty — which checks menu padding and logo clipping. The lobby create-private flow to code reveal — where game-code letter spacing wraps on three-twenty if broken. Play versus AI for one full astrogation turn, which exercises the heads-up-display bar, bottom buttons, ship list, game log, minimap, and phase alert. Opening the help overlay mid-game to check stacking, backdrop, and close-button reachability. The game-over screen, where the four-twenty rules go edge-to-edge — verify no floating-panel border at three-twenty. The replay viewer, checking control-bar visibility during animated playback — archived replay was a recent regression. And the match history, leaderboard, and agents pages, each of which has its own media rules.

Other sensory checks. In the same preview tab, emulate the preference for more contrast and for reduced motion by setting a class on the root element, or by using the DevTools rendering panel in a headed browser. Then tab only through the lobby plus one astrogation phase. Cross-reference with the accessibility document.

Recent regression hotspots worth extra scrutiny: the floating exit, chat, and replay-exit overlap, which has been fixed and re-regressed repeatedly. The heads-up-display bottom bar versus utility buttons on narrow and short viewports. The ship list overlapping the minimap at the six-forty-one to seven-sixty band. The game-over edge-to-edge treatment at four-twenty and below. Safe-area insets for notched devices in landscape. And the installed progressive-web-app shell, where there is no URL bar — verify the inset math separately from the in-browser view.

### R11. Fresh-start: wipe persisted data between runs

For a clean baseline — for example before measuring whether a regression introduces ghost rows, or after a destructive test — confirm no live matches first, then truncate the database tables and the R2 archive bucket. Production-only. Confirm scope with the operator first; everything below is destructive and irreversible.

First, check that the live-matches endpoint returns an empty array. Then execute a single SQL block that deletes every row from match-rating, match-archive, player, and events.

R2 has no object-list subcommand in Wrangler version four — purge via the Cloudflare dashboard's delete-all-objects action on the bucket, via a temporary Worker route that uses the binding, or via rclone configured with R2 S3 credentials.

After the wipe, verify with the same snapshot query from the database-cross-check recipe — all four tables should report zero rows — and confirm the match-list, leaderboard, and live-match endpoints all return empty.

### R12. Doc-link fetch sweep

Walk every universal resource locator referenced from the main readme, the docs directory, the agent manifest, the playbook, and the agents page. Fetch each and confirm a two-hundred. Broken outbound links and four-oh-fours on documented internal paths — the original symptom that surfaced the missing health-check and sitemap endpoints in the first pass — are documentation-rot findings even when the underlying behaviour is unchanged.

### R13. Worker-tail exception triage

This was the single highest-yield probe in the April nineteenth pass. Run the Worker tail in JSON format for the duration of a paired-match session, then post-filter for any chunk with a non-empty exceptions array. A short Python snippet splits the concatenated JSON stream by newlines between close-braces and open-braces, parses each chunk, and for each chunk prints every exception's name, message, and stack.

Even outcomes that look successful from the client side — game completed, archive landed — can mask thrown exceptions in Durable Object close handlers, alarm handlers, or async logging paths. The April pass surfaced a type error — "The Durable Object's code has been updated, this version can no longer access storage" — only because of this filter. Continuous delivery means every exploratory pass should include this recipe: a deploy may have just landed.

Also worth grepping for: any exception name other than expected error classes; any stack with async frames into archive, match-archive, or live-registry modules; any chunk with an exception outcome.

### R14. Client-side state audit

Open the single-page application in a fresh browser profile, complete one matchmaking-paired game and one Play-versus-AI game, then enumerate everything the client persisted: local-storage keys, session-storage keys, cookies, IndexedDB databases, Cache Storage entries, the registered service worker script, and the web manifest.

For each persisted blob, ask: who owns it? When does it get pruned? What happens if the device is shared? Does it contain anything user-typed — callsign, real-name pattern? Is any authentication credential stored in plaintext local-storage? The April pass surfaced unbounded growth of the match-tokens cache and a player-profile entry storing the raw callsign indefinitely.

### R15. Post-game pipeline cross-check

After each completed paired match, verify the data landed in all four persistence stores within about thirty seconds. First, capture the game identifier — from the live-match response or the close-loop send-action result. Then run four database and object-storage checks: match metadata in the match-archive table, Glicko-2 rating delta in the match-rating table, updated rows in the player table for anyone who played in the last two minutes, and the full event-stream archive in R2 at the matches prefix.

Plus the public surfaces: the match-list endpoint for recent matches, and the leaderboard endpoint including provisional players.

Any of these returning empty for a game that completed in the user interface is a finding — most likely a thrown exception from the Worker-tail triage recipe interrupted the archive cascade. The April pass found the match-archive row appeared eventually — after about ninety seconds, once the alarm path reconciled. Eventual archival is acceptable but worth measuring; missing archival is a bug.

### R16. Simulation-harness balance and scorecard sweep

The simulation AI-versus-AI engine harness is the cheapest way to surface scenario-balance regressions and AI regressions without playing a hundred games by hand. Representative runs include: all nine scenarios at thirty games each under the continuous-integration gate; a specific scenario at one hundred games for tighter signal; the same specific scenario with randomised starting seats to check seat-balance independence; a duel sweep across many base seeds for pacing and seat balance; and a Grand Tour run with failure capture for later regression fixtures.

Each result now ships a scorecard in both text and JSON form. Read the scorecard before squinting at raw win rate. Useful triage rules follow.

A decided-game player-zero win rate outside forty to sixty percent at one hundred or more games is a balance issue. The continuous-integration bounds vary per scenario. Bi-planetary is deliberately wide — forty-five to eighty-five percent. Fleet Action is forty-five to eighty percent. Duel, Convoy, and Interplanetary War are thirty to seventy percent. Lunar Evacuation is thirty-five to sixty-five percent. Blockade Runner is twenty-five to sixty-five percent. Tighter local thresholds catch drift earlier than the continuous-integration gate does.

An invalid-action share greater than zero means the built-in AI submitted an engine-rejected order. The strict continuous-integration flag fails on this. On a soft run, capture the failure with the failure-capture flag and promote it to a focused fixtures regression.

A fuel-stalls-per-game count above zero point one means fueled ships are coasting instead of burning or landing. Capture a fixture.

A timeout share above five percent means the AI is stalemating — either the scenario lacks pressure or the turn cap is too short.

An objective share that is low relative to the fleet-elimination share, on a scenario with a non-elimination objective like Convoy, Lunar Evacuation, or Grand Tour, means scoring is biasing toward attrition rather than the intended objective.

Passenger delivery share trending down on Convoy or Lunar Evacuation means the passenger pipeline is regressing.

Grand Tour completion share trending down means the refuel or route planning logic is regressing.

An average-turn count below five means the scenario is decided too quickly; first-player edge dominates.

Any engine-crash count above zero is a fail-closed result to file under architecture correctness.

For AI pull requests, compare scorecards on paired seed sets before and after, rather than single runs. When a sweep exposes a bad state, capture it with the failure-capture flag to land a bounded game-state JSON in the AI fixtures folder, and add a decision-class regression test. Run the sweep before any AI heuristic change and before any release.

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

Filing bugs from programmatic clicks on hidden elements. A scripted click fires the handler regardless of whether the element is displayed, hidden, or zero-sized. Buttons a real user can never reach can still execute their handler from a test harness. Before filing a finding triggered by a DOM click, confirm the element is actually visible in the state you're probing. A hidden button with the wrong behaviour may still be a latent bug worth fixing, but classify it as such rather than as a user-visible regression.

Filing mobile-layout findings from Chrome MCP. The operating-system window cannot shrink below the display's minimum, so the mobile media queries never fire and the responsive breakpoints stay inert. Switch to the Playwright preview MCP or hand off to DevTools device emulation before filing.

Only testing at one so-called mobile viewport, typically three-seventy-five by eight-twelve. Delta-V has breakpoints at seven-sixty, six-forty, and four-twenty pixel widths, plus a five-sixty short-height rule, and a narrow-and-short combination. Three-seventy-five by eight-twelve exercises only a subset. The R10 matrix includes one-pixel boundary viewports specifically because overlap bugs hide in the single-pixel band between media rules. Skipping the boundary means shipping the band.

Treating one hundred viewport-height units as screen height. iOS Safari and Android Chrome include the collapsible URL bar in that measurement, so elements sized with it overflow on initial load and re-lay-out when the bar hides. If you see a one-time heads-up-display jump on first scroll, expect one hundred viewport-height units somewhere. Prefer the dynamic viewport-height unit or computed offsets anchored to safe-area insets. This is cheap to catch during the mobile sweep by scrolling once after load and re-running the overlap script.

## Pass log

Append a one-line entry per pass recording the date, whether the operator was an agent or human, the scope of the pass, and the count of new backlog entries filed.

On April eighteenth 2026, an agent pass on Model Context Protocol and browser pairing, public application programming interface surface, scenario sweep, and documentation consistency filed nine new backlog entries.

On April nineteenth 2026, a series of agent passes produced further entries. A rate-limit verification, payload validation, and health-check audit pass filed five. A listing-endpoint silent-caps, leaderboard validation, join-metadata, auth-failure log silence, and validation shape consistency pass filed five. An end-to-end paired-match-to-leaderboard verification pass filed four, surfacing the Durable Object deploy-eviction crash, a misleading surrender error, a matchmaker double-pair, and leaderboard test pollution. A follow-up pass tracing the Durable Object eviction and auditing the progressive web app, tutorial, and local-storage filed three more, including favicon gaps and on-device personally identifiable information. A spectator and join-flow security pass filed four — unauthenticated seat-hijack, missing spectator mode, local-game reload loss, and partial filter validation. A combat and ordnance rules-conformance pass combined with a simulation balance sweep filed four — the evacuation imbalance, the duel and biplanetary first-player edge, and the grand-tour and fleet-action timeout rates. An AI-difficulty stratification and matchmaker-seat-assignment pass filed three. A post-fix sweep confirming evacuation rebalance and the seat-shuffle ship, plus a security-header and cross-origin audit, filed two. A match-history replay-link probe filed one. A final lobby-flows pass filed one.

On April twenty-first 2026, a post-stream-two regression sweep covered Play-versus-AI flow, archived-replay playback, the client-state audit, a six-scenario sweep, hard-refresh reconnect, and the API surface and validation — filed zero new entries but surfaced the Chrome-MCP resize-emulation gap that is now documented in the mobile recipe, plus a replay-exit routing quirk that shipped the same day. A deep pass post-Stream-1 AI deploy covered external documentation links, a simulation balance sweep of all scenarios surfacing Grand Tour sixty-to-sixty timeouts and seat drift on evacuation, convoy, and fleet action, deeper validation probing for oversize, Unicode, and malformed JSON, source-versus-manifest description drift on four scenarios, hosted-MCP edge cases, and a live UI re-check of corner buttons and the replay exit — filed four new entries.

On April twenty-fourth 2026, an agent pass ran the first iteration of the revised mobile-layout recipe — surfacing a ship-entry name overflow at three-twenty — together with a simulation balance run that found bi-planetary at one hundred percent elimination and interplanetary war at one hundred ten fuel-stalls per game, a live API and validation probe where all parameters rejected cleanly, and a fifty-five-of-fifty-five documentation link sweep; the recipe's overlap-detection script was also inline-fixed to ignore zero-opacity elements. Two entries were filed.

Also on April twenty-fourth, a deep mobile sweep covered the menu, lobby, scenario select, in-game astrogation and fleet builder, help overlay, archived replay, and matches page, across three-twenty by five-sixty-eight, three-seventy-five by eight-twelve, and eight-twelve by three-seventy-five viewports. It surfaced and fixed fleet-status heads-up-display wrapping, ship-entry name wrapping, fleet-budget line reflow, replay-ended toast truncation, and landscape minimap clipping — one entry filed.

Also on April twenty-fourth, a multiplayer connectivity probe against local development covered create validation, join preflight, quick-match enqueue and polling, idempotent same-player tickets, paired WebSocket flow, reconnect with the stored player token, spectator mode, and protocol-frame abuse; core flows passed. One multiplayer-connectivity-diagnostics entry was filed covering six client-side error-ergonomics gaps.

Also on April twenty-fourth, further agent passes covered the security and abuse probe, an accessibility re-audit, a Model Context Protocol reliability probe, a dependency review, another rules-conformance check, a performance probe, and a privacy surface sweep. These passes continue to stress the same mobile, rate-limit, and archive pipelines that earlier passes surfaced, feeding targeted fixes rather than new blanket findings.
