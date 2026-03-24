type CreateSessionActionsInput = {
  setPlayerId: (id: number) => void;
  setMenuLoading: (loading: boolean) => void;
};

export const createSessionActions = ({
  setPlayerId,
  setMenuLoading,
}: CreateSessionActionsInput) => ({
  setPlayerId,
  setMenuLoading,
});
