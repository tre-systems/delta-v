#!/usr/bin/env bash
# Quick-start script for the Delta-V Claude agent.
# Usage: ANTHROPIC_API_KEY=sk-ant-... bash scripts/quick-start-agent.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Error: ANTHROPIC_API_KEY is not set." >&2
  echo "Usage: ANTHROPIC_API_KEY=sk-ant-... bash scripts/quick-start-agent.sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed. Install Node.js 20+ and try again." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install --silent
fi

SERVER_URL="${SERVER_URL:-https://delta-v.tre.systems}"
SCENARIO="${SCENARIO:-duel}"
THINK_MS="${THINK_MS:-400}"

echo ""
echo "Delta-V Claude Agent"
echo "--------------------"
echo "Server:   $SERVER_URL"
echo "Scenario: $SCENARIO"
echo ""
echo "Creating game and waiting for opponent..."
echo "Open the printed URL in a browser (or share the code) to play against the agent."
echo ""

exec npm run llm:player -- \
  --server-url "$SERVER_URL" \
  --mode create \
  --scenario "$SCENARIO" \
  --agent command \
  --agent-command "npm run llm:agent:claude" \
  --think-ms "$THINK_MS"
