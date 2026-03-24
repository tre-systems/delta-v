# ADR 0002: Deployment and protocol compatibility

## Context

The game ships as:

- A **single SPA bundle** (`client.js`) served with the Worker.
- **Shared TypeScript types** for C2S/S2C in `src/shared/types/protocol.ts` and validators in `src/shared/protocol.ts`.
- **`GameState.schemaVersion`** on domain state for migrations.

## Decision

1. **Deploy model:** Treat **client and server as a single version line** for normal releases (one deploy updates Worker + static assets together). Staggered “old client / new server” is **not** a supported product requirement today.
2. **Breaking protocol changes:** Require a **coordinated deploy** and, if needed, force reload / cache-bust the SPA. Prefer **additive** JSON fields when possible.
3. **State migrations:** When bumping `schemaVersion`, follow the playbook in [BACKLOG.md](../BACKLOG.md) priority **9** (projector, replay, recovery tests).

## Consequences

- No feature-flag protocol negotiation in the client today.
- If mobile apps or third-party clients appear, revisit with explicit **min client version** or capability negotiation.
