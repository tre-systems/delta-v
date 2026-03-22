# Playability Testing

How to verify the game is actually playable. Run through these checks after significant UI/UX changes.

Related docs: [SPEC](./SPEC.md), [SECURITY](./SECURITY.md), [SIMULATION_TESTING](./SIMULATION_TESTING.md).

## Quick Smoke Test (2 minutes)

Start a single-player Bi-Planetary game on desktop and verify:

1. **Landed ship shows** "Click a direction to take off (costs 1 fuel)"
2. **Click a burn hex** — course preview appears with fuel cost label
3. **Confirm** — movement animation plays, ship labels visible during animation
4. **After animation** — fuel gauge shows speed and fuel-to-stop ("Speed 2 (2 to stop)")
5. **Play to combat** — skip ordnance, verify combat UI shows odds and modifier labels
6. **Skip combat** — turn advances to opponent, then back to you

## Multi-Ship Test (3 minutes)

Start a single-player Escape game (3 transports vs enforcers):

1. **No auto-selection** — HUD shows "Select a ship to begin", FUEL: 0/0
2. **Click a ship** — toast says "Selected: Transport", HUD updates with fuel
3. **Set burn, click another ship** — status changes to "Burn set · Select another ship"
4. **Click same hex twice with stacked ships** — cycles between ships
5. **Set all burns** — status shows "All burns set · Confirm (Enter)"
6. **Confirm and play** — all ships move, labels visible during animation

## Mobile Test (3 minutes)

Resize to 375x812 or use a phone:

1. **Menu** — all buttons visible and tappable
2. **Game starts** — log panel is collapsed, single-line bar at bottom shows latest message
3. **Tap log bar** — full log expands as overlay
4. **Tap ×** — log collapses back to bar
5. **All buttons** — CONFIRM, UNDO, SKIP COMBAT have adequate touch targets (min 48px)
6. **Top bar** — fuel, phase, objective all visible without overflow
7. **Ship list** — scrollable if many ships, doesn't overlap with other elements
8. **Touch language** — status messages say "Tap" not "Click", no "(Enter)" hints
9. **Burn markers** — direction circles have no 1-6 number labels
10. **Help overlay** — shows "Tap ship/arrow/enemy", no keyboard shortcuts
11. **Landscape** — rotate to landscape; HUD bars compact, canvas area usable

## Multiplayer Reconnect Test (3 minutes)

Open the same multiplayer room in two real browser tabs or windows:

1. **Reach astrogation** — both players connected and able to submit a turn
2. **Refresh one active player tab** — do it quickly, before the previous socket has obviously torn down
3. **Reconnect succeeds** — refreshed tab returns to the same seat, no "Invalid player token" or "Game is full" error
4. **Old socket is replaced** — the stale tab no longer receives live updates for that seat
5. **Grace-window reconnect** — close one player for less than 30 seconds, reopen with the stored token, and verify the match continues
6. **Forfeit path** — disconnect one player for more than 30 seconds and verify the opponent wins by disconnect

## Combat Test (2 minutes)

Start a Duel game (frigates near Mercury):

1. **Click enemy ship** — combat preview shows odds, "Range −X" and "CAN COUNTER" labels
2. **Click ATTACK** — attack is queued with all legal attackers auto-drafted
3. **Fire All** — toast shows result ("Frigate: Disabled 2T" or "Frigate: DESTROYED")
4. **Counterattack** — if applicable, result logged and toasted
5. **Ship destroyed** — selection highlight clears, no ghost highlight on wreck

## Takeoff/Landing Test (2 minutes)

Start Bi-Planetary:

1. **Landed ship** — status says "Click a direction to take off (costs 1 fuel)"
2. **Set burn** — course preview line starts from the base hex (not mid-air)
3. **After takeoff** — fuel gauge shows speed and fuel-to-stop
4. **Gravity arrows** — yellow (applied this turn) and cyan dashed (will apply next turn) visible when passing through gravity hexes

## Keyboard Shortcuts

Verify with a single-ship fleet:

1. **1-6** — sets burn direction
2. **Escape** — deselects ship (but auto-reselects if only 1 ship)
3. **Tab** — cycles ships (multi-ship only)
4. **Enter** — confirms turn
5. **?** — toggles help overlay
6. **L** — toggles log panel (desktop)

## AI Simulation (automated)

Run `npm run simulate -- all 25` — all 8 scenarios should complete with 0 engine crashes.
The simulation runner now randomizes the starting player during bulk balance runs, so the win-rate output is less biased by seat order.
CI balance warnings are scenario-specific and can skip cooperative or race-style scenarios where seat order is part of the design.

## Fleet Building Test (2 minutes)

Start a Fleet Action or Interplanetary War game:

1. **Budget display** — shows starting MegaCredits (e.g. "400 MC remaining")
2. **Click ship type** — ship added to "YOUR FLEET", budget decreases
3. **Over-budget ships** — ship types costing more than remaining MC are greyed out
4. **Remove ship** — click × next to a ship in YOUR FLEET, budget restored
5. **Clear** — removes all ships, budget fully restored
6. **Launch Fleet** — game starts with selected ships at home planet

## What These Tests Don't Cover

- Multiplayer WebSocket synchronisation (requires two clients)
- PWA offline mode
- Turn timer expiry edge cases
