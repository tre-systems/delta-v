import { type HexCoord, hexEqual } from '../../shared/hex';
import type { GameState, Ship } from '../../shared/types/domain';
import type { ClientState } from './phase';

const TOOLTIP_HIDDEN_STATES = new Set<ClientState>([
  'menu',
  'connecting',
  'waitingForOpponent',
  'playing_movementAnim',
  'gameOver',
]);

export const getTooltipShip = (
  state: GameState | null,
  clientState: ClientState,
  playerId: number,
  hoverHex: HexCoord,
): Ship | null => {
  if (!state || TOOLTIP_HIDDEN_STATES.has(clientState)) {
    return null;
  }

  return (
    state.ships.find((ship) => {
      if (ship.lifecycle === 'destroyed') return false;
      if (ship.owner !== playerId && !ship.detected) return false;

      return hexEqual(ship.position, hoverHex);
    }) ?? null
  );
};
