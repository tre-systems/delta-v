import type { ClientState } from './phase';

export type InteractionMode =
  | 'menu'
  | 'waiting'
  | 'fleetBuilding'
  | 'astrogation'
  | 'ordnance'
  | 'logistics'
  | 'combat'
  | 'animating'
  | 'opponentTurn'
  | 'gameOver';

export const deriveInteractionMode = (state: ClientState): InteractionMode => {
  switch (state) {
    case 'menu':
      return 'menu';
    case 'connecting':
    case 'waitingForOpponent':
      return 'waiting';
    case 'playing_fleetBuilding':
      return 'fleetBuilding';
    case 'playing_astrogation':
      return 'astrogation';
    case 'playing_ordnance':
      return 'ordnance';
    case 'playing_logistics':
      return 'logistics';
    case 'playing_combat':
      return 'combat';
    case 'playing_movementAnim':
      return 'animating';
    case 'playing_opponentTurn':
      return 'opponentTurn';
    case 'gameOver':
      return 'gameOver';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
};
