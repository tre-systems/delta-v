# Security & Competitive Integrity Review

This document describes the current security posture of Delta-V with emphasis on competitive multiplayer. It distinguishes protections that are already enforced from the risks that still remain if the game were exposed to untrusted public players.

Related docs: [ARCHITECTURE](./ARCHITECTURE.md), [BACKLOG](./BACKLOG.md), [PLAYABILITY](./PLAYABILITY.md).

## Current Protections

Delta-V now has a materially stronger authoritative-server boundary than the original prototype:

- WebSocket actions are still resolved server-side against the authoritative game engine.
- Hidden-identity state is filtered per player before broadcast, so the fugitive flag itself is not sent to the opponent.
- Room creation is now authoritative: `/create` initializes the room, locks the scenario up front, and rejects room-code collisions.
- The room creator receives a reserved player token for seat 0.
- The guest seat is shared by room code or copied room link — anyone with the 5-character code can claim the open seat.
- Reconnects require the stored player token, and seat reclamation is keyed to player identity even if the previous WebSocket has not finished closing yet.
- Client-to-server WebSocket messages are runtime-validated before any engine handler executes, and malformed payloads are rejected instead of being trusted structurally.
- Room codes are generated from a cryptographically strong RNG rather than `Math.random()`.

These changes make private multiplayer substantially safer than before, especially for host-seat integrity, reconnect safety, and server authority.

## Remaining Competitive Risks

### 1. Guest-seat claiming is still code/link based in the default flow

Current status: **acceptable for friendly matches, weak for public matchmaking**

- The creator seat is token-protected.
- The guest seat is still usually claimed through possession of the 5-character room code or the copied `/?code=ROOM1` link.
- Room-code guest joins are the deliberate product model for now — designed for friends sharing codes in conversation.

Implications:

- Anyone who gets the room code before the intended guest can still occupy seat 1.
- This is weaker than authenticated accounts, signed invites, or tournament admin tooling, but appropriate for the current friendly-match scope.

Recommended next step:

- For public matchmaking or tournament play, add longer opaque room identifiers or authenticated invite links.

### 2. Room secrecy is still limited by short codes

Current status: **acceptable for friendly matches, still weak for public matchmaking**

- Room codes are now collision-checked and cryptographically generated.
- They are still only 5 characters long.
- There is now basic application-layer throttling on room creation, but it is not yet a complete edge-global abuse-control story.

Implications:

- Code guessing and accidental seat capture are both more realistic than they should be for a ladder, tournament, or public lobby environment.
- Opportunistic room-creation abuse is somewhat better contained, but public deployment still needs global edge enforcement rather than worker-local fallback behavior.

Recommended next step:

- Move to longer opaque room identifiers and complete edge-global rate limiting / challenge protection for public deployments.

## Lower-Risk Notes

### Hidden information

The current hidden-identity filtering is sound for the implemented Escape-style fugitive mechanic, because the hidden `hasFugitives` flag is stripped before broadcast. If the game expands toward dummy counters, concealed movement, or more scenario-specific secrets, that filtering layer will need another audit.

That becomes more important as the project moves toward
event-sourced match history. Raw internal event streams
should be treated as authoritative private data, not as
safe spectator or replay payloads. Replay and spectator
APIs should serve filtered projections or explicitly
redacted event views rather than exposing the internal
event log directly.

### Randomness

Random outcomes are server-controlled, which is the key anti-cheat requirement here. The code no longer relies on client-provided randomness, but it should still be described as server-controlled rather than as a cryptographically audited randomness system.

### Frontend XSS posture

All `innerHTML` writes are now confined behind
`setTrustedHTML()` and `clearHTML()` in `src/client/dom.ts`.
No production code outside that file touches `innerHTML`
directly, making the boundary grep-able and auditable.

Today all callers pass internally generated markup (game
state, static constants, computed display strings) — no
user input or external content flows through this path.

If chat, player names, modded scenarios, or other freeform
text are added later, add a sanitizer such as `DOMPurify`
inside `setTrustedHTML()` rather than scattering raw
`innerHTML` writes. For plain text, prefer `textContent`
or the `el()` helper's `text` prop.

## Competitive Readiness Summary

Current assessment:

- **Rules authority:** good
- **Reconnect / seat hijack resistance:** good
- **Host-seat integrity:** good
- **Guest-seat integrity in default code/link flow:** weak
- **Match availability under hostile payloads:** good
- **Room secrecy / public matchmaking readiness:** weak

Delta-V is in much better shape for private matches than the early prototype, but it is not fully hardened for public matchmaking or tournament-style open lobbies. The biggest remaining gaps are guest-seat claiming, room secrecy, and deployment-level abuse controls.

## Near-Term Priorities

The next security-focused work should be:

- (resolved) room-code guest joins are the deliberate product model
- longer room identifiers and/or rate limiting
- optional edge-side bot protection for public deployments
- stronger identity/account binding if organized competitive play matters

## Operational References

- [Cloudflare WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
- [OWASP XSS overview](https://owasp.org/www-community/attacks/xss/)
- [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
