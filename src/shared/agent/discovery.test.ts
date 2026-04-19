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
    tools: string[];
  };
}

interface AgentPlaybook {
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
  'actionRejected',
  'pong',
  'opponentStatus',
] as const;

describe('.well-known/agent.json', () => {
  const manifest = readJson<AgentManifest>('static/.well-known/agent.json');

  it('lists exactly the scenarios the engine ships', () => {
    const manifestIds = manifest.scenarios.map((s) => s.id).sort();
    const engineIds = Object.keys(SCENARIOS).sort();
    expect(manifestIds).toEqual(engineIds);
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

  it('advertises the local quick-match pairing helper', () => {
    expect(manifest.mcp?.tools).toContain('delta_v_pair_quick_match_tickets');
  });

  it('advertises the shipped MCP rules resources', () => {
    expect(manifest.mcp?.resources).toContain('game://rules/current');
    expect(manifest.mcp?.resources).toContain('game://rules/{scenario}');
    expect(manifest.mcp?.resources).toContain('game://leaderboard/agents');
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
});
