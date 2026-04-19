// Viewer-aware colour helpers. The renderer paints P0/P1 fleets in
// distinct colours so a player can tell their ships from the opponent's.
// For spectators (playerId === -1, e.g. replay viewer or watch-only WS)
// the "own vs enemy" relationship is undefined, so anchor the mapping:
// P0 always gets the own colour, P1 always gets the enemy colour. That
// matches the HUD vocabulary ("Fleet 1" / "Fleet 2") used in the spectator
// stat pills and keeps two boards from looking identical.
//
// Player-id is the raw `playerIdSignal.value` from the client context;
// it is `0`, `1`, or `-1` in spectator mode.

import type { PlayerId } from '../../shared/types/domain';

export type ViewerSide = 'own' | 'enemy';

export const SPECTATOR_PLAYER_ID = -1 as const;

export const viewerSideFor = (
  owner: PlayerId,
  playerId: PlayerId | -1,
): ViewerSide => {
  if (playerId === SPECTATOR_PLAYER_ID) {
    return owner === 0 ? 'own' : 'enemy';
  }
  return owner === playerId ? 'own' : 'enemy';
};

export const isOwnShipForViewer = (
  owner: PlayerId,
  playerId: PlayerId | -1,
): boolean => viewerSideFor(owner, playerId) === 'own';
