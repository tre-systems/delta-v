import type { ClientState } from './game-client-phase';
import { buildInviteLink } from './game-client-session';

export type ClientScreenPlan =
  | { kind: 'menu' }
  | { kind: 'connecting' }
  | { kind: 'waiting'; code: string; inviteLink: string | null }
  | { kind: 'fleetBuilding' }
  | { kind: 'hud' }
  | { kind: 'none' };

const HUD_STATES = new Set<ClientState>([
  'playing_astrogation',
  'playing_ordnance',
  'playing_combat',
  'playing_movementAnim',
  'playing_opponentTurn',
]);

export const deriveClientScreenPlan = (
  state: ClientState,
  gameCode: string | null,
  inviteLink: string | null,
  storedInviteToken: string | null,
  origin: string,
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
        inviteLink:
          inviteLink ?? (gameCode && storedInviteToken ? buildInviteLink(origin, gameCode, storedInviteToken) : null),
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
