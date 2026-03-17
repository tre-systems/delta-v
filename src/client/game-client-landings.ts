import { SHIP_STATS } from '../shared/constants';
import { type HexCoord, hexKey } from '../shared/hex';
import type { GameState, ShipMovement } from '../shared/types';

export interface LandingLogEntry {
  destination: HexCoord;
  shipName: string;
  bodyName: string;
  resupplyText: string | null;
}

export function deriveLandingLogEntries(state: GameState | null, movements: ShipMovement[]): LandingLogEntry[] {
  if (!state) {
    return [];
  }

  const entries: LandingLogEntry[] = [];
  for (const movement of movements) {
    if (!movement.landedAt) {
      continue;
    }
    const ship = state.ships.find((candidate) => candidate.id === movement.shipId);
    if (!ship) {
      continue;
    }
    const shipName = SHIP_STATS[ship.type]?.name ?? ship.type;
    const player = state.players[ship.owner];
    entries.push({
      destination: movement.to,
      shipName,
      bodyName: movement.landedAt,
      resupplyText: player?.bases.includes(hexKey(movement.to))
        ? `  ${shipName} resupplied: fuel + cargo restored`
        : null,
    });
  }
  return entries;
}
