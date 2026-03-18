# Playability Testing

How to verify the game is actually playable. Run through these checks after significant UI/UX changes.

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

## Combat Test (2 minutes)

Start a Duel game (frigates near Mercury):

1. **Click enemy ship** — combat preview shows odds, "Range: X  Velocity: Y" with color coding
2. **Fire** — toast shows result ("Frigate: Disabled 2T" or "Frigate: DESTROYED")
3. **Counterattack** — if applicable, result logged and toasted
4. **Ship destroyed** — selection highlight clears, no ghost highlight on wreck

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

Run `npm run simulate all 25` — all 8 scenarios should complete with 0 engine crashes.

## What These Tests Don't Cover

- Multiplayer WebSocket synchronisation (requires two clients)
- Network reconnection after disconnect
- PWA offline mode
- Turn timer expiry edge cases
- Fleet building phase (Interplanetary War scenario)
