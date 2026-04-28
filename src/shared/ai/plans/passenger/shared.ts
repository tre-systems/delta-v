import type { GameState, PlayerId, Ship } from '../../../types';
import { maxBy } from '../../../util';

export const hasLivePassengerCarrier = (state: GameState): boolean =>
  state.ships.some(
    (ship) => ship.lifecycle === 'active' && (ship.passengersAboard ?? 0) > 0,
  );

export const findPrimaryPassengerCarrier = (
  state: GameState,
  playerId: PlayerId,
): Ship | null =>
  maxBy(
    state.ships.filter(
      (candidate) =>
        candidate.owner === playerId &&
        candidate.lifecycle !== 'destroyed' &&
        (candidate.passengersAboard ?? 0) > 0,
    ),
    (candidate) => (candidate.passengersAboard ?? 0) * 1000,
  ) ?? null;
