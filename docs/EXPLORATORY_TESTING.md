# Exploratory Testing

A toolkit and technique catalogue for **discovery-oriented** testing — open-ended probes designed to surface bugs, doc inconsistencies, edge cases, and ergonomics issues that pre-defined checklists miss.

This is **not** a release-gate checklist. For release verification use [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md). For automated AI-vs-AI sweeps and load tests use [SIMULATION_TESTING.md](./SIMULATION_TESTING.md). For recurring architecture/security review cycles use [REVIEW_PLAN.md](./REVIEW_PLAN.md). For Worker / D1 internals when a probe surfaces something to triage, see [OBSERVABILITY.md](./OBSERVABILITY.md).

## When to run an exploratory pass

- After a milestone or significant refactor that changes user-visible surface (UI, MCP, public API).
- Before a release if a feature crosses subsystem boundaries (e.g. fleet building + matchmaking + leaderboard write).
- On a quarterly cadence even if nothing changed — production drift, third-party breakage, doc rot.
- Whenever a real user report hints at a class of issues worth probing more broadly.

A pass typically takes 60-120 minutes of agent or human time and should produce 5-15 backlog entries (or none, if the surface is genuinely tight).

## Contents

- [Toolkit](#toolkit)
- [Lenses](#lenses-what-to-look-for)
- [Probe recipes](#probe-recipes) — R1 surface scan · R2 validation · R3 doc consistency · R4 D1/R2 cross-check · R5 MCP edges · R6 safe pairing · R7 scenario sweep · R8 live observation · R9 reconnect · R10 mobile layout sweep · R11 fresh-start wipe · R12 doc-link sweep · R13 tail exception triage · R14 client-state audit · R15 post-game pipeline cross-check · R16 simulation-harness balance sweep
- [Workflow: probe, finding, backlog](#workflow-probe-finding-backlog)
- [Anti-patterns](#anti-patterns)
- [Pass log](#pass-log)

---

## Toolkit

Each row is a separate vantage point on the running system. Use multiple per pass — single-vantage sessions miss too much.

| Tool | Purpose | Setup |
|------|---------|-------|
| **Browser MCP** (Claude in Chrome) | Drive the *deployed* SPA as a real user; inspect DOM, console, network | Connect the extension; open https://delta-v.tre.systems. See R10 for mobile-viewport limitations. |
| **Playwright preview MCP** (`preview_*`) | Drive the *local dev server* in a headless Chromium that honours `preview_resize` down to 320 px and respects `prefers-*` media emulation via `preview_eval` — the only reliable way to exercise the `<=760 / <=640 / <=420` responsive breakpoints from an agent | `preview_start` spawns `npm run dev:watch`; use `preview_resize`, `preview_snapshot`, `preview_screenshot`, `preview_inspect`, `preview_eval`, `preview_click`. Essential for R10. |
| **Local agent MCP** (stdio) | Drive a seat programmatically; inspect raw observation, candidates, tactical hints | `npm run mcp:delta-v` (see [DELTA_V_MCP.md](./DELTA_V_MCP.md)) |
| **Hosted agent MCP** (`POST /mcp`) | Same surface as local but via streamable-HTTP; useful for probing the deployed adapter and the agent-token flow | `POST /api/agent-token` then `Authorization: Bearer <t>` on `/mcp` calls (see [AGENTS.md](./AGENTS.md)). Requires `Accept: application/json, text/event-stream`. |
| **Play skill** | Higher-level autonomous play loop sitting on top of agent MCP | `.claude/skills/play/SKILL.md` — useful for smoke runs, **not** for probing (see anti-patterns) |
| **`curl` against public endpoints** | Probe HTTP API surface, validation, error shapes | Anything documented in `/.well-known/agent.json` |
| **`wrangler d1 execute --remote`** | Inspect or mutate D1 tables (`events`, `match_archive`, `player`, `match_rating`) | OAuth via `wrangler login` (interactive). For headless runs, set `CLOUDFLARE_API_TOKEN` with `D1:Edit`. |
| **`wrangler tail delta-v --format json`** | Live Worker + DO logs with full CF metadata | OAuth via `wrangler login`. **Captures real client IPs, geo, TLS fingerprints** — never paste raw output anywhere shared. |
| **Cloudflare dashboard → Logs** | Historical persisted logs (observability is enabled in `wrangler.toml`) | Dashboard access. Wrangler 4.x has no CLI for historical query. |
| **R2 object inspection** | Replay JSON, archive payloads | `wrangler r2 object get delta-v-match-archive/matches/{gameId}.json --remote`. Bulk listing isn't a CLI primitive — use the dashboard or a throwaway Worker route. |

Tooling is layered: confirm something looks wrong from one vantage, then triangulate with another. A bug confirmed by browser observation **and** agent MCP observation **and** a `wrangler tail` line is dramatically less likely to be a misread than any single source.

---

## Lenses (what to look for)

A lens is a question to keep mentally active while exploring. Strong lenses force you to notice things you would otherwise filter out.

1. **Validation gaps.** Does every input boundary actually validate? Probe with empty / oversize / wrong-type / unknown-enum / Unicode payloads.
2. **Doc-vs-behaviour drift.** Does `/.well-known/agent.json`, `/agent-playbook.json`, `/agents`, the play skill, and `MANUAL_TEST_PLAN.md` say the same thing as the engine actually does?
3. **State invariants under failure.** What happens if the WebSocket drops mid-phase? If `wait_for_turn` times out? If the user navigates away mid-game? If both seats disconnect?
4. **Ergonomics for agents.** Can an LLM agent parse the response without re-deriving geometry? Are error shapes self-describing? Are there enough labelled candidates to choose from?
5. **PII / privacy surface.** What user-typed strings end up in public APIs, logs, replays, archives? Are IPs hashed where they should be? Is anything inadvertently long-lived?
6. **Cost / abuse surface.** Are rate limits enforced where the docs say? Can a single client churn DOs, fill R2, or spam telemetry?
7. **Cross-vantage consistency.** Does the browser HUD show the same turn/phase/active-player as the MCP observation, the D1 row, and the tail log line at the same instant?
8. **Mobile / a11y.** At each declared breakpoint (760 / 640 / 420 px widths and the 560 px short-height rule) does every floating element — HUD bar, bottom-buttons row, ship list, game log, minimap, help/sound buttons, phase alert, tutorial tip, toasts, game-over panel — stay fully visible **and** out of each other's bounding boxes? Can every interactive element be `elementFromPoint`-reached without a decoration stealing the click? Do `env(safe-area-inset-*)` offsets work on notched devices and in landscape? Does `prefers-reduced-motion` / `prefers-contrast` actually take effect? Can keyboard-only users complete a turn?
9. **Recovery surface.** Reload mid-game — does state restore correctly? Two-tab same player — what wins? Stale `?code=` URL — graceful?
10. **Public-discovery surprises.** Is anything indexable, cacheable, or Wayback-able that shouldn't be?

---

## Probe recipes

Concrete techniques. Combine freely — most yield more findings when chained.

### R1. Public API surface scan

Sweep documented and undocumented paths in one shot. Look for unexpected 200s (leakage), unexpected 404s (broken docs), and verbose error bodies (info disclosure).

```bash
for p in /.well-known/agent.json /agent-playbook.json /agents /how-to-play \
         /leaderboard /sitemap.xml /robots.txt /manifest.json /favicon.ico \
         /metrics /healthz /status /api/leaderboard /api/matches /ws; do
  printf "%s %s\n" "$(curl -s -o /dev/null -w '%{http_code}' https://delta-v.tre.systems$p)" "$p"
done
```

### R2. Endpoint filter / validation probing

For every documented query parameter, send a deliberately wrong value and check the response. Silent acceptance is the bug.

```bash
curl -s "https://delta-v.tre.systems/api/matches?scenario=nonexistent&limit=3" | python3 -m json.tool | head
curl -s "https://delta-v.tre.systems/api/matches?limit=99999" | python3 -m json.tool | head
curl -sX POST https://delta-v.tre.systems/api/agent-token \
  -H 'Content-Type: application/json' -d '{"playerKey":"human_x"}'   # wrong prefix
```

For state-changing POSTs, also test rate limits and payload validation as a pair — they're often filed together because both sides of the same boundary are involved:

```bash
# Burst test: count successes vs 429s. Compare against documented limit.
n=$(seq 1 30 | xargs -I{} -P10 curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST https://delta-v.tre.systems/create \
    -H 'Content-Type: application/json' -d '{"scenario":"duel"}' | sort | uniq -c)
echo "$n"

# Payload validation: empty, fake values, oversize.
curl -s -X POST https://delta-v.tre.systems/create -w "\n%{http_code}\n"
curl -s -X POST https://delta-v.tre.systems/create -H 'Content-Type: application/json' \
  -d '{"scenario":"definitely_not_a_real_scenario"}' -w "\n%{http_code}\n"
python3 -c "print('{\"scenario\":\"' + 'x'*5000 + '\"}')" | curl -s -X POST \
  https://delta-v.tre.systems/create -H 'Content-Type: application/json' \
  -d @- -w "\n%{http_code}\n"
```

Cloudflare's `[[ratelimits]]` binding is **per-edge-colo and best-effort** — observed limits will exceed the documented per-IP cap by 5-10x, sometimes more. That's a doc bug worth filing whenever the gap is large. If the API silently coerces / ignores / accepts garbage, log a finding.

### R3. Doc-consistency sweep

Compare the same fact across all sources of truth.

- `/.well-known/agent.json` `scenarios[]` vs the lobby's "Select Scenario" list vs `npm run simulate -- all` scenarios.
- `/agent-playbook.json` `phaseActionMap[*].simultaneous` vs `.claude/skills/play/SKILL.md` "I-Go-You-Go" claims vs observed `state.activePlayer` cycling.
- `MANUAL_TEST_PLAN.md` release-gate phrasing vs current actual behaviour.
- README badges, screenshots, and links — fetch each and confirm 200.

### R4. D1 / R2 cross-check during a session

Open one terminal with `wrangler tail delta-v --format json` and re-run this snapshot query a few times during/after a match:

```bash
npx wrangler d1 execute delta-v-telemetry --remote --command "
  SELECT event, COUNT(*) AS n
  FROM events
  WHERE ts > (strftime('%s','now','-10 minutes') * 1000)
  GROUP BY event
  ORDER BY n DESC;"
```

Then play one match end-to-end via browser or MCP. Watch:

- Telemetry counts climb in the order the engine emits them (create → join → game_started → action_submitted …; see [OBSERVABILITY.md](./OBSERVABILITY.md) for the full event catalogue).
- `wrangler tail` emits a request line per HTTP call and a DO line per `console.log` — quiet phases that should be busy (or vice versa) are findings.
- After `gameOver`, exactly one `match_archive` row appears (`SELECT * FROM match_archive ORDER BY completed_at DESC LIMIT 1;`), at most one `match_rating` row, and an R2 object at `matches/{gameId}.json`.

Discrepancies — missing rows, double-writes, mismatched counts, log lines that don't correspond to any event — are findings.

### R5. MCP edge cases

Run against a connected session OR with a fabricated `sessionId` to exercise rejection paths.

- Send actions with: unknown shipId, wrong phase, malformed orders array, oversize cargo, empty `attackerIds`.
- `delta_v_send_chat({ text: "x".repeat(500) })` → should be rejected at the 200-char limit.
- `delta_v_get_observation({ sessionId: "definitely-not-real" })` → check error shape.
- `delta_v_quick_match_connect({ scenario: "definitely-not-a-scenario" })` → see if validation happens at queue time.
- After `wait_for_turn` timeout, call `delta_v_get_state` with the same sessionId — verify the session is still queryable (or, if the current behaviour drops it, verify that's intentional vs a footgun worth a backlog entry).

### R6. MCP-vs-browser pairing without disturbing real users

The public Quick Match queue contains real humans. Two intended pair-mates can be split across other players. Two safer options:

- **Less popular scenario** — pair MCP and browser on `grandTour` or `interplanetaryWar`, where the queue is usually empty. Still not guaranteed.
- **Private match by code** — better, but **not currently exposed by local MCP** (see `BACKLOG.md` "Match-isolation flag"). Until then, prefer **Play vs AI** for any test that doesn't strictly require a second human-driven seat.

When you must use the public queue, time-box it (one match), surrender immediately if you accidentally pair with a real user, and never run automated turn loops against unknown opponents.

### R7. Browser scenario sweep via Play vs AI

For each scenario in `/.well-known/agent.json`:

1. Lobby → Play vs AI → Easy → click scenario card.
2. Confirm the game launches without console errors (`mcp__Claude_in_Chrome__read_console_messages` with pattern `error|exception`).
3. Step through one full turn (astrogation digit-1 + Enter, then phase confirms). Watch for missing buttons, locked HUD, soft-locks, layout overflow.
4. Compare the objective copy (`Land on Mars`, `Destroy all enemies`, …) against the scenario description in `agent.json`.

Differences in objective phrasing or missing controls per scenario type are findings.

**Tooling caveat — Chrome MCP console:** `read_console_messages` only captures messages emitted **after** the tool is first called in the session. Messages from page load are missed. Workaround: call `read_console_messages` once with a throwaway pattern (e.g. `^x$`) to start the listener, then reload the page, then call again with the real pattern.

**Tooling caveat — long synchronous JS loops:** driving 5+ scenario launches in one `javascript_tool` call frequently times out CDP (`Runtime.evaluate timed out after 45000ms`). Drive each scenario in a separate tool call instead.

### R8. Live observation during a paired match

In one window, `wrangler tail delta-v --format json --search GameDO`. In another, drive a match. Look at:

- DO `console.log` lines — names, frequency, payload size. Anything noisy is a perf/cost finding; anything containing user-typed strings is a privacy finding.
- Exception traces — even ones that don't break gameplay.
- DO request URLs — do internal routes leak in any way?

### R9. Reconnect / disconnect surface

Mid-match in a browser tab:

- Hard refresh — does the SPA restore the same turn/phase/selected ship?
- Open the same match URL in a second tab — what wins? Does the server enforce one socket per playerToken?
- Toggle airplane mode for 30s, then reconnect — does the WebSocket auto-recover, or does the user have to reload?
- For MCP: kill the stdio server, restart it, try `delta_v_get_state` with the old sessionId.

### R10. Mobile layout sweep (overlap, obscuration, safe-area)

Mobile bugs dominate the commit history in this repo and repeat — every UI change is a chance to re-introduce HUD overlap, bottom-bar obscuration, or a button pushed behind a notch. Ship mobile as deliberately as you ship engine rules.

**Setup — Playwright preview only.** Chrome MCP cannot shrink its window below the host display's minimum (~1260 px on a 14" laptop), so `window.matchMedia('(max-width: 760px)')` stays `false` and the responsive breakpoints never fire. Synthetic `MediaQueryListEvent('change')` does not route to `addEventListener('change', ...)` handlers. **Use the Playwright preview MCP or human DevTools device emulation; never file a mobile finding from Chrome MCP alone.**

```
preview_start                          # boots npm run dev:watch
preview_eval ({ ... })                 # navigate / prime state if needed
preview_resize  width=375  height=812  # iPhone 13 portrait
preview_snapshot                       # structural dump
preview_screenshot                     # visual proof
```

**Viewport matrix.** At minimum, step through **every CSS breakpoint boundary** and one real device on each side — missing the boundary misses bugs that live only in the 1-px band between rules in [static/styles/responsive.css](../static/styles/responsive.css).

| Width × height | Why | Breakpoint hit |
|---|---|---|
| 320 × 568 | iPhone SE 1st gen; smallest realistic portrait | `<=420`, `<=640`, `<=760` |
| 360 × 640 | Common low-end Android | `<=420` boundary (just above), `<=640`, `<=760` |
| 375 × 667 | iPhone SE 2/3, iPhone 8 | `<=640`, `<=760` |
| 375 × 812 | iPhone 13/14 (notched) | `<=640`, `<=760` |
| 414 × 896 | iPhone 11 Pro Max | `<=640`, `<=760` |
| 419 × 800 | **1 px below** `<=420` rule | verifies the tiny-phone rules |
| 421 × 800 | **1 px above** `<=420` rule | verifies the 640 rules without tiny overrides |
| 639 × 800 | 1 px below `<=640` rule | verifies 640 rules |
| 641 × 800 | 1 px above `<=640` rule | verifies the `(min-width: 641px) and (max-width: 760px)` band |
| 759 × 900 | 1 px below `<=760` rule | last narrow layout |
| 761 × 900 | 1 px above `<=760` rule | desktop layout just kicks in |
| 812 × 375 | iPhone landscape — hits `@media (max-height: 560px)` | short-height HUD rules |
| 640 × 480 | narrow + short combo | compound `(max-width: 640px) and (max-height: 560px)` rule |
| 1024 × 1366 | iPad portrait, regression check | should look desktop-ish |

Across every cell, run the four checks below and paste each failure into the finding with the exact viewport.

**Check 1 — programmatic overlap detection.** Run this in `preview_eval` once per viewport. It ignores known-OK stacks (modals, toast container) and flags any pairwise intersection between the HUD floaters and interactive elements.

```javascript
(() => {
  const targets = [
    '.hud-bar', '.hud-bottom', '.hud-bottom-buttons',
    '.ship-list', '.game-log', '.help-btn', '.sound-btn',
    '#phaseAlert', '.tutorial-tip', '#hudMinimap',
    '.floating-exit', '.btn-primary', '.game-over-content',
  ];
  const rects = targets.flatMap(sel =>
    [...document.querySelectorAll(sel)]
      .filter(el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden'
          && parseFloat(s.opacity) > 0 && el.offsetWidth > 0;
      })
      .map(el => ({ sel, el, r: el.getBoundingClientRect() })));
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue; // nested is fine
      const ix = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
      const iy = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
      if (ix > 2 && iy > 2) overlaps.push({
        a: a.sel, b: b.sel, area: Math.round(ix * iy),
        aRect: a.r.toJSON(), bRect: b.r.toJSON(),
      });
    }
  }
  const offscreen = rects.filter(({ r }) =>
    r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight);
  return { viewport: { w: innerWidth, h: innerHeight }, overlaps, offscreen: offscreen.map(o => o.sel) };
})();
```

Any entry in `overlaps` with `area > 2` is a finding. Any `offscreen` entry with a non-cosmetic selector is a finding. Mute known-benign stacks (e.g. a hidden game-over panel) by checking `display: none` — already done above, but verify.

**Check 2 — click-reachability.** For every primary button and HUD control, confirm the visible pixel at its geometric centre routes clicks back to the element itself. A decorative overlay with higher z-index (or a moved safe-area) can steal taps and produce a bug the snapshot won't show.

```javascript
(() => {
  const sels = ['.hud-bottom .btn', '.help-btn', '.sound-btn',
                '.floating-exit', '.tutorial-tip .btn', '.btn-primary'];
  const out = [];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      if (!el.offsetWidth || getComputedStyle(el).pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ok = hit === el || el.contains(hit);
      if (!ok) out.push({ sel, label: el.textContent?.trim().slice(0, 32),
                          stolenBy: hit?.tagName + '.' + hit?.className });
    }
  }
  return out;
})();
```

Empty array = fine. Any entry = a control the user cannot tap.

**Check 3 — safe-area on notched + landscape.** Playwright's Chromium has no real safe-area inset, but you can force one via `preview_eval`:

```javascript
document.documentElement.style.setProperty('--safe-top', '44px');
document.documentElement.style.setProperty('--safe-bottom', '34px');
document.documentElement.style.setProperty('--safe-left', '16px');
document.documentElement.style.setProperty('--safe-right', '16px');
```

Re-run Checks 1 and 2. Any new overlap or off-screen element at 375 × 812 is a finding: it will repro on a real iPhone even though you saw no bug at 0-inset.

**Check 4 — virtual-keyboard / URL-bar collapse.** iOS Safari and Android Chrome shrink the viewport when the address bar hides and again when a text input is focused. Simulate with `preview_resize` at the portrait height **minus 100–120 px** (e.g. 375 × 700 for iPhone 13 with keyboard up). Lobby callsign input, chat input, and join-code input must remain visible and not be covered by the HUD bottom bar or phase alert.

**Scenario + flow coverage.** Per viewport, walk at minimum:

1. Home menu → scenario select → difficulty (checks `menu-content` padding, logo clipping).
2. Lobby: Create Private → code reveal (`game-code` letter-spacing wraps on 320 px if broken).
3. Play vs AI, one full astrogation turn (HUD bar, bottom buttons, ship list, game log, minimap, phase alert).
4. Open help overlay mid-game (stacking + backdrop + close button reachability).
5. Game over screen (the `<=420` rules in `responsive.css` go edge-to-edge — verify no floating-panel border on 320 px).
6. Replay viewer (control bar visibility during animated playback; history archived as a 2026-04-21 regression).
7. Match history / leaderboard / agents pages — each has its own `@media` rules.

**Other sensory checks.** In the same preview tab: emulate `prefers-contrast: more` and `prefers-reduced-motion: reduce` via `preview_eval` by setting `document.documentElement.style.colorScheme` / forcing a class, or use DevTools rendering panel in a headed browser. Then tab-only through lobby + one astrogation phase. Cross-reference with [A11Y.md](./A11Y.md).

**Recent regression hotspots worth extra scrutiny** (`git log --oneline | grep -iE 'mobile|overlap|hud|floating'` enumerates the recurring ones):
- `floating-exit` / chat / replay-exit overlap — repeatedly fixed and repeatedly regressed.
- HUD bottom bar vs utility buttons on narrow + short viewports.
- Ship list overlapping minimap at `(min-width: 641px) and (max-width: 760px)`.
- Game-over edge-to-edge treatment at `<= 420 px`.
- Safe-area-inset for notched devices in landscape.
- PWA installed shell (no URL bar) — verify the inset math separately from in-browser.

### R11. Fresh-start: wipe persisted data between runs

For a clean baseline (e.g. before measuring whether a regression introduces ghost rows, or after a destructive test), confirm no live matches first, then truncate the D1 tables and the R2 archive bucket. **Production-only** — confirm scope with the operator first; everything below is destructive and irreversible.

```bash
curl -s "https://delta-v.tre.systems/api/matches?status=live" | python3 -m json.tool   # must be []

npx wrangler d1 execute delta-v-telemetry --remote --command "
  DELETE FROM match_rating;
  DELETE FROM match_archive;
  DELETE FROM player;
  DELETE FROM events;"
```

R2 has no `wrangler r2 object list` in 4.x — purge via the Cloudflare dashboard ("Delete all objects" on the bucket), via a temporary Worker route that uses the binding, or via rclone configured with R2 S3 credentials.

After the wipe, verify with the same snapshot query in R4 (all four tables should report `n = 0`) and confirm `/api/matches`, `/api/leaderboard`, `/api/matches?status=live` all return empty.

### R12. Doc-link fetch sweep

Walk every URL referenced from `README.md`, `docs/`, `/.well-known/agent.json`, `agent-playbook.json`, and the `/agents` page. Fetch each and confirm 200. Broken outbound links and 404s on documented internal paths (the original symptom that surfaced the missing `/healthz` and `/sitemap.xml` in the first pass) are doc-rot findings even when the underlying behaviour is unchanged.

### R13. Worker-tail exception triage

The single highest-yield probe in the 2026-04-19 pass. Run `wrangler tail delta-v --format json` for the duration of a paired-match session, then post-filter for any chunk with non-empty `exceptions[]`:

```python
import json, re
with open('tail.log') as f: raw = f.read()
chunks = re.split(r'(?<=\n})\n(?=\{)', raw)
for c in chunks:
    try: d = json.loads(c)
    except: continue
    for e in d.get('exceptions', []):
        print('---', e.get('name'), '---')
        print(e.get('message'))
        print(e.get('stack'))
```

Even outcomes that look successful from the client side (game completed, archive landed) can mask thrown exceptions in DO close handlers, alarm handlers, or async logging paths. The 2026-04-19 pass surfaced `TypeError: The Durable Object's code has been updated, this version can no longer access storage.` only because of this filter. Continuous delivery means **every exploratory pass should include this recipe** — a deploy may have just landed.

Also worth grepping for: any `name` other than expected error classes; any `stack` with `at async ...` paths into `archive`, `match-archive`, or `live-registry`; any `outcome: "exception"` chunk.

### R14. Client-side state audit (localStorage / sessionStorage / IDB / caches / SW)

Open the SPA in a fresh profile, complete one matchmaking-paired game and one Play-vs-AI game, then enumerate everything the client persisted:

```javascript
({
  localStorage_keys: Object.keys(localStorage),
  sessionStorage_keys: Object.keys(sessionStorage),
  cookies: document.cookie,
  indexedDBs: await indexedDB.databases?.() ?? [],
  caches: await Promise.all((await caches.keys()).map(async n => ({n, count: (await (await caches.open(n)).keys()).length}))),
  sw: (await navigator.serviceWorker.getRegistration())?.active?.scriptURL,
  manifest: await (await fetch('/site.webmanifest')).json(),
})
```

For each persisted blob, ask: who owns it? When does it get pruned? What happens if the device is shared? Does it contain anything user-typed (callsign, real-name pattern)? Is any auth credential stored in plaintext localStorage? The 2026-04-19 pass surfaced unbounded `delta-v:tokens` accumulation and a `delta-v:player-profile` storing the raw callsign indefinitely.

### R15. Post-game pipeline cross-check

After each completed paired match, verify the data landed in **all four** persistence stores within ~30 s:

```bash
GAME_ID=XXXXX-m1   # from the /api/matches?status=live response or the close-loop send_action result

# 1. Match metadata in D1
npx wrangler d1 execute delta-v-telemetry --remote --command \
  "SELECT * FROM match_archive WHERE game_id='$GAME_ID';"

# 2. Glicko-2 delta in D1
npx wrangler d1 execute delta-v-telemetry --remote --command \
  "SELECT * FROM match_rating WHERE game_id='$GAME_ID';"

# 3. Updated rows in player table
npx wrangler d1 execute delta-v-telemetry --remote --command \
  "SELECT player_key, username, rating, rd, games_played, last_match_at \
   FROM player WHERE last_match_at > (strftime('%s','now','-2 minutes')*1000) \
   ORDER BY last_match_at DESC;"

# 4. Full event-stream archive in R2
npx wrangler r2 object get delta-v-match-archive/matches/$GAME_ID.json --pipe --remote | head -c 500
```

Plus the public surfaces:

```bash
curl -s "https://delta-v.tre.systems/api/matches?limit=5" | python3 -m json.tool
curl -s "https://delta-v.tre.systems/api/leaderboard?includeProvisional=true&limit=5" | python3 -m json.tool
```

Any of these returning empty for a game that completed in the UI is a finding — most likely a thrown exception (see R13) interrupted the archive cascade. The 2026-04-19 pass found the `match_archive` row appeared eventually (after ~90 s, once the alarm path reconciled) — *eventual* archival is acceptable but worth measuring; *missing* archival is a bug.

### R16. Simulation-harness balance and scorecard sweep

`scripts/simulate-ai.ts` is the AI-vs-AI engine harness (see [SIMULATION_TESTING.md](./SIMULATION_TESTING.md) § 1). It's the cheapest way to surface scenario-balance and AI regressions without playing 100 games by hand.

```bash
npm run simulate -- all 30 --ci      # all 9 scenarios × 30 games, hard-vs-hard
npm run simulate -- duel 100 --ci    # narrow a scenario for tighter signal
npm run simulate -- duel 100 --randomize-start   # seat-balance independence
npm run simulate:duel-sweep          # pacing/seat-balance across many base seeds
npm run simulate -- grandTour 20 --seed 1 --capture-failures tmp/ai-failures
```

Each result now ships a **scorecard** (text + JSON) — read it before squinting at raw win-rate. Useful triage rules:

- **Decided-game P0 win-rate outside [40, 60]** at 100+ games → balance issue. The CI gate fires at 45–85% for P0 deliberately wide; tighter thresholds catch real drift earlier.
- **`invalidActionShare > 0`** → the built-in AI submitted an engine-rejected order. `--ci` fails on this; on a soft run, capture with `--capture-failures` and promote to a focused `__fixtures__` regression.
- **`fuelStallsPerGame > 0.1`** → fueled ships are coasting instead of burning or landing. Capture a fixture.
- **`timeoutShare > 0.05`** → AI is stalemating; the scenario lacks pressure or the turn cap is too short.
- **`objectiveShare` low relative to `fleetEliminationShare`** on a scenario with a non-elimination objective (convoy, evacuation, Grand Tour) → scoring is biasing toward attrition.
- **`passengerDeliveryShare`** trending down on convoy / evacuation → passenger pipeline regression.
- **`grandTourCompletionShare`** trending down → refuel / route planning regression.
- **`averageTurns < 5`** → scenario decided too quickly; first-player edge dominates.
- **`Engine Crashes > 0`** → fail closed, file under **Architecture & correctness**.

For AI PRs, compare scorecards on **paired seed sets** before/after, not single runs. When a sweep exposes a bad state, use `--capture-failures <dir>` to land a bounded `GameState` JSON under `src/shared/ai/__fixtures__/` and add a decision-class regression test (see [SIMULATION_TESTING.md](./SIMULATION_TESTING.md) § 1). The 2026-04-19 sweep surfaced evacuation 96-3 and duel 60-40; subsequent passes surfaced Grand Tour 60/60 timeouts. Run before any AI heuristic change and before any release.

---

## Workflow: probe, finding, backlog

1. **Probe.** Run a recipe (or invent one). Capture exact reproduction: URL, payload, response, console line, screenshot, gameId.
2. **Triangulate.** Confirm from at least one other vantage. A finding seen from only one tool is one self-edit away from being a tool bug, not an app bug.
3. **Classify.** Is it correctness, ergonomics, privacy, performance, doc rot, or "interesting but not actionable"? Drop the last category.
4. **Decide on actionability.** If a 30-second inline fix exists and it's clearly safe, fix it instead of filing. Otherwise, file.
5. **File.** Add an entry to the appropriate section of [BACKLOG.md](./BACKLOG.md) (most exploratory findings land in **Agent & MCP ergonomics** or **Cost & abuse hardening** — pick by primary impact). Each entry needs:
   - A short noun-phrase `### heading`.
   - 1-3 paragraphs: what was observed, why it matters, suggested fix(es).
   - A `**Files:**` line listing the likely files to edit.
6. **Cross-reference.** If the finding came from a recipe, name the recipe in the entry (e.g. "Found via R2 endpoint validation probing"). This builds confidence that the recipe is worth keeping.
7. **Close the loop.** When a backlog entry ships, the commit message should reference the recipe / finding, so future passes can reuse the technique.

For high-stakes findings (security, data loss, public PII leak), surface to the user immediately rather than only filing.

---

## Anti-patterns

Things that have wasted exploratory time in past passes — don't repeat them.

- **Running on the public Quick Match queue without time-boxing.** You will pair with real users and disturb their match.
- **Using `wrangler tail` output verbatim in commits or chat.** It contains real client IPs, geo, and TLS fingerprints. Sanitise or summarise.
- **Trusting a single tool's observation.** Browser shows X, agent MCP shows Y → confirm via `wrangler tail` or D1 before deciding which is wrong.
- **Letting the play skill drive a session you're observing.** The skill is the system under test. If it makes a decision that masks a bug, you'll miss it. For probing, use raw `delta_v_send_action` calls.
- **Long blocking `wait_for_turn` calls when the other seat may be slow.** Local MCP sessions can be sensitive to timeouts; prefer short timeouts (≤ 30 s) and explicit retries, and check current behaviour against `BACKLOG.md` before committing to a long block.
- **Speculative `git commit` after exploratory edits.** Exploratory passes usually shouldn't change source — only docs (`BACKLOG.md`, this doc, and occasionally a recipe-driven inline fix). If you found yourself editing engine code mid-pass, you switched modes; commit those changes separately, ideally on a dedicated branch.
- **Mass-purging production data without a paired check on `?status=live`.** R11 destroys real matches if any are in flight. Always verify zero live matches first, and confirm scope with the operator.
- **Adding "interesting but not actionable" entries to the backlog.** They drown out real items. If you can't write a fix, you don't have a finding yet — keep probing.
- **Forgetting that exploratory identities still persist in D1.** Use the reserved non-public prefixes (`QA_*`, `Bot_*`, `Probe_*`) for test callsigns; the leaderboard now filters them, but they remain queryable in operator tables and logs.
- **Filing bugs from programmatic clicks on hidden elements.** `element.click()` in Chrome MCP fires the handler regardless of `display: none` / `hidden` / `offsetWidth === 0`. Buttons a real user can never reach can still execute their handler from a test harness. Before filing a finding triggered by a DOM click, confirm the element is actually visible (`offsetWidth > 0` and a valid `getBoundingClientRect`) in the state you're probing. A hidden button with the "wrong" behaviour may still be a latent bug worth fixing (if CSS ever changes the button is suddenly reachable), but classify it as such rather than as a user-visible regression.
- **Filing mobile-layout findings from Chrome MCP.** Covered under R10, but bears repeating as an anti-pattern: the OS window cannot shrink below the display's minimum, so `@media (max-width: 760px)` never fires and the responsive breakpoints in [static/styles/responsive.css](../static/styles/responsive.css) stay inert. Switch to the Playwright preview MCP (`preview_resize`) or hand off to DevTools device emulation before filing.
- **Only testing at one "mobile" viewport (typically 375 × 812).** Delta-V has breakpoints at 760 / 640 / 420 px widths and a 560 px short-height rule, with an extra narrow-and-short combo. 375 × 812 only exercises a subset. R10's matrix includes 1-px boundary viewports (419, 421, 639, 641, 759, 761) specifically because overlap bugs hide in the single-pixel band between `@media` rules. Skipping the boundary means shipping the band.
- **Treating `100vh` as screen height.** iOS Safari and Android Chrome include the collapsible URL bar in `100vh`, so elements sized with `100vh` overflow on initial load and re-lay-out when the bar hides. If you see a one-time HUD jump on first scroll, expect `100vh` somewhere — prefer `100dvh` or computed offsets anchored to `env(safe-area-inset-*)`. This is cheap to catch during R10 by scrolling once after load and re-running the overlap script.

---

## Pass log

Append a one-line entry per pass: date, agent or human, scope, count of new backlog entries.

| Date | Operator | Scope | Backlog entries filed |
|------|----------|-------|----------------------|
| 2026-04-18 | agent (Opus 4.7) | MCP-vs-browser pairing, public API surface, scenario sweep, doc-consistency | 9 |
| 2026-04-19 | agent (Opus 4.7) | Rate-limit verification, payload validation, healthz audit, hosted-MCP parity, scenario sweep | 5 |
| 2026-04-19 | agent (Opus 4.7) | Listing-endpoint silent caps, leaderboard validation, /join metadata gap, auth-failure log silence, validation shape consistency | 5 |
| 2026-04-19 | agent (Opus 4.7) | End-to-end paired match → leaderboard verification; surfaced DO-deploy-eviction crash, surrender disabled in duel with wrong error, matchmaker double-pair, leaderboard test pollution | 4 |
| 2026-04-19 | agent (Opus 4.7) | DO-eviction root-cause trace; PWA + tutorial + localStorage audit; favicon/apple-touch-icon gaps; on-device PII surface | 3 |
| 2026-04-19 | agent (Opus 4.7) | Spectator/join-flow security probe — surfaced unauthenticated seat-hijack, missing spectator mode, local-game reload-loss, partial filter validation | 4 |
| 2026-04-19 | agent (Opus 4.7) | Combat/ordnance rules conformance + simulation balance sweep — surfaced evacuation 96-3 P1 dominance, duel/biplanetary first-player edge, grandTour/fleetAction timeout rates | 4 |
| 2026-04-19 | agent (Opus 4.7) | AI difficulty stratification sweep, matchmaker seat-assignment code read, reserved-name blocklist gap, re-verification of shipped P1 fixes | 3 |
| 2026-04-19 | agent (Opus 4.7) | Post-fix sweep confirmed evacuation rebalanced + seat shuffle shipped; security-header + CORS audit | 2 |
| 2026-04-19 | agent (Opus 4.7) | Match-history page replay link probe — surfaced broken promise ("Replay →" shows unavailable toast for every match) | 1 |
| 2026-04-19 | agent (Opus 4.7) | Lobby flows (Join / Forget my callsign / callsign input), reserved-name blocklist gap, final re-verification of shipped fixes | 1 |
| 2026-04-21 | agent (Opus 4.7) | Post-Stream-2 regression: full Play-vs-AI flow, archived-replay playback, client-state audit (R14), 6-scenario sweep (R7), hard-refresh reconnect (R9), API surface + validation (R1/R2); filed 0 new entries but surfaced Chrome-MCP resize-emulation gap (doc'd in R10) and the latent replay-exit routing quirk that shipped as 2746ca9 | 0 |
| 2026-04-21 | agent (Opus 4.7) | Deep pass post-Stream-1-AI deploy: R12 external doc links (28/28 OK), R16 simulation balance (2×30 games all scenarios — surfaced Grand Tour 60/60 timeouts + evacuation/convoy/fleetAction seat drift), R2 deep validation (oversize, Unicode, malformed JSON — all clean), R3 source-vs-agent.json description drift (4 scenarios differ), R5 hosted-MCP edge cases (oversize chat + bad sessionId error shape), R7 live UI re-check of corner buttons + replay exit | 4 |
| 2026-04-24 | agent (Opus 4.7) | First run of the revised R10 mobile sweep (surfaced ship-entry name overflow at 320 px), R16 sim balance (biplanetary 100% elimination + interplanetaryWar 110 fuel-stalls/game), R1/R2 live API + validation (all params reject cleanly), R12 doc-link sweep (55/55 OK); inline-fixed the R10 Check-1 script to ignore opacity:0 elements (false positive on `#phaseAlert` over menu) | 2 |
| 2026-04-24 | agent (Opus 4.7) | Deep R10 mobile sweep: menu/lobby/scenario-select/in-game (astrogation, fleet builder)/help/archived-replay/matches, across 320 × 568, 375 × 812, 812 × 375. Surfaced `#fleetStatus` HUD span wrapping to 4 × 85 px in replay spectating mode, ship-entry name wrap at 375 px, fleet-budget `(MegaCredits)` reflow, replay-ended toast truncation, and landscape minimap clipping. Fixed the portrait/HUD/copy/toast symptoms and kept the remaining landscape minimap case under Gameplay UX. | 1 |
