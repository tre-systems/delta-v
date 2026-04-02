import type { ClientState } from './phase';

export type ClientScreenPlan =
  | { kind: 'menu' }
  | { kind: 'connecting' }
  | { kind: 'waiting' }
  | { kind: 'fleetBuilding' }
  | { kind: 'hud' }
  | { kind: 'none' };

export const deriveClientScreenPlan = (
  state: ClientState,
): ClientScreenPlan => {
  switch (state) {
    case 'menu':
      return { kind: 'menu' };
    case 'connecting':
      return { kind: 'connecting' };
    case 'waitingForOpponent':
      return { kind: 'waiting' };
    case 'playing_fleetBuilding':
      return { kind: 'fleetBuilding' };
    case 'playing_astrogation':
    case 'playing_ordnance':
    case 'playing_logistics':
    case 'playing_combat':
    case 'playing_movementAnim':
    case 'playing_opponentTurn':
      return { kind: 'hud' };
    case 'gameOver':
      return { kind: 'none' };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
};
