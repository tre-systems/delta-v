---
name: play
description: Play a game of Delta-V using MCP tools
user_invocable: true
---

# Play Delta-V

You are an autonomous agent playing Delta-V, a turn-based space combat game with vector movement, orbital gravity, and dice combat on a hex grid. You make all decisions independently using tactical analysis. Use the delta-v MCP tools to connect, observe, decide, and act.

## Arguments

- `scenario` (optional): scenario name (default: `duel`). Options: duel, biplanetary, escape, convoy, evacuation
- `server` (optional): server URL (default: production `https://delta-v.tre.systems`)

## Game Loop

Execute this loop autonomously with no user input needed:

### 1. Connect

```
delta_v_quick_match_connect({
  username: "Claude-<4 random hex chars>",
  scenario: "<scenario or duel>",
  serverUrl: "<server if provided>"
})
```

Note your `sessionId` and tell the user you're queued.

### 2. Get initial observation

Call `delta_v_wait_for_turn` with ALL enrichments enabled to block until the game starts and it's your turn:

```
delta_v_wait_for_turn({
  sessionId, includeSummary: true, includeTactical: true,
  includeSpatialGrid: true, includeCandidateLabels: true,
  includeLegalActionInfo: true, timeoutMs: 120000
})
```

Note your `playerId` from the response. If this returns an error (gameOver or timeout), call `delta_v_get_observation` to check what happened.

### 3. Decision loop

On each observation:

1. If `state.phase === 'gameOver'`: announce result, call `delta_v_close_session`. Done.
2. If it's not your turn: Triplanetary uses I-Go-You-Go turns — one player completes all phases before the other goes. If `state.activePlayer !== playerId`, call `delta_v_wait_for_turn` (timeoutMs: 30000). Exception: during `astrogation` phase you can pre-submit orders even when it's not your turn (the server holds them). If wait errors with gameOver, get final observation and report result.
3. Read the `summary`, `spatialGrid`, `tactical`, and `labeledCandidates`.
4. **Analyze the position** using the tactical principles below — don't just pick `recommendedIndex`.
5. Choose an action: pick a candidate OR craft a custom action.
6. Send via `delta_v_send_action` with closed-loop response:

```
delta_v_send_action({
  sessionId, action: <chosen action>,
  waitForResult: true, includeNextObservation: true,
  includeSummary: true, includeTactical: true,
  includeSpatialGrid: true, includeCandidateLabels: true,
  includeLegalActionInfo: true
})
```

7. Check the response: if `accepted: true`, read the `nextObservation` and go to step 1. If `accepted: false`, the action was rejected (wrong phase, stale state) — get a fresh observation and retry. If `accepted: null` (pending), the server is waiting for the other player — call `delta_v_wait_for_turn`.

For each turn, tell the user in 1-2 sentences what you see and your reasoning.

### 4. Chat

Send one thematic chat via `delta_v_send_chat` at game start. Keep under 200 chars. Be sporting.

## Phase Actions

### fleetBuilding (simultaneous)

Send `{ "type": "fleetReady", "purchases": [] }` to accept defaults. Fleet building requires deep scenario knowledge; defaults are competitive.

### astrogation (sequential)

This is the most important phase. You set velocity vectors for all your ships.

```json
{
  "type": "astrogation",
  "orders": [
    { "shipId": "p<playerId>s<idx>", "burn": <0-5 or null>, "overload": <0-5 or null> }
  ]
}
```

- `burn`: direction 0-5 or `null` for coast. Costs 1 fuel.
- `overload`: additional burn direction. Costs 2 fuel total. Warships only, once between base visits.
- You MUST include an order for every ship you own that is not destroyed.
- Disabled ships cannot burn but still need an order (burn: null).

### ordnance (sequential)

Launch torpedoes, mines, or nukes from ships with cargo space:

```json
{ "type": "ordnance", "launches": [
  { "shipId": "p0s0", "ordnanceType": "torpedo", "torpedoAccel": <0-5>, "torpedoAccelSteps": <1 or 2> }
]}
```

- `torpedoAccel`: direction for initial boost. `torpedoAccelSteps`: 1 (close/slow target) or 2 (far/fast target).
- Torpedo candidate reasoning shows predicted first-turn position and distance to enemy — use this to judge intercept quality.
- Nukes launch at ship's velocity, no accel options.
- Mines are stationary. No accel options.
- Skip: `{ "type": "skipOrdnance" }`

### combat (sequential)

Attack enemies in range with warships:

```json
{
  "type": "combat",
  "attacks": [{ "attackerIds": ["p0s0", "p0s1"], "targetId": "p1s0", "targetType": "ship", "attackStrength": null }]
}
```

- `attackStrength: null` = full combat factor. Multiple ships can gang up.
- Can also target ordnance: `"targetType": "ordnance"`.
- Skip: `{ "type": "skipCombat" }`

### logistics (sequential)

Transfer fuel or passengers between co-located, co-velocity ships:

```json
{ "type": "logistics", "transfers": [
  { "sourceShipId": "p0s0", "targetShipId": "p0s1", "transferType": "fuel", "amount": 5 }
]}
```

- Skip: `{ "type": "skipLogistics" }`

## Hex Coordinate Reference

Flat-top hexes, axial coordinates (q, r). Burn adds velocity in that direction:

| Dir | Name | dq | dr | Use when target is... |
|-----|------|----|----|-----------------------|
| 0 | E | +1 | 0 | to your east (higher q) |
| 1 | NE | +1 | -1 | northeast (higher q, lower r) |
| 2 | NW | 0 | -1 | north (lower r) |
| 3 | W | -1 | 0 | to your west (lower q) |
| 4 | SW | -1 | +1 | southwest (lower q, higher r) |
| 5 | SE | 0 | +1 | south (higher r) |

**Velocity is persistent.** A burn at direction 0 adds (+1, 0) to your velocity permanently. Next turn you move by your full velocity vector, then can burn again. To stop, you must burn opposite to your velocity.

**Hex distance** = `max(|dq|, |dr|, |dq+dr|)` in cube coordinates.

## Ship Stats Quick Reference

| Type | Combat | Fuel | Cargo | Can Overload | Notes |
|------|--------|------|-------|-------------|-------|
| Corvette | 2 | 20 | 5 | Yes | Cheap warship |
| Corsair | 4 | 20 | 10 | Yes | Fast raider |
| Frigate | 8 | 20 | 40 | Yes | Main battle |
| Dreadnaught | 15 | 15 | 50 | Yes | Heavy capital, fires while disabled |
| Torch | 8 | INF | 10 | Yes | Infinite fuel |
| Transport | 1D | 10 | 50 | No | Defensive only |
| Tanker | 1D | 50 | 0 | No | Fuel logistics |
| Packet | 2 | 10 | 50 | No | Light armed cargo |

D = defensive only (can only counterattack, never initiate).

**Ordnance cargo cost:** Mine=10, Torpedo=20, Nuke=20. All ordnance lasts 5 turns.

## Combat Mechanics

- **Range modifier:** -1 per hex of distance (range 3 = -3 penalty)
- **Velocity modifier:** -1 per hex of relative velocity difference above 2 (rel. vel 5 = -3 penalty)
- **Modified roll** = d6 - rangeMod - velocityMod. You need a high modified roll to damage.
- If total penalty >= 4 (range + velocity), **skip combat** — even rolling 6 gives modified 2 or less, which almost never damages at 1:1 odds.
- **Concentration pays off:** 2 ships attacking 1 target gives 2:1 odds (dramatically better damage table).
- **Counterattack:** Defender always shoots back at one attacker with the same modifiers.
- **Disabled turns accumulate.** 6+ total = destroyed. Disabled turns tick down by 1 each turn.
- Candidate reasoning shows exact odds like `8 vs 8, range -2, vel -0, odds 1:1` — read these.

## Gravity

Planets have gravity hexes (shown as `~` on the spatial grid). Ships entering a gravity hex get deflected one hex in the indicated direction on their NEXT move. Full gravity is mandatory. Weak gravity (Luna, Io, Callisto, Ganymede) can be ignored once, but two consecutive weak hexes from the same body force the second.

**Sol is lethal** — entering Sol's surface destroys the ship. Candidate labels warn with `SOL DANGER` when a burn takes you close.

Use gravity to: save fuel on turns, slingshot around planets, or predict where disabled enemies will drift.

## Tactical Reasoning Framework

Before choosing each action, think through:

### Astrogation Analysis
1. **Read candidate projections.** The `reasoning` field shows projected destination, range to enemy, `RAM WARNING` / `SOL DANGER` / `STATIONARY WARNING` alerts. Compare candidates on these.
2. **Never go stationary.** If a candidate shows `STATIONARY WARNING`, it means the burn cancels your velocity to zero — you'll be a sitting target for ramming. Pick a different burn or coast instead.
3. **Where will my ships be in 2 turns?** The NEXT TURN PREDICTIONS section in the summary shows velocity + gravity drift for every ship.
4. **Am I on an intercept course?** Think about where the enemy will be, not where they are now. Their prediction is in the summary too.
5. **Fuel budget:** Reserve at least 3 fuel for endgame corrections. Running dry = helpless drift.
6. **Gravity opportunities:** If near a planet, can I use its gravity to change heading for free?
7. **Ramming is powerful.** If a candidate shows `RAM WARNING`, decide: is ramming good here (enemy is damaged) or bad (you'll take damage too)? Ram damage ranges from 0 to D5.
8. **A coast candidate is always available.** Compare burning vs coasting — sometimes saving fuel and drifting is the best move.

### Combat Analysis
1. **Read the odds in candidate reasoning.** It shows `attack vs defend, range -N, vel -N, odds X:Y`. If the total penalty is >= 4, skip.
2. **Focus fire:** Always concentrate all available ships on one target.
3. **Disable priority:** Target already-disabled ships to stack toward 6 (= destroyed).
4. **Counterattack awareness:** The defender shoots back. At 1:1 odds you take as much as you dish out.

### Ordnance Analysis
1. **Torpedo candidates show intercept prediction.** e.g. `torpedo -> (2,2), 2 hex from p1s0`. If the distance is > 4, the torpedo probably won't intercept — skip.
2. **Nukes** are high risk/reward. Only when enemy is close AND you can clear the blast zone.
3. **Skip when uncertain.** Wasted ordnance is worse than no ordnance.

### Candidate Evaluation
Don't blindly follow `recommendedIndex`. The observation gives you `labeledCandidates` with:
- `label`: what the action does
- `reasoning`: projected outcomes (destination, range, fuel cost, combat odds, torpedo intercept, RAM/SOL warnings)
- `risk`: low / medium / high

Compare ALL candidates. The coast option may be better than the AI's recommended burn. A skip may be better than a nuke launch.

## Scenario Strategies

### Duel
1v1 frigate fight across Mercury's gravity well. No base defense — pure ship combat. Ships start 6 hexes apart with initial velocity toward Mercury. Key tactics: use gravity for free course changes, time ordnance for close-range intercepts, and watch for ramming opportunities. Never go stationary — you'll get rammed. Games last 4-8 turns.

### Biplanetary
Land a ship on the enemy's home planet. Split focus between objective (reaching their planet) and defense (stopping them from reaching yours). Gravity assists around Mercury are critical for fuel efficiency.

### Escape
Asymmetric: fugitives run for the map edge, enforcers intercept. As fugitive: burn hard toward nearest edge, use gravity slingshots, sacrifice escort ships as decoys. As enforcer: predict their escape vector, cut them off, disable the transport.

### Convoy
Protect or destroy a convoy crossing the map. Escort ships screen the transports. Attackers should isolate and destroy transports, not waste shots on escorts.

### Evacuation
Evacuate passengers from a doomed station. Speed is everything — get transports loaded and moving before the enemy arrives.

## Error Handling

- **`accepted: false`** means the action was rejected. Common causes: wrong phase (the game advanced while you were deciding), invalid ship ID, illegal action. Get a fresh observation and retry.
- **`accepted: null` (pending)** means the server is waiting for both players (e.g. simultaneous astrogation). Call `delta_v_wait_for_turn` to block until resolved.
- **`wait_for_turn` error: gameOver** means the game ended while you were waiting. Call `delta_v_get_observation` to see the final state, announce the result.
- **`wait_for_turn` timeout** means the opponent hasn't moved yet. Retry with a fresh `wait_for_turn`.
- **Keep playing through errors.** Don't give up on a game because of one rejected action.
