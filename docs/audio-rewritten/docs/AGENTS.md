# Delta-V Agents: Practical Guide

The fastest path to a working Delta-V agent. Start here, and read the deeper documentation only when you need it. Three companion documents are available: a deep protocol and design reference, a catalog of Model Context Protocol tools and host configuration, and a guide to large-scale simulation and load and chaos testing.

## Choose an integration path

There are three ways to connect an agent to Delta-V. The first, and recommended, option is the Model Context Protocol path — referred to as MCP, which stands for Model Context Protocol — because it provides the easiest robust loop and includes legal action candidates. The second option is the Bridge path, which is well suited to custom command or HTTP-based agents. The third option is a raw WebSocket connection, which gives maximum control at the cost of maximum implementation work.

## Quick start (MCP path)

Starting with the MCP path involves two stages. First, you launch the MCP server using the appropriate run command. Second, your agent runs a loop: it connects to a quick match, waits for its turn, picks a candidate action or supplies a custom action, sends that action, and repeats until the game ends. Once the game is over, it closes the session.

## Quick start (bridge path)

With the bridge path, one process acts as the host and another joins. The host creates a game in a chosen scenario — for example, a duel — and wires in an agent command to drive decisions. The joining process connects using the game's short code and similarly wires in an agent command.

Several optional flags are worth knowing. You can set a decision timeout in milliseconds to cap how long the agent is allowed to think. A think delay adds a brief pause before each decision. Disabling automatic chat replies is recommended for autonomous test runs. A verbose flag produces detailed output for debugging.

## Agent contract (what your model/process receives)

Bridge agents receive a structured turn input that includes a version number, the game code, the player's identifier, the current game state, a list of candidate actions, the index of the recommended candidate, and optionally a summary and legal metadata. The agent must return one of two things: either an object specifying a candidate index, or an object carrying a raw client-to-server action.

The key source of truth lives in three places: the observation builder module in the shared agent directory, the protocol types module in the shared types directory, and the bridge loop script.

## Reliability checklist (high value)

Several practices are high value for reliable agent behavior. Prefer candidate actions unless you need custom tactical logic. Always guard against stale turn or phase information — do not assume state is unchanged after a thinking delay. Treat action rejection as normal runtime behavior and re-decide based on fresh state. Keep chat output low-noise during autonomous scrimmage runs. Record per-game metrics such as the action rejected count, ordnance mix, and number of turns, for later tuning.

## Recommended tuning workflow

1. Run a small live batch of two to five games and export the results as JSON.

2. Identify one problem class — for example, a stale opening action, over-aggressive ordnance use, or chat noise.

3. Apply one targeted change.

4. Re-run and compare four metrics: rejection rate, win split by seat, average number of turns, and ordnance composition.

## Common pitfalls

Turning to the things most likely to go wrong: matchmaking can split in dual-queue scripts, so use retry pairing logic. Stale first-turn sends are a common source of errors — re-check the current phase before sending. Chat echo storms can occur if automatic replies are not disabled or heavily gated. Hidden-state leaks are a risk if you rely on anything other than the server-provided seat-scoped observations.

## Where to make changes

The codebase is organized so that related concerns live together. Runner behavior and retry logic live in the bridge runner and scrimmage scripts. Agent policy logic lives in the agent scripts. Shared tactical features and candidate generation live in the shared agent directory. MCP server behavior lives in the MCP server script.
