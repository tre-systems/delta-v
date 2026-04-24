# Cross-Cutting Review Plan

A recurring checklist for reviewing aspects of Delta-V not covered by day-to-day feature work. Concrete follow-up work belongs in the backlog document.

How to use: pick a section, run the steps, and update the review log with the date and status — either pass, fail with a backlog item, or partial.

When to run: after major architecture, protocol, or deployment changes; before release candidates; or on a periodic cadence such as monthly or quarterly.

All sections are independent and self-contained, so they can be run concurrently by separate agents with no ordering dependencies between them.

Items that require a human reviewer are marked with the Human tag. Everything else is agent-executable.

Related documents include the architecture guide, the security guide, the backlog, and the manual test plan.

---

## 1. CI and local development friction

Goal: pre-commit, pre-push, and continuous integration run cleanly; no hooks need skipping.

Steps:

1. Run the full verify command end-to-end. Pass: exits cleanly with no errors. Fail: file a backlog item with the failing step and error message.
2. Run the test coverage command three times in a row. Pass: both sequential coverage passes exit cleanly every time, with reports under the coverage-client and coverage-server-shared directories, and no file-not-found temp-file failures. Fail: inspect the split coverage configs and any unexpected writes into a shared coverage temp path.
3. Run the pre-push hook with a dev server already bound to port 8787. Pass: the end-to-end tests use the dynamically selected end-to-end port and do not conflict. Fail: check the free-port logic in the pre-push hook.
4. Check that the contributing guide documents what pre-commit runs, what pre-push runs, what to do when either fails, and the verify command. Pass: all four are covered. Fail: update the doc.

---

## 2. Observability, data lifecycle, and privacy

Goal: know what is stored, how long it lives, and whether the implementation matches the documentation.

Scope: this review covers the database tables for events and match archives, the object store for match files, Durable Object ephemeral storage, client telemetry, anonymous identifiers, IP hashes, user-agent strings, and chat text.

Steps:

1. Read the insert-event function in the server reporting module and the database migrations; list every event type written to the database. Cross-check against the observability documentation. Pass: the doc lists all event types. Fail: update the doc.
2. Read the client telemetry module; list every telemetry payload shape sent from the client. Cross-check against the observability documentation. Pass: the doc lists all payloads. Fail: update the doc.
3. Read the match archive module; confirm the object-storage key pattern and what data is stored. Cross-check against the data retention section of the security documentation. Pass: the retention policy matches the implementation. Fail: update the doc or file a backlog item.
4. Search for anonymous ID, IP hash, user-agent, and chat references across the source directory; list every location where personally identifiable information or user-generated content is persisted. Cross-check against the privacy technical documentation. Pass: no undocumented PII storage. Fail: update the doc.

---

## 3. Security posture

Goal: rate limiting, input validation, and trust boundaries match what the security documentation claims.

Steps:

1. Read the rate-limit constants in the WebSocket socket module — specifically the WebSocket message rate limit and the chat rate limit — and also read the rate-limit constants in the server reporting module, which cover game creation, join probes, replay probes, WebSocket connections, telemetry, and error reports. Cross-check all values against the security documentation. Pass: all values match. Fail: update the doc or the code.
2. Read the client-to-server message validation function in the shared protocol module. Confirm every client-to-server message type has validation. Pass: no unvalidated message types. Fail: add validation or file a backlog item.
3. Search for inner-HTML assignments outside the client DOM module. Pass: zero hits — the pre-commit hook also enforces this boundary. Fail: move any hits to use the trusted-HTML setter.
4. Search for uses of the built-in random function in the shared engine directory, excluding tests and injected default random-number-generator fallbacks. Pass: no remaining hits. Fail: replace with the injected random-number generator or narrow the exception intentionally.
5. Read the input-limit constants in the shared protocol module — covering maximum fleet purchases, maximum astrogation orders, maximum ordnance launches, and maximum combat attacks. Confirm they are enforced in runtime message validation before any engine dispatch. Pass: all limits are checked before any engine handler runs. Fail: add the missing validation or file a backlog item.
6. Check room-code generation in the server directory — confirm it uses a cryptographic random-number generator, not the built-in random. Pass: uses the Web Crypto API's get-random-values function or an equivalent. Fail: fix it.

---

## 4. Game engine correctness

Goal: engine rules match the specification; simulation does not surface logic errors.

Steps:

1. Run the simulation command for all scenarios with sixty iterations in continuous-integration mode — the canonical form that continuous integration, the full verify pass, and the pre-push hook all run, totalling sixty games across nine scenarios. Pass: exits cleanly with no engine errors in output. Fail: investigate the error details and file a backlog item.
2. Read the current rule-owning engine modules — covering astrogation, combat, logistics, ordnance, movement resolution, post-movement processing, turn advance, and victory — and include fleet building and game creation modules when scenario setup rules have changed. Cross-check phase transitions, post-movement resolution, and victory logic against the game specification. Pass: no contradictions. Fail: file a backlog item noting the specification versus implementation discrepancy.
3. Run the test coverage command. Check coverage for executable engine modules, ignoring type-only or re-export shims. Pass: no executable engine module is below eighty percent line coverage. Fail: identify untested branches and file a backlog item.

---

## 5. Error handling and resilience

Goal: disconnects, Durable Object alarm failures, and database or object-store errors do not crash games or lose state.

Steps:

1. Read the alarm and turn-timeout modules. Confirm every alarm handler has a try-catch block and reschedules on error rather than crashing. Pass: all paths are wrapped. Fail: add error handling.
2. Read the match archive module. Confirm that object-store put and get operations and database insert failures are caught and do not block gameplay. Pass: failures are fire-and-forget with logging. Fail: add error handling.
3. Read the WebSocket and socket modules. Confirm that invalid JSON is caught, rate-limited sockets are closed cleanly with the appropriate close code, and unhandled message errors return typed errors to the client. Pass: all three hold. Fail: add handling.
4. Read the disconnect and reconnect logic, including the grace period handler. Confirm a disconnected player can rejoin within the grace window and resume. Pass: state is preserved and resent on reconnect. Fail: file a backlog item.
5. Run the server Durable Object tests with verbose output. Pass: all pass. Fail: investigate.

---

## 6. Bundle weight and client runtime

Goal: know the cost of loading the client; avoid surprise regressions.

Steps:

1. Run the build command. Record the raw size and gzip-compressed size of the client bundle output. Pass: the gzip size is within twenty percent of the baseline recorded in the architecture documentation — roughly 397 kilobytes raw and 117 kilobytes gzipped now that the build minifies on every invocation. Fail: investigate new dependencies or dead code and file a backlog item.
2. Check for obvious runtime package imports by scanning client source files — excluding tests — for bare package import statements. Compare any hits against the package manifest and lock file changes since the last review. Pass: no unexpected new runtime dependencies in the client bundle path. Fail: evaluate whether the dependency is justified.

Human-only item: take a Chrome DevTools heap snapshot after twenty or more turns in a live game and check for unbounded growth. This requires a running game in a browser and cannot be automated.

---

## 7. Supply chain and release hygiene

Goal: predictable upgrades and a clear vulnerability response process.

Steps:

1. Run the npm security audit command. Pass: no high or critical vulnerabilities. Fail: fix the issue or document the accepted risk in the backlog.
2. Compare the Node version across the Node version manager configuration file, the package manifest engines field if set, and the continuous integration workflow. Pass: all match. Fail: align them.
3. Run the outdated packages command. Flag any dependencies more than two major versions behind their current release. Pass: nothing critically outdated. Fail: file a backlog item for the upgrade.

---

## Review log

The review log records each completed pass over a section. As of the early April 2026 review, all seven sections received a passing status with one exception: the bundle and runtime section was marked partial because the client bundle gzip size was within the baseline but the human-only heap profiling step remained outstanding.

Specific notes from that review:

- Section one, continuous integration and local dev friction: the full verify command exits cleanly; the pre-push dynamic-port end-to-end flow was confirmed working; the contributing guide was updated to document the hook splits and the text-search boundary checks.
- Section two, observability and privacy: documentation was synced to the current database event names, telemetry payload shapes, retention notes, and sample queries.
- Section three, security posture: all six checks passed — rate limits match the documentation, message validation is exhaustive, no inner-HTML or built-in-random leaks were found, and room codes use the cryptographic random-number generator.
- Section four, game engine correctness: the simulation command ran one hundred iterations in continuous-integration mode with zero crashes; the specification cross-check was clean; coverage for the combat and conflict modules was above eighty percent.
- Section five, error handling: one hundred thirty-four game Durable Object tests pass; the game alarm runner now has a top-level try-catch with reschedule; five new error-handling tests were added.
- Section six, bundle and runtime: the raw and gzipped client bundle sizes at the time were within the baseline; runtime heap profiling remains a human-only item.
- Section seven, supply chain: the security audit found zero vulnerabilities; no packages were two or more major versions behind; Node version twenty-five was consistent across the version manager file and continuous integration.

The most recent entry is a focused six-review sweep dated April 24, 2026, which passed and shipped the following fixes. The accessibility re-audit had the axe suite at eight out of eight, and focus traps on the game-over and reconnect overlays shipped. MCP reliability: five input-schema tightenings were filed. Dependency: a Hono override path landed, dev-only Vite advisories and a continuous-integration audit gap were filed. Rules conformance: four specification rules were verified; a rulebook-constants lock shipped — the rulebook-constants test now pins the velocity combat modifier threshold, the ordnance lifetime, the anti-nuke odds, and the asteroid other-damage table, so a rulebook change surfaces as a test failure rather than a balance drift — and the specification now documents torpedo lifetime as an accepted divergence, since torpedoes use the same five-turn self-destruct as mines and nukes. Performance: an unminified bundle of 860 kilobytes dropped to 397 kilobytes after minification shipped; a hashed-URL cache item at priority two remains open. Privacy: a salted IP-hash shipped — telemetry IP hashes are now salted with a production secret via the IP-hash-salt environment variable, production fails closed when it is missing, and historic hashes are not retroactively salted; anonymous-ID on the Forget-my-callsign flow and stack-trace scrubbing items remain open at priorities two and three. Cost and abuse: a Cloudflare-connecting-IP spoof item at priority one and a per-IP WebSocket and room concurrency cap at priority two were filed.

Next, decisions already recorded elsewhere that do not require recurring review:

- Internationalization: English-only, recorded in the architecture documentation.
- Protocol compatibility: same-version deploy model, recorded in the architecture documentation.
- Replay and simulation parity: covered by the coding standard.
- Accessibility: a human-only manual keyboard and screen-reader audit per the accessibility documentation; automated checks are available via the end-to-end accessibility test command.

---

## Caveats

- Numbers in the documentation — such as bundle size and Node version — are baselines that go stale. Update them alongside meaningful changes.
- Technical documentation is not a legal or compliance sign-off; counsel and public notices remain outside this repository.