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

export type InteractionState = {
  mode: InteractionMode;
};

export type InteractionEvent =
  | { type: 'ENTER_MENU' }
  | { type: 'ENTER_WAITING' }
  | { type: 'ENTER_FLEETBUILDING' }
  | { type: 'ENTER_ASTROGATION' }
  | { type: 'ENTER_ORDNANCE' }
  | { type: 'ENTER_LOGISTICS' }
  | { type: 'ENTER_COMBAT' }
  | { type: 'ENTER_ANIMATING' }
  | { type: 'ENTER_OPPONENT_TURN' }
  | { type: 'ENTER_GAME_OVER' };

export const applyInteractionEvent = (
  _state: InteractionState,
  event: InteractionEvent,
): InteractionState => {
  switch (event.type) {
    case 'ENTER_MENU':
      return { mode: 'menu' };
    case 'ENTER_WAITING':
      return { mode: 'waiting' };
    case 'ENTER_FLEETBUILDING':
      return { mode: 'fleetBuilding' };
    case 'ENTER_ASTROGATION':
      return { mode: 'astrogation' };
    case 'ENTER_ORDNANCE':
      return { mode: 'ordnance' };
    case 'ENTER_LOGISTICS':
      return { mode: 'logistics' };
    case 'ENTER_COMBAT':
      return { mode: 'combat' };
    case 'ENTER_ANIMATING':
      return { mode: 'animating' };
    case 'ENTER_OPPONENT_TURN':
      return { mode: 'opponentTurn' };
    case 'ENTER_GAME_OVER':
      return { mode: 'gameOver' };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};
