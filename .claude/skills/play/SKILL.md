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

Note your `playerId` from the response.

### 3. Decision loop

On each observation:

1. If `state.phase === 'gameOver'`: announce result, call `delta_v_close_session`. Done.
2. Read the `summary`, `spatialGrid`, `tactical`, and `labeledCandidates`.
3. **Analyze the position** using the tactical principles below - don't just pick `recommendedIndex`.
4. Choose an action: pick a candidate index OR craft a custom action.
5. Send via `delta_v_send_action` with closed-loop response:

```
delta_v_send_action({
  sessionId, action: <chosen action>,
  waitForResult: true, includeNextObservation: true,
  includeSummary: true, includeTactical: true,
  includeSpatialGrid: true, includeCandidateLabels: true,
  includeLegalActionInfo: true
})
```

6. If the next observation shows it's still your turn, go to step 2.
7. If it's the opponent's turn, call `delta_v_wait_for_turn` (same enrichments, timeoutMs: 60000) then go to step 2.

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
- Nukes launch at ship's velocity, no accel options. Nukes have no `torpedoAccel`/`torpedoAccelSteps`.
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

- **Range modifier:** -1 per hex distance between attacker and target
- **Velocity modifier:** -1 per hex of relative velocity difference above 2
- **Modified roll** = d6 + rangeMod + velocityMod. Higher is better for attacker.
- **Concentration pays off:** 2 ships attacking 1 target doubles your odds ratio (2:1 vs 1:1)
- **Counterattack:** Defender always gets to shoot back at one attacker, same modifiers
- **Disabled turns accumulate.** 6+ total = destroyed.

Best combat conditions: range 0-1, relative velocity 0-2, concentrated fire.

## Gravity

Planets have gravity hexes. Ships entering a gravity hex get deflected one hex in the indicated direction on their NEXT move. Full gravity is mandatory. Weak gravity (Luna, Io, Callisto, Ganymede) can be ignored once, but two consecutive weak hexes from the same body force the second.

**Sol is lethal** - entering Sol destroys the ship.

Use gravity to: save fuel on turns, slingshot around planets, or predict where enemies will drift when disabled.

## Tactical Reasoning Framework

Before choosing each action, think through:

### Astrogation Analysis
1. **Check candidate projections.** The `reasoning` field now shows projected destination, range to enemy, and RAM/SOL warnings. Read these before deciding.
2. **Never go stationary.** Zeroing your velocity makes you a predictable target for ramming. Always keep some drift — it's both offense and defense.
3. **Where will my ships be in 2 turns?** Add current velocity to position, then add the planned burn. Check for gravity hexes, map edges, and Sol.
4. **Am I on an intercept course?** Think about where the enemy will be, not where they are. Predict their velocity + gravity drift.
5. **Fuel budget:** Reserve at least 3 fuel for endgame course corrections. Running dry = helpless drift.
6. **Gravity opportunities:** If near a planet, can I use its gravity to change heading for free?
7. **Avoid Sol.** Any trajectory that passes through Sol's hex = instant death.
8. **Ramming is powerful.** If your projected position lands on the enemy's hex, you'll ram. Ram damage ranges from 0 to D5 — it can instantly kill a damaged ship.

### Combat Analysis
1. **Range + velocity mods:** Compute `hex_distance(attacker, target)` as range penalty. Compute velocity difference as velocity penalty. If total modifier <= -4, skip (you'll almost certainly miss).
2. **Focus fire:** Always concentrate all available ships on one target. 2:1 odds are dramatically better than two 1:1 attacks.
3. **Disable priority:** Target already-disabled ships to stack damage toward destruction (6 = eliminated).
4. **Base defense zones:** Bases auto-attack adjacent enemies. Don't fly into enemy base hexes carelessly.

### Ordnance Analysis
1. **Torpedoes:** Best when enemy is 3-6 hexes away and heading toward you. Aim torpedo accel direction at their predicted position.
2. **Nukes:** High risk/reward. Only launch when enemy is close AND you can clear the blast zone. Your ships in the nuke hex die too.
3. **Mines:** Drop when retreating or defending a chokepoint near gravity hexes.
4. **Skip when uncertain.** Wasted ordnance is worse than no ordnance.

### Candidate Evaluation
The observation gives you `labeledCandidates` with risk tags. Don't blindly follow `recommendedIndex`. Instead:
1. Read each candidate's `label` and `risk` tag
2. Evaluate whether the recommended action aligns with your strategic situation
3. Consider: Is this a winning position (press the attack) or losing (conserve, retreat)?
4. Custom actions are legal - you can craft burns the AI didn't suggest if you see a better trajectory

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
Evacuate passengers from a doomed station. Speed is everything - get transports loaded and moving before the enemy arrives.

## Error Handling

- If `send_action` returns `accepted: false`, read the error and adjust (wrong phase, bad ship ID, illegal action).
- If `wait_for_turn` times out, call `delta_v_get_state` to check if the game ended.
- If you see `actionRejected` in events, your last action was illegal - check the reason and retry.
- Keep playing through errors. Don't give up on a game because of one rejected action.
