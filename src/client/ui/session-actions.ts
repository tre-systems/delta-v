import type { PlayerId } from '../../shared/types/domain';
import type { WaitingScreenState } from './screens';

type CreateSessionActionsInput = {
  setPlayerId: (id: PlayerId | -1) => void;
  setMenuLoading: (loading: boolean, kind?: 'create' | 'quickMatch') => void;
  setWaitingState: (state: WaitingScreenState | null) => void;
};

export const createSessionActions = ({
  setPlayerId,
  setMenuLoading,
  setWaitingState,
}: CreateSessionActionsInput) => ({
  setPlayerId,
  setMenuLoading,
  setWaitingState,
});
