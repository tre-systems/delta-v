# Agent Improvements Log

Tracks observed issues, behavior notes, and improvement ideas from live autonomous matches.

## Session 2026-04-15

### Run A - Single quick-match agent (`CodexBot`)
- Match: `MCM2V`
- Result: Win (player 1), reason `Fleet eliminated!`, around turn 5

Observed notes:
- `staleTurn` rejection appeared immediately after an early ordnance action during a phase transition.
- The agent repeatedly selected nuke launches in early turns, which looks overly aggressive for parity positions.
- The client rolled directly into a new game start after game-over in the same room context, making one-shot runs harder to control.

Improvement ideas:
- Strengthen action-guard/retry handling around state transitions to reduce stale submissions.
- Add anti-overcommit heuristics for early-turn nuke usage (especially single-ship parity states).
- Add explicit single-match stop behavior in queue/runner flows after outcome is confirmed.

### Run B - Two-agent scrimmage (`Codex-A` vs `Codex-B`)
- Match: `4ATKP`
- Result: `Codex-A` (player 0) won by `Fleet eliminated!` in 2 turns
- Replay stats: 18 entries; phase counts `astrogation=4, ordnance=8, combat=5, gameOver=1`

Terminal/chat highlights:
- Codex-A chat: `Missiles away. Make them respect the lane.`
- Codex-A chat: `We have the edge. Finish the exchange.`
- Codex-B chat: `Opening burn set. Take the angle.`

Observed notes:
- Two-agent orchestration and matchmaking worked end-to-end in one room.
- Match duration can be extremely short in duel; outcomes may overfit opening heuristics.
- Chat visibility in scrimmage output is available via post-game report summaries.

Improvement ideas:
- Capture per-turn action traces in scrimmage summary (not just final report bullets) for easier debugging.
- Add a multi-game batch mode to reduce variance from very short matches.
- Add structured exports (JSON/CSV) for regressions: winner, turns, action rejects, ordnance mix, fuel delta.

### Run C - Two live queue agents with streamed terminal/chat (`CodexLiveA` vs `CodexLiveB`)
- Match: `MDW3P`
- Result: `CodexLiveA` (player 1) won by `Fleet eliminated!` in turn 2

Terminal/chat highlights:
- `Opening burn set. Take the angle.`
- `gl hf.`
- `Missiles away. Make them respect the lane.`
- `We have the edge. Finish the exchange.`
- `Close burn. Keep the pressure tight.`
- `Copy. Plotting next burn.`

Observed notes:
- Parallel live-agent setup worked; both queued separately and matched into the same room.
- Chat relay in verbose `llm-player` output is high quality for real-time monitoring.
- Both `quickmatch:agent --max-games 1` wrappers stayed alive post-game until manually terminated, despite game-over already logged.

Improvement ideas:
- Fix post-game exit path in `quick-match-agent` / `llm-player` orchestration so one-game runs terminate automatically.
- Add an explicit timeout/failsafe after game-over replay fetch to prevent stuck runner processes.
- Provide a "live mirror" mode that tails only key events (turn, chosen action, chat, result) without full verbose noise.

## Backlog Candidates (Cross-run)
- Better early-phase ordnance policy calibration (nuke restraint + geometry checks).
- Richer live telemetry for autonomous runs (turn-by-turn decisions and rejections).
- Deterministic "play exactly N matches then exit" contract across all runners.

## Session 2026-04-15 (Follow-up)

### Fix Applied - post-game process hang
- File: `scripts/llm-player.ts`
- Change: add default auto-exit on game over by closing the WebSocket after final result logging.
- New flag: `--stay-connected-after-gameover` to preserve previous behavior when explicitly desired.
- Validation: `npm run typecheck:tools` passed.

### Best-of-5 (`Codex-A` vs `Codex-B`)
- Format: five consecutive `quickmatch:scrimmage` games on production
- Final series score: `Codex-B` won **4-1**

Game results:
- Game 1 (`MZCHJ`): Winner player 1 (`Codex-B`) in 2 turns
- Game 2 (`X9GTG`): Winner player 0 (`Codex-B`) in 3 turns
- Game 3 (`Y5X8K`): Winner player 0 (`Codex-A`) in 2 turns
- Game 4 (`VZD8G`): Winner player 1 (`Codex-B`) in 3 turns
- Game 5 (`6XQPX`): Winner player 1 (`Codex-B`) in 2 turns

Observed chat patterns:
- Frequent: `Missiles away. Make them respect the lane.`
- Frequent: `We have the edge. Finish the exchange.`
- Frequent: `Close burn. Keep the pressure tight.`

Observations:
- Matches remain very short (2-3 turns), so opening-line heuristics dominate outcomes.
- `Codex-B` produced a more stable early conversion across the sampled games.

### Exit-fix verification run (`quickmatch:agent --max-games 1`)
- Setup: two independent queue agents matched into room `25WCY`.
- Result: both wrappers exited cleanly (`exit_code: 0`) and printed `Finished 1 game(s).`
- Status: post-game hang issue appears resolved in this path.

## Session 2026-04-15 (Quality Pass)

### New improvements shipped
- `scripts/quick-match-scrimmage.ts`
  - Added `--live` concise ticker mode (seat, selected actions, chat, rejections, result).
  - Added `--json-out <path>` structured export for per-game analytics.
  - Added metrics extraction per player: `actionRejectedCount`, `ordnanceMix`, sent/received chat.
  - Added dedupe for repeated live lines (notably duplicate `result:` lines).
- `scripts/llm-agent-coach.ts`
  - Tightened early-turn ordnance policy:
    - avoid early nukes unless point-blank geometry,
    - avoid long-range torpedo/mine overcommit,
    - prefer safer/skip ordnance in parity-deficit single-ship openings.

### Retest: best-of-5 with live + JSON export
- Command style:
  - `quickmatch:scrimmage ... --live --json-out tmp/scrimmage-results.json`
- Result:
  - 5/5 games completed successfully with live ticker and JSON append confirmations.
  - Export file now stores 5 run objects from this series (later 1 extra validation run appended, total 6 objects).
- Series outcome:
  - `Codex-B` won 4-1 again in this sample.

### Export quality checks
- JSON file path: `tmp/scrimmage-results.json`
- Contains expected top-level fields:
  - `timestamp`, `serverUrl`, `scenario`, `roomCode`, `gameId`, `winner`, `reason`, `turns`, `phaseCounts`, `players[]`.
- Contains per-player metrics:
  - `metrics.actionRejectedCount`
  - `metrics.ordnanceMix.{nuke,torpedo,mine}`
  - `metrics.chatSent[]`, `metrics.chatReceived[]`
- Observed in this retest set:
  - `ordnanceMix.nuke` recorded as `0` across exported entries.

### One-game validation after ticker dedupe
- Match `RGXFV` completed with clean live output (no duplicate `result:` lines).
- JSON append succeeded and process exited `0`.
