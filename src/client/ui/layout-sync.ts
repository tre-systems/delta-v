type CreateLayoutSyncInput = {
  isHudVisible: () => boolean;
  applyMetrics: () => void;
  clearMetrics: () => void;
};

export const createLayoutSync = ({
  isHudVisible,
  applyMetrics,
  clearMetrics,
}: CreateLayoutSyncInput) => {
  let frameId: number | null = null;

  const reset = () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }

    clearMetrics();
  };

  const sync = () => {
    if (!isHudVisible()) {
      reset();
      return;
    }

    applyMetrics();
  };

  const queue = () => {
    if (frameId !== null) return;

    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      sync();
    });
  };

  return {
    reset,
    sync,
    queue,
  };
};
