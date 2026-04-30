# Delta-V Backlog

This chapter is the named home for outstanding tasks between pull requests. Shipped work belongs in the git log, recurring review procedures live in the review-plan chapter, architectural rationale lives in the architecture chapter, and exploratory-pass technique lives in the exploratory-testing chapter.

The backlog was last reviewed on April 28, 2026. Sections are grouped by priority and trigger rather than by historical review thread.

## Active priority

### Improve passenger-objective artificial intelligence

Convoy and Lunar Evacuation are the remaining high-value artificial-intelligence tuning targets. Recent engine work made passenger objective failure explicit, so these scenarios now end for the right reason instead of drifting into cleanup fleet-elimination endings. The remaining problem is behavior: protect or intercept the passenger carrier well enough that the intended passenger objective produces credible play.

The current April 28 checks show the shape of the work. Convoy samples at forty, eighty, and two hundred games delivered passengers roughly one quarter to one third of the time, with objective resolutions around two thirds to seventy percent and no invalid actions, transfer mistakes, timeouts, or fuel stalls in the larger samples. Lunar Evacuation samples at forty and eighty games delivered passengers around three quarters to four fifths of the time, resolved one hundred percent by objective, and averaged just over two turns, with no invalid actions or fuel stalls.

The next action is to keep promoting representative convoy and evacuation captures into fixtures, then improve carrier survival, raider interception, and landing-safe abort or refuel choices through named plans or bounded movement planning. Recent work taught the emergency escort look-ahead to avoid carrier courses that become crash-doomed if the carrier is disabled on the following combat pass. The next useful slice is reducing the remaining convoy fleet-elimination drift without undoing the higher two-hundred-game passenger delivery rate.

Do not add broad scalar weights without a fixture proving the change generalizes. For convoy failure capture, include both passenger-objective failure and objective drift so carrier-loss states and fleet-elimination drift are both visible.

Acceptance: paired scorecards should improve passenger delivery quality or reduce fleet-elimination drift without increasing invalid actions, fuel stalls, passenger-transfer mistakes, or timeout-heavy stalemates.

### Maintain the fixture-backed artificial-intelligence workflow

This is the guardrail for future artificial-intelligence fixes, not a standalone refactor project. When a bad decision repeats across seeds, capture the state and add a decision-class regression such as "land to refuel", "preserve passenger carrier", "screen instead of chasing attrition", or "do not coast while stalled". Avoid exact burn assertions unless the rules require them.

Add a new failure counter only when the current scorecard or capture manifest misses a recurring symptom. Pure tuning belongs in existing counters.

## Opportunistic polish

### Small accessibility polish

The April 24 accessibility re-audit, including an axe pass and a manual phone-size sweep, passed the baseline. Future accessibility work should stay limited to small, low-risk fixes that preserve the game's feel and visual language. Full keyboard tactical play on the canvas board remains explicitly out of scope per the accessibility chapter, and broader reduced-motion or heads-up-display scale changes should wait for a specific player need rather than being pursued as generic compliance work.

Candidate small fixes are modal keyboard tidiness as new overlays are added, clear focus rings and accessible names on new controls, and focused axe or manual checks when touching menu, heads-up display, help, game-over, or reconnect surfaces.

### Leaderboard-row-click telemetry

Add a leaderboard-row-clicked event when leaderboard rows become interactive. Do not add telemetry for inert rows.

## Future features

These items depend on product decisions or external triggers. They are not in the active queue.

### Web application firewall or Cloudflare rate-limit binding for read probes

Trigger this work if distributed scans wake Durable Objects or cost too much. The April 24 pass confirmed that join, replay, leaderboard, leaderboard-me, and matches read paths use only the per-isolate join-probe or replay-probe fallback maps. The Cloudflare rate-limit namespaces in the Wrangler configuration cover create, telemetry, error, and MCP only. A distributed scan cycling edge locations can therefore multiply the nominal one-hundred-per-minute join-probe quota by the number of isolates it hits.

Baseline per-isolate rate limiting is already shipped. Add a web application firewall or additional Cloudflare rate-limit namespaces when distributed read-path activity becomes visible in metrics, or proactively if a monthly billing alert fires.

### Cloudflare Turnstile on human name claim

Trigger this work if logs show bulk human name-claim posts, or if the beta opens to a larger audience.

Add Turnstile verification to the human claim-name endpoint while preserving the existing success path.

### OpenClaw skill document on ClawHub

Trigger this work when the OpenClaw platform is ready for external skill publishing.

Publish a skill document gated on a Delta-V agent-token environment variable so OpenClaw agents can auto-acquire Delta-V capability.
