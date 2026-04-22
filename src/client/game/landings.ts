import { SHIP_STATS } from '../../shared/constants';
import { type HexCoord, hexKey } from '../../shared/hex';
import type {
  GameState,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';

export interface LandingLogEntry {
  destination: HexCoord;
  shipName: string;
  bodyName: string;
  reasonText: string;
  // Optional CSS class passed through to the log row. `log-info` for a
  // resupply success, `log-env` for the softer "no resupply" reasons, so
  // the follow-up line doesn't read as equally prominent as the landing
  // itself.
  reasonClass: 'log-info' | 'log-env';
}

const resupplyLine = (shipName: string): string =>
  `  ${shipName} resupplied: fuel + cargo restored`;

const noResupplyLine = (reason: string): string => `  No resupply — ${reason}`;

export const deriveLandingLogEntries = (
  state: GameState | null,
  movements: ShipMovement[],
  map: SolarSystemMap | null,
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
      const destKey = hexKey(movement.to);
      const ownsBase = player?.bases.includes(destKey) ?? false;

      if (ownsBase) {
        return {
          destination: movement.to,
          shipName,
          bodyName: movement.landedAt,
          reasonText: resupplyLine(shipName),
          reasonClass: 'log-info' as const,
        };
      }

      // Classify *why* no resupply happened so players can tell "wrong
      // kind of stop" from "engine bug". Need the map to distinguish a
      // neutral-but-real base hex from a bare body landing.
      const hex = map?.hexes.get(destKey);
      const isDestroyed = state.destroyedBases.includes(destKey);
      let reason: string;
      if (hex?.base && !isDestroyed) {
        const enemyOwns = state.players.some(
          (p, idx) => idx !== ship.owner && p.bases.includes(destKey),
        );
        reason = enemyOwns
          ? 'enemy-controlled base'
          : 'neutral base (not yours)';
      } else if (hex?.base && isDestroyed) {
        reason = 'base destroyed';
      } else {
        reason = 'no base on this body';
      }

      return {
        destination: movement.to,
        shipName,
        bodyName: movement.landedAt,
        reasonText: noResupplyLine(reason),
        reasonClass: 'log-env' as const,
      };
    })
    .filter((entry): entry is LandingLogEntry => entry !== null);
};
