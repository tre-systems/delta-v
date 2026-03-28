import type { PlayerId } from '../../shared/types/domain';

type CreateSessionActionsInput = {
  setPlayerId: (id: PlayerId | -1) => void;
  setMenuLoading: (loading: boolean) => void;
};

export const createSessionActions = ({
  setPlayerId,
  setMenuLoading,
}: CreateSessionActionsInput) => ({
  setPlayerId,
  setMenuLoading,
});
