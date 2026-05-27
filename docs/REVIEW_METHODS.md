# Review Methods

A reusable guide to the review system used on this project. Copy this structure
into other projects when you want reviews to be repeatable, parallelizable, and
useful beyond a single pull request.

The core idea is simple: a review is a named pass over a surface, with a clear
goal, bounded scope, concrete steps, evidence captured, and follow-up work filed
in the right place. Different review types answer different questions. Do not
turn every review into one giant release gate.

## Review Anatomy

Every review should define:

| Field | Purpose |
| --- | --- |
| **Goal** | The question this review answers. |
| **Trigger** | When to run it: every PR, before release, after deploy, quarterly, after incident, or on demand. |
| **Scope** | Files, features, routes, data stores, UI surfaces, or workflows included. |
| **Inputs** | Docs, specs, diagrams, diffs, logs, metrics, issue reports, or test data needed before starting. |
| **Steps** | Concrete commands, probes, checklists, or questions. |
| **Pass criteria** | What "good enough" means for this pass. |
| **Evidence** | Links, screenshots, logs, command output summaries, query results, or reproduction notes. |
| **Output** | Approval, comments, backlog items, doc updates, release notes, or incident follow-up. |
| **Owner** | The person or role responsible for running the pass and closing follow-up. |

Keep the review output short enough that someone can act on it. Long raw logs
belong in artifacts; the review should contain the conclusion and the evidence
needed to verify it.

## Review Types

### 1. Change Review

**Question:** Is this proposed change correct, maintainable, and appropriately
tested?

Run this for every pull request or patch.

How to do it:

1. Read the stated intent before reading the diff.
2. Inspect the changed files and the closest caller/callee context.
3. Check behavior, edge cases, failure modes, and tests before style.
4. Verify that docs, migrations, protocol schemas, or config were updated when
   the behavior changed.
5. Leave findings that are specific, reproducible, and tied to file/line
   context.
6. Separate blocking correctness issues from non-blocking suggestions.

Good findings include:

- The impact if the issue ships.
- The exact path or input that triggers it.
- The smallest useful fix direction, without rewriting the author's patch in
  the comment.

Avoid using change review as the only quality system. It is strong for local
diff risk and weak for drift, production behavior, and cross-cutting concerns.

### 2. Design Review

**Question:** Is the proposed approach coherent before implementation cost is
spent?

Run this before large features, new integrations, data model changes, migrations,
public API changes, or cross-team interfaces.

How to do it:

1. Write the problem statement, non-goals, constraints, and alternatives.
2. Identify ownership boundaries and long-lived contracts.
3. Review data flow, failure modes, migration path, compatibility, and rollback.
4. Ask what must remain true if the implementation is replaced later.
5. Record decisions in the owner doc, not only in chat or a ticket.

The useful output is not "approved architecture." It is a short decision record:
what was chosen, why, what was rejected, and what follow-up review will prove the
choice worked.

### 3. Test Plan Review

**Question:** Does the planned verification match the risk of the change?

Run this before complex implementation work finishes, especially when tests span
unit, integration, browser, simulation, data, or manual checks.

How to do it:

1. List the behavior being protected.
2. Map each risk to the cheapest reliable verification layer.
3. Check that positive, negative, boundary, and regression cases are covered.
4. Mark any human-only checks explicitly.
5. Decide which checks are required before merge and which can be post-deploy
   monitoring.

The review should prevent both under-testing and wasteful over-testing. A small
pure function might need focused unit tests only. A protocol or persistence
change usually needs unit tests, compatibility checks, docs, and a post-deploy
probe.

### 4. Release Review

**Question:** Is this build ready to ship?

Run this before a release candidate, public launch, migration, or coordinated
deployment.

How to do it:

1. Start from a release checklist, not an open-ended exploration.
2. Confirm clean automated gates: lint, typecheck, tests, build, migrations, and
   smoke tests.
3. Run the critical manual workflows for the product.
4. Verify compatibility for public APIs, persisted data, clients, and external
   integrations.
5. Confirm observability, rollback, and incident contacts before deployment.
6. Record explicit go/no-go status and any accepted risk.

Release reviews should be boring. If they keep discovering broad unknowns,
promote those areas into recurring or exploratory reviews so release day does not
become the first serious look.

### 5. Post-Deploy Review

**Question:** Did the deployed system behave correctly in the real environment?

Run this after deployment, especially after changes to routing, storage,
background jobs, auth, billing, telemetry, third-party integrations, or public
contracts.

How to do it:

1. Check health endpoints, version identifiers, and the expected deployed asset
   or commit.
2. Exercise one or two representative real workflows.
3. Watch logs, metrics, queues, scheduled jobs, and error reporting during those
   probes.
4. Compare live data writes with the intended schema and retention rules.
5. Record the deployment identifier, checks run, pass/fail status, and any
   follow-up.

Post-deploy review is not a substitute for pre-release testing. It catches
environment drift, config mistakes, missing permissions, edge behavior, and
third-party surprises.

### 6. Exploratory Review

**Question:** What important problems are we missing because no checklist asks
for them?

Run this after milestones, before major releases, when a user report hints at a
larger class of issue, or on a periodic cadence.

How to do it:

1. Pick a timebox and a lens, such as validation gaps, mobile layout, privacy
   surface, recovery flows, data consistency, or agent ergonomics.
2. Use multiple vantage points: UI, API, logs, database, docs, and metrics.
3. Follow curiosity, but keep notes precise enough to reproduce findings.
4. Triangulate suspicious behavior from at least two sources when possible.
5. Stop when the timebox ends, then convert real findings into backlog items.

Exploratory reviews are discovery tools, not pass/fail gates. A good pass may
produce no changes, a small doc correction, or several backlog items.

### 7. Recurring Cross-Cutting Review

**Question:** Has a broad quality area drifted since anyone last looked?

Run this monthly, quarterly, or after major architecture changes for areas that
do not fit neatly into feature work.

Common recurring areas:

- Security and abuse controls.
- Privacy and data retention.
- Observability and incident triage.
- Accessibility.
- Performance and bundle size.
- Dependency and supply-chain health.
- Documentation accuracy.
- Reliability and error handling.

How to do it:

1. Give each area its own self-contained checklist.
2. Include key files, commands, data queries, and docs to cross-check.
3. Make sections independent so multiple reviewers can run them in parallel.
4. Mark human-only steps explicitly.
5. Log date, reviewer, status, evidence, and follow-up item links.

Recurring reviews are where doc drift and slow system drift get caught. They
should be concrete enough that a new maintainer or coding agent can run them
without reconstructing the intent.

### 8. Security Review

**Question:** Can the system be abused, bypassed, or made to expose sensitive
data?

Run this for auth changes, public endpoints, user-generated content, storage,
payments, admin tooling, secrets, and periodically for the whole system.

How to do it:

1. Identify trust boundaries: browser, API, worker, database, queues, object
   storage, admin tools, and third-party services.
2. Probe input validation, authorization, rate limits, replay behavior, and
   error shapes.
3. Check secrets handling, logging, retention, and access controls.
4. Review dangerous operations separately: deletion, migration, export,
   impersonation, refund, and permission grant flows.
5. File findings with severity, exploit path, affected data or capability, and
   mitigation.

Do not bury security findings inside general cleanup notes. They need explicit
ownership and closure.

### 9. Privacy and Data Review

**Question:** Do we know what data is stored, why, where, for how long, and who
can see it?

Run this for telemetry, analytics, accounts, profiles, chat, uploads, logs,
exports, support tooling, and data retention changes.

How to do it:

1. Inventory collected fields and derived identifiers.
2. Trace where each field is stored, logged, exported, displayed, and deleted.
3. Compare implementation against privacy docs and user-facing claims.
4. Check minimization, retention, redaction, and access boundaries.
5. Treat legal policy as separate from technical truth; the review verifies the
   system behavior.

The best output is a maintained technical data map plus backlog items for any
undocumented, unnecessary, or over-retained data.

### 10. Accessibility Review

**Question:** Can people with different input, vision, motion, and assistive
technology needs use the product?

Run this for UI changes and periodically for the main workflows.

How to do it:

1. Run automated checks for the DOM surfaces they can cover.
2. Navigate the critical flows with keyboard only.
3. Check focus order, focus traps, labels, headings, announcements, color
   contrast, reduced motion, zoom, and responsive layout.
4. Verify modals, toasts, errors, loading states, and dynamic content.
5. Mark any canvas, custom control, or media experience that needs human review.

Automated accessibility checks are useful but incomplete. Manual keyboard and
screen-reader-oriented passes are part of the review, not extras.

### 11. Performance Review

**Question:** Did the system stay fast and cheap enough under realistic use?

Run this for rendering, hot paths, query changes, new dependencies, background
jobs, payload growth, startup time, and high-traffic surfaces.

How to do it:

1. Define the budget: latency, memory, CPU, bundle size, query count, queue lag,
   or cost.
2. Measure the current path with representative data.
3. Compare against a baseline and explain material changes.
4. Inspect dependency additions and payload size.
5. Record the budget, measurement method, result, and follow-up threshold.

Performance review without a budget becomes opinion. Start with the budget, then
measure.

### 12. Documentation Review

**Question:** Do the docs match the system that exists now?

Run this for public API changes, setup changes, operational procedures, user
workflows, release processes, and periodically for owner docs.

How to do it:

1. Identify the canonical owner doc for the topic.
2. Compare docs against code, commands, routes, schemas, and observed behavior.
3. Check internal links, examples, setup steps, and stale screenshots.
4. Remove duplicated explanations or replace them with links to the owner doc.
5. Update docs in the same change as behavior when possible.

Documentation review is not copy editing first. Accuracy, ownership, and
operational usefulness matter more than prose polish.

### 13. Incident Review

**Question:** What happened, what did users experience, and what will prevent or
detect a recurrence?

Run this after outages, data issues, security incidents, severe regressions, or
near misses.

How to do it:

1. Build a timeline from deploys, alerts, logs, metrics, user reports, and
   mitigations.
2. State impact in user and business terms.
3. Identify contributing factors without making blame the artifact.
4. Separate immediate fixes from systemic follow-up.
5. Create owners and due dates for prevention, detection, and response items.

The output should be useful months later. Include enough context that a future
reviewer can see why the follow-up work mattered.

## Running a Review

Use this general workflow for any review type:

1. **Prepare.** Read the owner doc, recent changes, open bugs, and previous
   review log.
2. **Constrain.** State the scope and timebox before starting.
3. **Probe.** Run the checklist, commands, manual steps, or exploratory recipes.
4. **Triangulate.** Confirm surprising findings through another path when
   practical.
5. **Record.** Capture evidence, status, and exact follow-up.
6. **File.** Put actionable work in the backlog or issue tracker, not only in
   the review notes.
7. **Close.** Mark pass, fail, partial, or not run, with the reason.

## Finding Format

Use a consistent format so findings can move from review notes to backlog or
issues without translation:

```text
Title:
Severity:
Surface:
Impact:
Evidence:
Reproduction:
Expected:
Actual:
Suggested next step:
Owner:
```

Severity should reflect user impact, data risk, security exposure, operational
cost, and likelihood. Do not inflate severity because a fix is annoying, and do
not deflate it because the bug is old.

## Review Log Format

For recurring or exploratory reviews, keep a compact log:

| Date | Reviewer | Review | Scope | Status | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-26 | Example | Post-deploy | API routes and logs | pass | health checks, smoke flow, zero new errors | none |

Use statuses consistently:

- **pass:** The review ran and met its pass criteria.
- **fail:** The review ran and found a blocking issue.
- **partial:** The review ran but skipped known scope.
- **not run:** The review was planned but did not happen.

## Choosing the Right Review

| Situation | Best review |
| --- | --- |
| Small code change | Change review plus targeted tests |
| New architecture or integration | Design review, then test plan review |
| Public API, schema, or persisted data change | Design review, test plan review, release review, post-deploy review |
| UI workflow change | Change review, accessibility review, manual QA, exploratory review if cross-cutting |
| Security-sensitive endpoint | Security review plus change review |
| Telemetry, account, or logging change | Privacy and data review |
| Slow drift or unknown unknowns | Recurring cross-cutting review or exploratory review |
| Production incident | Incident review, then recurring checklist update if needed |

## Making Reviews Portable

When adapting this system to another project:

1. Create one document that names the review types and owners.
2. Create separate checklist documents only for reviews that are run repeatedly.
3. Keep each checklist self-contained: commands, files, expected outputs, and
   pass criteria.
4. Put active work in the backlog or issue tracker, not in the checklist body.
5. Add a short review log for recurring passes.
6. Revisit the checklists after incidents and after reviews that produce too many
   ambiguous findings.

The system works when a reviewer can pick a review type, run it without oral
history, and leave behind evidence that makes the next review easier.
