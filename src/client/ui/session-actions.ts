import type { PlayerId } from '../../shared/types/domain';

type CreateSessionActionsInput = {
  setPlayerId: (id: PlayerId | -1) => void;
  setMenuLoading: (loading: boolean) => void;
  setWaitingState: (code: string | null, connecting: boolean) => void;
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
