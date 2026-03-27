import { SHIP_STATS } from '../../shared/constants';
import { type HexCoord, hexKey } from '../../shared/hex';
import type { GameState, ShipMovement } from '../../shared/types/domain';
export interface LandingLogEntry {
  destination: HexCoord;
  shipName: string;
  bodyName: string;
  resupplyText: string | null;
}

export const deriveLandingLogEntries = (
  state: GameState | null,
  movements: ShipMovement[],
): LandingLogEntry[] => {
  if (!state) {
    return [];
  }
  return movements
    .filter(
      (
        movement,
      ): movement is typeof movement & {
        outcome: 'landing';
        landedAt: string;
      } => movement.outcome === 'landing',
    )
    .map((movement) => {
      const ship = state.ships.find(
        (candidate) => candidate.id === movement.shipId,
      );

      if (!ship) return null;
      const shipName = SHIP_STATS[ship.type]?.name ?? ship.type;
      const player = state.players[ship.owner];
      return {
        destination: movement.to,
        shipName,
        bodyName: movement.landedAt,
        resupplyText: player?.bases.includes(hexKey(movement.to))
          ? `  ${shipName} resupplied: fuel + cargo restored`
          : null,
      };
    })
    .filter((entry): entry is LandingLogEntry => entry !== null);
};
