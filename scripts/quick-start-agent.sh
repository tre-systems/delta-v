#!/usr/bin/env bash
# quick-start-agent.sh — run a Delta-V agent in one command
#
# Usage:
#   ./scripts/quick-start-agent.sh               # built-in AI agent
#   ANTHROPIC_API_KEY=sk-ant-... ./scripts/quick-start-agent.sh   # Claude agent
#
# The script:
#   1. Checks for Node.js and npm
#   2. Installs dependencies if needed
#   3. Starts a game against the built-in AI on the live server
#   4. Prints the spectator URL so you can watch in a browser

set -euo pipefail

SERVER_URL="${SERVER_URL:-https://delta-v.tre.systems}"
SCENARIO="${SCENARIO:-duel}"

# ── Check prerequisites ────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed." >&2
  echo "Install it from https://nodejs.org (v18+ required) and re-run." >&2
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js v18+ is required (found v$(node --version))." >&2
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "Error: npm is not installed. It should come bundled with Node.js." >&2
  exit 1
fi

# ── Install dependencies if node_modules is missing ───────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [ ! -d node_modules ]; then
  echo "Installing dependencies (npm install)..."
  npm install --silent
fi

# ── Pick agent command ─────────────────────────────────────────────────────────

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  AGENT_CMD="npm run llm:agent:claude --silent"
  AGENT_LABEL="Claude (claude-haiku-4-5)"
else
  AGENT_CMD="npm run llm:agent:recommended --silent"
  AGENT_LABEL="built-in AI (recommended)"
fi

# ── Start the game ─────────────────────────────────────────────────────────────

echo ""
echo "  Delta-V Quick Start"
echo "  ─────────────────────────────────────────────"
echo "  Server   : $SERVER_URL"
echo "  Scenario : $SCENARIO"
echo "  Agent    : $AGENT_LABEL"
echo ""
echo "  The agent will create a game and wait for an opponent."
echo "  Open the printed URL in a browser to join or spectate."
echo ""
echo "  Press Ctrl-C to stop."
echo ""

exec npm run llm:player -- \
  --server-url "$SERVER_URL" \
  --mode create \
  --scenario "$SCENARIO" \
  --agent command \
  --agent-command "$AGENT_CMD"
