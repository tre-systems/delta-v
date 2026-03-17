import type { GameState } from '../shared/types';

export type BurnChangePlan =
  | { kind: 'noop' }
  | { kind: 'error'; message: string; level: 'info' | 'error' }
  | {
      kind: 'update';
      shipId: string;
      nextBurn: number | null;
      clearOverload: boolean;
    };

export const deriveBurnChangePlan = (
  state: GameState | null,
  selectedShipId: string | null,
  direction: number,
  currentBurn: number | null,
): BurnChangePlan => {
  if (!state) {
    return { kind: 'noop' };
  }
  if (!selectedShipId) {
    return {
      kind: 'error',
      message: 'Select a ship first',
      level: 'info',
    };
  }

  const ship = state.ships.find((candidate) => candidate.id === selectedShipId);
  if (!ship || ship.destroyed) {
    return { kind: 'noop' };
  }
  if (ship.damage.disabledTurns > 0) {
    return {
      kind: 'error',
      message: `Ship disabled for ${ship.damage.disabledTurns} more turn(s)`,
      level: 'error',
    };
  }
  if (ship.fuel <= 0) {
    return {
      kind: 'error',
      message: 'No fuel remaining',
      level: 'error',
    };
  }

  return {
    kind: 'update',
    shipId: selectedShipId,
    nextBurn: currentBurn === direction ? null : direction,
    clearOverload: currentBurn !== direction,
  };
};
