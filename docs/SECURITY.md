# Security & Competitive Integrity Review

This document describes the current security posture of Delta-V with emphasis on competitive multiplayer. It distinguishes protections that are already enforced from the risks that still remain if the game were exposed to untrusted public players.

## Current Protections

Delta-V now has a materially stronger authoritative-server boundary than the original prototype:

- WebSocket actions are still resolved server-side against the authoritative game engine.
- Hidden-identity state is filtered per player before broadcast, so the fugitive flag itself is not sent to the opponent.
- Room creation is now authoritative: `/create` initializes the room, locks the scenario up front, and rejects room-code collisions.
- The room creator receives a reserved player token for seat 0, and the copied invite link carries a guest invite token for seat 1.
- Once the guest joins, that invite token is rotated into a private reconnect token for that player.
- Reconnects require the stored player token, which prevents the old "next socket steals the disconnected seat" failure mode.
- Client-to-server WebSocket messages are runtime-validated before any engine handler executes, and malformed payloads are rejected instead of being trusted structurally.
- Room codes are generated from a cryptographically strong RNG rather than `Math.random()`.

These changes make private competitive play substantially safer than before.

## Remaining Competitive Risks

### 1. Invite links are still bearer credentials

Current status: **good for invited play, not ideal for public matchmaking**

- Both player seats are now token-protected.
- The guest seat is accessed through possession of the invite link.
- If that invite link is leaked before the intended guest uses it, another player can still claim the seat.

Implications:

- This is a standard private-link security model and is a large improvement over the old code-only guest join.
- It is still not the same as authenticated accounts, out-of-band invites, or tournament admin tooling.

Recommended next step:

- Add optional signed invite issuance, account binding, or one-time accept flows for stricter organized play.

### 2. Room secrecy is still limited by short codes

Current status: **acceptable for friendly matches, still weak for public matchmaking**

- Room codes are now collision-checked and cryptographically generated.
- They are still only 5 characters long.
- There is still no explicit application-layer throttling or bot protection around room creation and join attempts.

Implications:

- Code guessing is harder than before, but still more realistic than it should be for a ladder, tournament, or public lobby environment.

Recommended next step:

- Move to longer opaque room identifiers or add application-layer rate limiting / challenge protection at the edge.

## Lower-Risk Notes

### Hidden information

The current hidden-identity filtering is sound for the implemented Escape-style fugitive mechanic, because the hidden `hasFugitives` flag is stripped before broadcast. If the game expands toward dummy counters, concealed movement, or more scenario-specific secrets, that filtering layer will need another audit.

### Randomness

Random outcomes are server-controlled, which is the key anti-cheat requirement here. The code no longer relies on client-provided randomness, but it should still be described as server-controlled rather than as a cryptographically audited randomness system.

### Frontend XSS posture

The client still uses `innerHTML` in several UI paths. Today those paths render internal game data and static markup rather than arbitrary user-generated content, so the practical risk is low. If chat, player names, modded scenarios, or other freeform text are added later, those paths should be revisited immediately.

## Competitive Readiness Summary

Current assessment:

- **Rules authority:** good
- **Reconnect / seat hijack resistance:** good
- **Host-seat integrity:** good
- **Guest-seat integrity via invite links:** good
- **Match availability under hostile payloads:** good
- **Room secrecy / public matchmaking readiness:** weak

Delta-V is now in much better shape for competitive matches between invited players. It is still not fully hardened for public matchmaking or tournament-style open lobbies until room secrecy, rate limiting, and stronger identity layers are tightened further.

## Next Priority

The next security-focused engineering step should be public-lobby hardening:

- longer room identifiers and/or rate limiting
- optional edge-side bot protection for public deployments
- stronger identity/account binding if organized competitive play matters
