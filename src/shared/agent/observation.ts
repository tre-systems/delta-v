// Composes candidates, legal-action metadata, and prose summary into the
// canonical AgentTurnInput sent to every external agent.

import { buildSolarSystemMap } from '../map-data';
import type { GameState, PlayerId, SolarSystemMap } from '../types/domain';
import type { C2S } from '../types/protocol';
import { buildCandidates } from './candidates';
import { describeCandidate, describePosition, describeShip } from './describe';
import { buildLegalActionInfo } from './legal-actions';
import type { AgentTurnInput } from './types';

export const buildStateSummary = (
  state: GameState,
  playerId: PlayerId,
  candidates: C2S[],
  map: SolarSystemMap,
): string => {
  const lines: string[] = [];
  const bodies = map.bodies;
  const player = state.players[playerId];
  const opponentId = playerId === 0 ? 1 : 0;

  lines.push(`Turn ${state.turnNumber}, Phase: ${state.phase}`);
  lines.push(
    `Active player: ${state.activePlayer === playerId ? 'YOU' : 'opponent'}`,
  );
  lines.push(`Objective: target=${player.targetBody}, home=${player.homeBody}`);

  lines.push('');
  lines.push('YOUR SHIPS:');
  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    lines.push(`  ${describeShip(ship, bodies)}`);
  }

  lines.push('');
  lines.push('ENEMY SHIPS:');
  for (const ship of state.ships) {
    if (ship.owner !== opponentId) continue;
    const visibility = ship.detected ? '' : ' (undetected)';
    lines.push(`  ${describeShip(ship, bodies)}${visibility}`);
  }

  if (state.ordnance.length > 0) {
    lines.push('');
    lines.push('ORDNANCE:');
    for (const ord of state.ordnance) {
      if (ord.lifecycle === 'destroyed') continue;
      const owner = ord.owner === playerId ? 'yours' : 'enemy';
      lines.push(
        `  ${ord.type} (${owner}), ${describePosition(ord.position, bodies)}, ${ord.turnsRemaining}T left`,
      );
    }
  }

  lines.push('');
  lines.push('CANDIDATES:');
  for (let i = 0; i < candidates.length; i++) {
    lines.push(`  ${describeCandidate(candidates[i], i)}`);
  }

  return lines.join('\n');
};

export interface BuildObservationOptions {
  gameCode: string;
  // Pre-built map, when the caller already has one (e.g. the bridge).
  // Omit to build a fresh one.
  map?: SolarSystemMap;
  // Omit the prose summary to save tokens for agents that parse JSON only.
  includeSummary?: boolean;
  // Omit the structured legal-action info for the same reason.
  includeLegalActionInfo?: boolean;
}

// Canonical agent observation builder. Both the bridge and the MCP server
// should call this instead of re-deriving candidates/summary/legal info.
export const buildObservation = (
  state: GameState,
  playerId: PlayerId,
  options: BuildObservationOptions,
): AgentTurnInput => {
  const map = options.map ?? buildSolarSystemMap();
  const candidates = buildCandidates(state, playerId, map);
  const includeSummary = options.includeSummary ?? true;
  const includeLegalActionInfo = options.includeLegalActionInfo ?? true;

  return {
    version: 1,
    gameCode: options.gameCode,
    playerId,
    state,
    candidates,
    recommendedIndex: 0,
    summary: includeSummary
      ? buildStateSummary(state, playerId, candidates, map)
      : undefined,
    legalActionInfo: includeLegalActionInfo
      ? buildLegalActionInfo(state, playerId)
      : undefined,
  };
};
