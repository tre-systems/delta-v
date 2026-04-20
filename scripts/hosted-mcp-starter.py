#!/usr/bin/env python3
"""Minimal hosted MCP Delta-V agent.

Stdlib only. The bot:
  1. mints an agentToken
  2. initializes hosted MCP
  3. queues a quick match
  4. waits for turns
  5. sends the recommended legal action
  6. closes the hosted session on exit
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BASE_URL = os.environ.get("SERVER_URL", "https://delta-v.tre.systems").rstrip("/")
MCP_URL = f"{BASE_URL}/mcp"
PLAYER_KEY = os.environ.get("PLAYER_KEY", f"agent_starter_{uuid.uuid4().hex[:12]}")
USERNAME = os.environ.get("USERNAME", "StarterBot")
SCENARIO = os.environ.get("SCENARIO", "duel")
WAIT_TIMEOUT_MS = int(os.environ.get("WAIT_TIMEOUT_MS", "25000"))


def post_json(url: str, payload: object, headers: dict[str, str] | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(
        url,
        data=body,
        headers=request_headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {raw}") from exc


class HostedMcpClient:
    def __init__(self, base_url: str, player_key: str) -> None:
        self.base_url = base_url
        self.mcp_url = f"{base_url}/mcp"
        self.player_key = player_key
        self.agent_token = self._issue_agent_token()
        self.request_id = 0
        self.initialize()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.agent_token}",
            "Accept": "application/json, text/event-stream",
        }

    def _issue_agent_token(self) -> str:
        issued = post_json(
            f"{self.base_url}/api/agent-token",
            {"playerKey": self.player_key},
        )
        token = issued.get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError(f"agent-token issuance failed: {issued}")
        return token

    def _rpc(self, method: str, params: dict | None = None) -> dict:
        self.request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        response = post_json(self.mcp_url, payload, headers=self._headers())
        if "error" in response:
            raise RuntimeError(f"MCP {method} failed: {response['error']}")
        result = response.get("result", {})
        if result.get("isError") is True:
            raise RuntimeError(f"MCP {method} rejected: {result}")
        return result.get("structuredContent", result)

    def initialize(self) -> None:
        self._rpc(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {
                    "name": "delta-v-hosted-mcp-starter",
                    "version": "1.0",
                },
            },
        )

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        return self._rpc(
            "tools/call",
            {"name": name, "arguments": arguments or {}},
        )


def summarize(observation: dict) -> str:
    summary = observation.get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip().splitlines()[0]
    state = observation.get("state", {})
    phase = state.get("phase", "?")
    turn = state.get("turnNumber", "?")
    return f"turn={turn} phase={phase}"


def main() -> int:
    client = HostedMcpClient(BASE_URL, PLAYER_KEY)
    match_token: str | None = None
    try:
        quick_match = client.call_tool(
            "delta_v_quick_match",
            {"scenario": SCENARIO, "username": USERNAME},
        )
        match_token = quick_match.get("matchToken")
        if not isinstance(match_token, str) or not match_token:
            raise RuntimeError(f"quick_match did not return matchToken: {quick_match}")

        print(
            f"Queued and matched into {quick_match.get('scenario', SCENARIO)} with matchToken.",
            flush=True,
        )

        while True:
            observation = client.call_tool(
                "delta_v_wait_for_turn",
                {
                    "matchToken": match_token,
                    "timeoutMs": WAIT_TIMEOUT_MS,
                    "includeSummary": True,
                    "includeCandidateLabels": True,
                },
            )
            state = observation.get("state") or {}
            outcome = state.get("outcome")
            if outcome is not None or state.get("phase") == "gameOver":
                print(f"Game over: {outcome}", flush=True)
                break

            candidates = observation.get("candidates") or []
            if not isinstance(candidates, list) or not candidates:
                print(f"No actionable candidates: {summarize(observation)}", flush=True)
                break

            recommended_index = observation.get("recommendedIndex", 0)
            if not isinstance(recommended_index, int):
                recommended_index = 0
            recommended_index = max(0, min(recommended_index, len(candidates) - 1))
            action = candidates[recommended_index]

            print(f"{summarize(observation)} -> {action.get('type', 'unknown')}", flush=True)

            result = client.call_tool(
                "delta_v_send_action",
                {
                    "matchToken": match_token,
                    "action": action,
                    "waitForResult": True,
                    "includeNextObservation": True,
                    "includeSummary": True,
                },
            )
            if result.get("accepted") is False:
                print(f"Action rejected: {result}", flush=True)
            if result.get("autoSkipLikely") is True:
                print("Auto-skip likely; waiting for the next actionable turn.", flush=True)
    finally:
        if match_token:
            try:
                client.call_tool("delta_v_close_session", {"matchToken": match_token})
            except Exception as exc:  # pragma: no cover - best-effort shutdown
                print(f"close_session failed: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
