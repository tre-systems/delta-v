# Security & Competitive Integrity Review

This document describes the current security posture of Delta-V with emphasis on competitive multiplayer. It separates protections that are already in place from the gaps that still let players disrupt games, seize seats, or otherwise undermine fair play.

## What The Server Already Enforces

Delta-V uses an authoritative-server model for rules execution:

- WebSocket messages are bound to the server-side socket tag (`player:0` or `player:1`), so a client cannot simply claim to be the other player in a normal action payload.
- Movement, ordnance, combat, resupply, detection, and victory logic are resolved in the shared engine on the server, not on the browser client.
- Hidden-identity state is filtered per player before broadcast via `filterStateForPlayer()`, so the fugitive flag itself is not sent to the opponent.
- Dice rolls and ordnance randomness are generated server-side, so the client does not directly choose outcomes.

These protections are real, but they do not by themselves make the multiplayer stack secure for competitive play.

## Confirmed Competitive Risks

### 1. Room access and reconnects are code-only

Current status: **not secure enough for competitive play**

- A 5-character room code is the only credential required to join a match.
- There is no host token, player-specific join secret, or reconnect secret.
- If a player disconnects, the next connection during the reconnect window inherits `disconnectedPlayer` and takes that seat.
- The first two successful websocket connections occupy the two player slots.

Implications:

- Anyone who learns a live room code can join an open seat.
- Anyone who connects during an opponent disconnect window can hijack that player's seat.
- The original match creator has no reserved ownership of the room beyond connecting first.

Relevant code:

- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L87)
- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L91)
- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L116)

Recommended fix:

- Generate per-player secret rejoin tokens at match creation.
- Require the token on reconnect before restoring a player slot.
- Reserve the creator's seat explicitly instead of assigning seats purely by connection order.

### 2. Scenario selection is client-overwritable

Current status: **not secure enough for competitive play**

- The Durable Object stores the scenario directly from the websocket query string.
- This happens during connection, before the game starts.
- The scenario returned by `/create` is not authoritatively locked to the room.

Implications:

- Either player can connect with a different `?scenario=...` and override the intended scenario for the room.
- In practice, the last connecting client wins.

Relevant code:

- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L81)
- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L130)
- [src/server/index.ts](/Users/robertgilks/Source/delta-v/src/server/index.ts#L39)

Recommended fix:

- Persist the scenario chosen at `/create`.
- Reject websocket attempts to change the scenario after room creation.
- Validate scenario identifiers against the known scenario list at the edge.

### 3. WebSocket payloads are not runtime-validated

Current status: **vulnerable to disruption**

- The server catches malformed JSON, but it does not validate the parsed object shape before dispatch.
- Handler methods pass fields like `msg.purchases`, `msg.orders`, `msg.launches`, and `msg.attacks` straight into engine functions.
- Engine functions assume arrays/objects and iterate immediately.

Implications:

- A connected player can send valid JSON with the wrong shape, such as `{"type":"combat","attacks":null}`.
- That can throw an uncaught runtime exception inside the Durable Object event handler.
- The likely outcome is match disruption rather than rule bypass, but for competitive play that is still a serious availability problem.

Relevant code:

- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L140)
- [src/server/game-do.ts](/Users/robertgilks/Source/delta-v/src/server/game-do.ts#L321)
- [src/shared/game-engine.ts](/Users/robertgilks/Source/delta-v/src/shared/game-engine.ts#L283)
- [src/shared/game-engine.ts](/Users/robertgilks/Source/delta-v/src/shared/game-engine.ts#L629)
- [src/shared/game-engine.ts](/Users/robertgilks/Source/delta-v/src/shared/game-engine.ts#L817)

Recommended fix:

- Add strict runtime schema validation for every client-to-server message before calling the engine.
- Reject oversized arrays and malformed payloads with explicit errors.
- Wrap handler dispatch in a final safety catch so one bad message cannot destabilize the match.

### 4. Room codes are short, non-cryptographic, and not uniqueness-checked

Current status: **acceptable for casual play, weak for competitive play**

- Room codes are 5 characters from a 32-character alphabet.
- Codes are generated with `Math.random()`.
- `/create` does not check whether the generated code is already in use.
- There is no application-layer throttling in front of room creation or join attempts.

Implications:

- Code guessing is more realistic than it should be for a competitive ladder or event environment.
- A collision can route a newly created room to an already existing Durable Object name.
- This risk compounds the reconnect and seat-hijack problems above.

Relevant code:

- [src/server/index.ts](/Users/robertgilks/Source/delta-v/src/server/index.ts#L30)
- [src/server/index.ts](/Users/robertgilks/Source/delta-v/src/server/index.ts#L39)
- [src/server/index.ts](/Users/robertgilks/Source/delta-v/src/server/index.ts#L53)

Recommended fix:

- Use longer codes or opaque tokens from a cryptographically strong RNG.
- Check for room-code collisions before returning a new room.
- Add explicit rate limiting or bot protection on room creation and websocket join attempts.

## Lower-Risk Notes

### Hidden information

The current hidden-identity filtering is sound for the implemented Escape-style fugitive mechanic, because the hidden `hasFugitives` flag is stripped before broadcast. However, this is narrower than a full hidden-information system. If the game grows toward dummy counters, concealed movement, or more scenario-specific secrets, the current filtering approach will need a broader audit.

### Randomness

Random outcomes are server-side, which is the important anti-cheat property today. They are not produced by a cryptographically strong RNG, though, so this should be described as "server-controlled" rather than "cryptographically secure."

### Frontend XSS posture

The client does use `innerHTML` in several UI paths, so previous claims that it never does were inaccurate. Today those code paths appear to render internal game data and static markup rather than arbitrary user-generated content, which keeps the practical risk low. If chat, player names, modded scenarios, or other freeform text are ever added, those paths must be revisited immediately.

## Competitive Readiness Summary

Current assessment:

- **Rules authority:** good
- **Hidden fugitive info:** good for the implemented scope
- **Competitive identity / seat security:** weak
- **Match availability under hostile clients:** weak
- **Room secrecy:** weak

Delta-V is in decent shape for friendly matches between trusted players, but it is not yet hardened enough for serious competitive play or public matchmaking.

## Next Priority

The next tracked engineering task should be the server-hardening pass:

- authenticated reconnect / rejoin tokens
- scenario locking at room creation
- strict runtime validation for all WebSocket client messages
