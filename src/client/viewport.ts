interface ViewportMeasurementInput {
  clientHeight?: number;
  clientWidth?: number;
  innerHeight: number;
  innerWidth: number;
  visualViewport?: {
    height: number;
    width: number;
  } | null;
}

interface ViewportSize {
  height: number;
  width: number;
}

const normalizeViewportSize = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;

export const measureViewportSize = (
  input: ViewportMeasurementInput,
): ViewportSize => {
  const width = Math.max(
    normalizeViewportSize(input.innerWidth),
    normalizeViewportSize(input.clientWidth),
    normalizeViewportSize(input.visualViewport?.width),
  );
  const height = Math.max(
    normalizeViewportSize(input.innerHeight),
    normalizeViewportSize(input.clientHeight),
    normalizeViewportSize(input.visualViewport?.height),
  );

  return { width, height };
};

export const syncViewportCssVars = (
  root: HTMLElement = document.documentElement,
  windowLike: Window = window,
): ViewportSize => {
  const size = measureViewportSize({
    innerWidth: windowLike.innerWidth,
    innerHeight: windowLike.innerHeight,
    clientWidth: root.clientWidth,
    clientHeight: root.clientHeight,
    visualViewport: windowLike.visualViewport,
  });

  root.style.setProperty('--app-width', `${size.width}px`);
  root.style.setProperty('--app-height', `${size.height}px`);

  return size;
};

export const installViewportSizing = (
  root: HTMLElement = document.documentElement,
  windowLike: Window = window,
): (() => void) => {
  let frame: number | null = null;
  let settleTimer: number | null = null;

  const syncNow = () => {
    if (frame !== null) {
      windowLike.cancelAnimationFrame(frame);
      frame = null;
    }

    syncViewportCssVars(root, windowLike);
  };

  const sync = () => {
    frame = null;
    syncViewportCssVars(root, windowLike);
  };

  const queueSync = () => {
    if (frame === null) {
      frame = windowLike.requestAnimationFrame(sync);
    }

    if (settleTimer !== null) {
      windowLike.clearTimeout(settleTimer);
    }

    // iOS standalone can settle viewport metrics slightly after load/resize.
    settleTimer = windowLike.setTimeout(() => {
      settleTimer = null;
      syncNow();
    }, 250);
  };

  syncNow();
  queueSync();
  windowLike.addEventListener('resize', queueSync);
  windowLike.addEventListener('orientationchange', queueSync);
  windowLike.addEventListener('pageshow', queueSync);
  windowLike.visualViewport?.addEventListener('resize', queueSync);

  return () => {
    windowLike.removeEventListener('resize', queueSync);
    windowLike.removeEventListener('orientationchange', queueSync);
    windowLike.removeEventListener('pageshow', queueSync);
    windowLike.visualViewport?.removeEventListener('resize', queueSync);

    if (frame !== null) {
      windowLike.cancelAnimationFrame(frame);
    }

    if (settleTimer !== null) {
      windowLike.clearTimeout(settleTimer);
    }
  };
};
