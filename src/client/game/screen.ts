import type { ClientState } from './phase';

export type ClientScreenPlan =
  | { kind: 'menu' }
  | { kind: 'connecting' }
  | { kind: 'waiting'; code: string }
  | { kind: 'fleetBuilding' }
  | { kind: 'hud' }
  | { kind: 'none' };

const HUD_STATES = new Set<ClientState>([
  'playing_astrogation',
  'playing_ordnance',
  'playing_logistics',
  'playing_combat',
  'playing_movementAnim',
  'playing_opponentTurn',
]);

export const deriveClientScreenPlan = (
  state: ClientState,
  gameCode: string | null,
): ClientScreenPlan => {
  switch (state) {
    case 'menu':
      return { kind: 'menu' };
    case 'connecting':
      return { kind: 'connecting' };
    case 'waitingForOpponent':
      return {
        kind: 'waiting',
        code: gameCode ?? '',
      };
    case 'playing_fleetBuilding':
      return { kind: 'fleetBuilding' };
    case 'gameOver':
      return { kind: 'none' };
    default:
      if (HUD_STATES.has(state)) {
        return { kind: 'hud' };
      }
      return { kind: 'none' };
  }
};
