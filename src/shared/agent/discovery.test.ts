// Guards discovery endpoints (static/.well-known/agent.json and
// static/agent-playbook.json) against drift from the ground-truth code.
// When a scenario or C2S/S2C message is added to the engine but not to
// the manifests, this test fails loudly before agents start breaking.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCENARIOS } from '../scenario-definitions';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const readJson = <T>(relPath: string): T => {
  const abs = resolve(repoRoot, relPath);
  return JSON.parse(readFileSync(abs, 'utf-8')) as T;
};

interface AgentManifest {
  endpoints?: Array<{
    id?: string;
    rateLimit?: string;
  }>;
  scenarios: Array<{
    id: string;
    name: string;
    tags: string[];
    description: string;
  }>;
  websocketProtocol: {
    clientToServer: Array<{ type: string }>;
    serverToClient: Array<{ type: string }>;
  };
  mcp?: {
    resources?: string[];
    preferredQuickMatchTool?: string;
    remote?: {
      tools?: string[];
    };
    tools: string[];
  };
}

interface AgentPlaybook {
  preferredTransport?: string;
  minimalTurnLoop?: string[];
  runtimeDecisionGuide?: Array<{
    if?: string;
    then?: string;
  }>;
  phaseActionMap: Record<
    string,
    {
      legalC2S?: string[];
      simultaneous?: boolean;
    }
  >;
}

// Source-of-truth values copied from src/shared/types/protocol.ts.
// Listed explicitly (rather than imported) so a protocol rename shows up
// as a test failure with a helpful diff rather than silent agreement.
const EXPECTED_C2S_TYPES = [
  'fleetReady',
  'astrogation',
  'surrender',
  'ordnance',
  'emplaceBase',
  'skipOrdnance',
  'beginCombat',
  'combat',
  'combatSingle',
  'endCombat',
  'skipCombat',
  'logistics',
  'skipLogistics',
  'rematch',
  'chat',
  'ping',
] as const;

const EXPECTED_S2C_TYPES = [
  'welcome',
  'spectatorWelcome',
  'matchFound',
  'gameStart',
  'movementResult',
  'combatResult',
  'combatSingleResult',
  'stateUpdate',
  'gameOver',
  'rematchPending',
  'chat',
  'error',
  'actionAccepted',
  'actionRejected',
  'pong',
  'opponentStatus',
] as const;

describe('.well-known/agent.json', () => {
  const manifest = readJson<AgentManifest>('static/.well-known/agent.json');

  it('lists exactly the scenarios the engine ships', () => {
    const manifestScenarios = manifest.scenarios
      .map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        tags: [...(scenario.tags ?? [])].sort(),
        description: scenario.description,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const engineScenarios = Object.entries(SCENARIOS)
      .map(([id, scenario]) => ({
        id,
        name: scenario.name,
        tags: [...(scenario.tags ?? [])].sort(),
        description: scenario.description,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(manifestScenarios).toEqual(engineScenarios);
  });

  it('enumerates every C2S message type', () => {
    const manifestTypes = new Set(
      manifest.websocketProtocol.clientToServer.map((m) => m.type),
    );
    for (const expected of EXPECTED_C2S_TYPES) {
      expect(
        manifestTypes.has(expected),
        `C2S type "${expected}" missing from manifest clientToServer`,
      ).toBe(true);
    }
  });

  it('enumerates every S2C message type', () => {
    const manifestTypes = new Set(
      manifest.websocketProtocol.serverToClient.map((m) => m.type),
    );
    for (const expected of EXPECTED_S2C_TYPES) {
      expect(
        manifestTypes.has(expected),
        `S2C type "${expected}" missing from manifest serverToClient`,
      ).toBe(true);
    }
  });

  it('advertises the MCP observation and wait-for-turn tools', () => {
    expect(manifest.mcp?.tools).toContain('delta_v_get_observation');
    expect(manifest.mcp?.tools).toContain('delta_v_wait_for_turn');
  });

  it('advertises the canonical quick-match tool and compatibility alias', () => {
    expect(manifest.mcp?.preferredQuickMatchTool).toBe('delta_v_quick_match');
    expect(manifest.mcp?.tools).toContain('delta_v_quick_match');
    expect(manifest.mcp?.tools).toContain('delta_v_quick_match_connect');
    expect(manifest.mcp?.remote?.tools).toContain('delta_v_quick_match');
    expect(manifest.mcp?.remote?.tools).toContain(
      'delta_v_quick_match_connect',
    );
  });

  it('advertises the local quick-match pairing helper', () => {
    expect(manifest.mcp?.tools).toContain('delta_v_pair_quick_match_tickets');
  });

  it('documents the archived replay endpoint rate limit', () => {
    const replayEndpoint = manifest.endpoints?.find((endpoint) => {
      return endpoint.id === 'replay';
    });
    expect(replayEndpoint?.rateLimit).toContain('250');
  });

  it('advertises the shipped MCP rules resources', () => {
    expect(manifest.mcp?.resources).toContain('game://rules/current');
    expect(manifest.mcp?.resources).toContain('game://rules/{scenario}');
    expect(manifest.mcp?.resources).toContain('game://leaderboard/agents');
    expect(manifest.mcp?.resources).toContain(
      'game://matches/{id}/observation',
    );
    expect(manifest.mcp?.resources).toContain('game://matches/{id}/log');
    expect(manifest.mcp?.resources).toContain('game://matches/{id}/replay');
  });
});

describe('agent-playbook.json', () => {
  const playbook = readJson<AgentPlaybook>('static/agent-playbook.json');

  it('covers every non-ambient phase in the engine', () => {
    const phases = Object.keys(playbook.phaseActionMap);
    // "waiting" is a transient internal phase; agents never act in it.
    for (const phase of [
      'fleetBuilding',
      'astrogation',
      'ordnance',
      'combat',
      'logistics',
      'gameOver',
    ]) {
      expect(phases).toContain(phase);
    }
  });

  it('lists the right legal C2S types per phase', () => {
    expect(playbook.phaseActionMap.fleetBuilding.legalC2S).toEqual([
      'fleetReady',
    ]);
    expect(new Set(playbook.phaseActionMap.astrogation.legalC2S)).toEqual(
      new Set(['astrogation', 'surrender']),
    );
    expect(new Set(playbook.phaseActionMap.ordnance.legalC2S)).toEqual(
      new Set(['ordnance', 'emplaceBase', 'skipOrdnance']),
    );
    expect(new Set(playbook.phaseActionMap.combat.legalC2S)).toEqual(
      new Set(['beginCombat', 'combat', 'skipCombat']),
    );
    expect(new Set(playbook.phaseActionMap.logistics.legalC2S)).toEqual(
      new Set(['logistics', 'skipLogistics']),
    );
    expect(playbook.phaseActionMap.gameOver.legalC2S).toEqual(['rematch']);
  });

  it('marks only fleetBuilding as simultaneous', () => {
    expect(playbook.phaseActionMap.fleetBuilding.simultaneous).toBe(true);
    expect(playbook.phaseActionMap.astrogation.simultaneous).toBe(false);
    expect(playbook.phaseActionMap.ordnance.simultaneous).toBe(false);
    expect(playbook.phaseActionMap.combat.simultaneous).toBe(false);
    expect(playbook.phaseActionMap.logistics.simultaneous).toBe(false);
  });

  it('describes an MCP-first minimal turn loop with raw fallback', () => {
    expect(playbook.preferredTransport).toBe('mcp');
    expect(playbook.minimalTurnLoop?.[0]).toContain('delta_v_quick_match');
    expect(playbook.minimalTurnLoop?.join(' ')).toContain(
      'delta_v_wait_for_turn',
    );
    expect(playbook.minimalTurnLoop?.join(' ')).toContain(
      'delta_v_send_action',
    );
    expect(playbook.minimalTurnLoop?.join(' ')).toContain(
      'Raw protocol fallback',
    );
  });

  it('includes the compact runtime recovery guide', () => {
    const guide = playbook.runtimeDecisionGuide ?? [];
    expect(guide.some((item) => item.then?.includes('fleetReady'))).toBe(true);
    expect(
      guide.some((item) => item.then?.includes('delta_v_wait_for_turn')),
    ).toBe(true);
    expect(guide.some((item) => item.if?.includes('actionRejected'))).toBe(
      true,
    );
  });
});
