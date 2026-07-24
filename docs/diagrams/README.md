# Diagrams

Graphviz / DOT sources plus rendered PNGs. The `.dot` files are the source of truth; the PNGs are committed for in-browser viewing on GitHub.

## Files

| Diagram                                | Source                    | Rendered                  |
| -------------------------------------- | ------------------------- | ------------------------- |
| System overview                        | `system-overview.dot`     | `system-overview.png`     |
| Authoritative action pipeline          | `action-pipeline.dot`     | `action-pipeline.png`     |
| Engine phase state machine             | `phase-state-machine.dot` | `phase-state-machine.png` |
| Match lifecycle and recovery           | `match-lifecycle.dot`     | `match-lifecycle.png`     |
| Client input flow                      | `client-input-flow.dot`   | `client-input-flow.png`   |
| Agent token model                      | `agent-token-model.dot`   | `agent-token-model.png`   |
| Agent play loop                        | `agent-play-loop.dot`     | `agent-play-loop.png`     |
| Observability flow                     | `observability-flow.dot`  | `observability-flow.png`  |

## Reading Order

1. **System overview** for the whole browser / Worker / Durable Object / D1 / R2 / agent shape.
2. **Authoritative action pipeline** for how a C2S message becomes persisted events and a broadcast state.
3. **Phase state machine** and **match lifecycle** for turn flow, disconnect grace, and event-sourced recovery.
4. **Client input flow** when touching input, commands, or transport.
5. **Agent token model** and **agent play loop** when touching MCP, auth, or agent surfaces.
6. **Observability flow** when touching telemetry, lifecycle events, or archives.

## Conventions

Color coding by domain:

- Green nodes / clusters — Worker- and Durable-Object-side code (routes, dispatch, publication, broadcast).
- Purple — shared side-effect-free code (engine, validators, projection, candidates).
- Teal — persistence (D1, R2, DO storage).
- Blue — browser client, agents, and other external callers.
- Yellow / orange — timers and scheduled work (alarms, turn timers, cron).
- Red — error / rejection outcomes.
- Diamonds — decisions.
- Bold green outline — terminal success state.

Fonts: Avenir. Rendered at 220 DPI.

## Render

```
npm run diagrams          # render all .dot files to PNG next to the source
npm run check:diagrams    # verify each .dot renders cleanly and the PNG exists
```

Both scripts assume Graphviz is on PATH (`brew install graphviz`). CI installs Graphviz before running the diagram check. On a local machine without `dot`, `npm run check:diagrams` skips with a clear message; generated PNGs should still be refreshed before committing diagram changes.

To render one manually:

```
dot -Tpng:cairo docs/diagrams/<name>.dot -Gdpi=220 -o docs/diagrams/<name>.png
```
