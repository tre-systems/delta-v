// Composes candidates, legal-action metadata, and prose summary into the
// canonical AgentTurnInput sent to every external agent.

import { HEX_DIRECTIONS } from '../hex';
import { buildSolarSystemMap } from '../map-data';
import type { GameState, PlayerId, SolarSystemMap } from '../types/domain';
import type { C2S } from '../types/protocol';
import { labelCandidates } from './candidate-labels';
import { buildCandidates } from './candidates';
import {
  DIRECTION_NAMES,
  describeCandidate,
  describePosition,
  describeShip,
} from './describe';
import { buildLegalActionInfo } from './legal-actions';
import { renderSpatialGrid } from './spatial-grid';
import { buildTacticalFeatures } from './tactical';
import type {
  AgentTurnInput,
  CoachDirective,
  LastTurnAutoPlayed,
} from './types';

const describeDirection = (dir: number): string =>
  DIRECTION_NAMES[dir] ?? `dir${dir}`;

export const buildStateSummary = (
  state: GameState,
  playerId: PlayerId,
  candidates: C2S[],
  map: SolarSystemMap,
  coachDirective?: CoachDirective,
): string => {
  const lines: string[] = [];
  const bodies = map.bodies;
  const player = state.players[playerId];
  const opponentId = playerId === 0 ? 1 : 0;

  if (coachDirective) {
    lines.push(
      `COACH DIRECTIVE (turn ${coachDirective.turnReceived}): ${coachDirective.text}`,
    );
    lines.push('');
  }

  lines.push(`Turn ${state.turnNumber}, Phase: ${state.phase}`);
  lines.push(
    `Active player: ${state.activePlayer === playerId ? 'YOU' : 'opponent'}`,
  );
  const targetLabel = player.targetBody ? player.targetBody : '—';
  const homeLabel = player.homeBody ? player.homeBody : '—';
  lines.push(`Objective: target=${targetLabel}, home=${homeLabel}`);

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

  // Predicted next-turn positions: velocity + pending gravity effects.
  const predictions: string[] = [];
  for (const ship of state.ships) {
    if (ship.lifecycle === 'destroyed') continue;
    let nextQ = ship.position.q + ship.velocity.dq;
    let nextR = ship.position.r + ship.velocity.dr;
    const gravityNotes: string[] = [];
    for (const grav of ship.pendingGravityEffects ?? []) {
      if (grav.ignored) continue;
      const dir = HEX_DIRECTIONS[grav.direction];
      if (dir) {
        nextQ += dir.dq;
        nextR += dir.dr;
        gravityNotes.push(
          `${grav.bodyName} pulls ${describeDirection(grav.direction)}`,
        );
      }
    }
    const from = `(${ship.position.q},${ship.position.r})`;
    const to = `(${nextQ},${nextR})`;
    const gravSuffix =
      gravityNotes.length > 0 ? ` [${gravityNotes.join(', ')}]` : '';
    predictions.push(`  ${ship.id}: ${from} -> ${to}${gravSuffix}`);
  }
  if (predictions.length > 0) {
    lines.push('');
    lines.push(
      'NEXT TURN PREDICTIONS (current velocity + pending gravity, before any new burns):',
    );
    lines.push(...predictions);
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
  /** When set, attached to the observation once (caller clears after emit). */
  lastTurnAutoPlayed?: LastTurnAutoPlayed;
  // Pre-built map, when the caller already has one (e.g. the bridge).
  // Omit to build a fresh one.
  map?: SolarSystemMap;
  // Omit the prose summary to save tokens for agents that parse JSON only.
  includeSummary?: boolean;
  // Omit the structured legal-action info for the same reason.
  includeLegalActionInfo?: boolean;
  // --- Observation v2 opt-ins (default off; adding them costs tokens) ---
  // Derived tactical features: distances, fuel advantage, threat axis, etc.
  includeTactical?: boolean;
  // ASCII hex grid visualisation of the current state from playerId's view.
  // Fog-of-war compliant — undetected enemies are omitted.
  includeSpatialGrid?: boolean;
  // Enriched candidate list with human-readable label, rationale, and a
  // crude risk tag per candidate.
  includeCandidateLabels?: boolean;
  // Mid-game coach directive loaded by the surface (GAME DO for remote
  // MCP, bridge for local) before calling the builder. The builder itself
  // is pure — it does not read server-side storage.
  coachDirective?: CoachDirective;
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
    ...(options.lastTurnAutoPlayed
      ? { lastTurnAutoPlayed: options.lastTurnAutoPlayed }
      : {}),
    summary: includeSummary
      ? buildStateSummary(
          state,
          playerId,
          candidates,
          map,
          options.coachDirective,
        )
      : undefined,
    legalActionInfo: includeLegalActionInfo
      ? buildLegalActionInfo(state, playerId)
      : undefined,
    tactical: options.includeTactical
      ? buildTacticalFeatures(state, playerId, map)
      : undefined,
    spatialGrid: options.includeSpatialGrid
      ? renderSpatialGrid(state, playerId, map)
      : undefined,
    labeledCandidates: options.includeCandidateLabels
      ? labelCandidates(candidates, state, playerId, map)
      : undefined,
    coachDirective: options.coachDirective,
  };
};

/**
 * Replace `state` with phase / turn / activePlayer only for smaller MCP
 * payloads. The object still types as {@link AgentTurnInput}; agents that need
 * the full authoritative state must omit compaction.
 */
export const withCompactObservationState = (
  observation: AgentTurnInput,
): AgentTurnInput => {
  const s = observation.state;
  const { lastTurnAutoPlayed, ...rest } = observation;
  return {
    ...rest,
    ...(lastTurnAutoPlayed ? { lastTurnAutoPlayed } : {}),
    state: {
      phase: s.phase,
      turnNumber: s.turnNumber,
      activePlayer: s.activePlayer,
    } as GameState,
  };
};

export const shapeObservationState = (
  observation: AgentTurnInput,
  compactState: boolean | undefined,
  defaultCompact = false,
): AgentTurnInput =>
  compactState === true || (compactState === undefined && defaultCompact)
    ? withCompactObservationState(observation)
    : observation;
