interface ViewportMeasurementInput {
  availScreenHeight?: number;
  availScreenWidth?: number;
  clientHeight?: number;
  clientWidth?: number;
  innerHeight: number;
  innerWidth: number;
  isStandalone?: boolean;
  screenHeight?: number;
  screenWidth?: number;
  visualViewport?: {
    height: number;
    width: number;
  } | null;
}

interface ViewportSize {
  height: number;
  width: number;
}

const MAX_STANDALONE_VIEWPORT_GAP_PX = 160;

const normalizeViewportSize = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;

const resolveStandaloneScreenSize = (
  input: ViewportMeasurementInput,
): ViewportSize => {
  const screenWidth = Math.max(
    normalizeViewportSize(input.screenWidth),
    normalizeViewportSize(input.availScreenWidth),
  );
  const screenHeight = Math.max(
    normalizeViewportSize(input.screenHeight),
    normalizeViewportSize(input.availScreenHeight),
  );

  if (screenWidth === 0 || screenHeight === 0) {
    return { width: 0, height: 0 };
  }

  const longSide = Math.max(screenWidth, screenHeight);
  const shortSide = Math.min(screenWidth, screenHeight);
  const usePortrait =
    normalizeViewportSize(input.innerHeight) >=
    normalizeViewportSize(input.innerWidth);

  return {
    width: usePortrait ? shortSide : longSide,
    height: usePortrait ? longSide : shortSide,
  };
};

const expandStandaloneViewport = (
  measured: ViewportSize,
  screen: ViewportSize,
): ViewportSize => {
  const widthGap = screen.width - measured.width;
  const heightGap = screen.height - measured.height;

  return {
    width:
      widthGap > 0 && widthGap <= MAX_STANDALONE_VIEWPORT_GAP_PX
        ? screen.width
        : measured.width,
    height:
      heightGap > 0 && heightGap <= MAX_STANDALONE_VIEWPORT_GAP_PX
        ? screen.height
        : measured.height,
  };
};

export const measureViewportSize = (
  input: ViewportMeasurementInput,
): ViewportSize => {
  const measured = {
    width: Math.max(
      normalizeViewportSize(input.innerWidth),
      normalizeViewportSize(input.clientWidth),
      normalizeViewportSize(input.visualViewport?.width),
    ),
    height: Math.max(
      normalizeViewportSize(input.innerHeight),
      normalizeViewportSize(input.clientHeight),
      normalizeViewportSize(input.visualViewport?.height),
    ),
  };

  if (!input.isStandalone) {
    return measured;
  }

  return expandStandaloneViewport(measured, resolveStandaloneScreenSize(input));
};

const isStandaloneDisplayMode = (windowLike: Window): boolean =>
  windowLike.matchMedia('(display-mode: standalone)').matches ||
  (windowLike.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;

export const syncViewportCssVars = (
  root: HTMLElement = document.documentElement,
  windowLike: Window = window,
): ViewportSize => {
  const size = measureViewportSize({
    innerWidth: windowLike.innerWidth,
    innerHeight: windowLike.innerHeight,
    clientWidth: root.clientWidth,
    clientHeight: root.clientHeight,
    isStandalone: isStandaloneDisplayMode(windowLike),
    screenWidth: windowLike.screen.width,
    screenHeight: windowLike.screen.height,
    availScreenWidth: windowLike.screen.availWidth,
    availScreenHeight: windowLike.screen.availHeight,
    visualViewport: windowLike.visualViewport,
  });

  const widthValue = `${size.width}px`;
  const heightValue = `${size.height}px`;

  if (root.style.getPropertyValue('--app-width') !== widthValue) {
    root.style.setProperty('--app-width', widthValue);
  }

  if (root.style.getPropertyValue('--app-height') !== heightValue) {
    root.style.setProperty('--app-height', heightValue);
  }

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

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      queueSync();
    }
  };

  syncNow();

  settleTimer = windowLike.setTimeout(() => {
    settleTimer = null;
    syncNow();
  }, 250);

  windowLike.addEventListener('resize', queueSync);
  windowLike.addEventListener('orientationchange', queueSync);
  windowLike.addEventListener('pageshow', handlePageShow);
  windowLike.visualViewport?.addEventListener('resize', queueSync);

  return () => {
    windowLike.removeEventListener('resize', queueSync);
    windowLike.removeEventListener('orientationchange', queueSync);
    windowLike.removeEventListener('pageshow', handlePageShow);
    windowLike.visualViewport?.removeEventListener('resize', queueSync);

    if (frame !== null) {
      windowLike.cancelAnimationFrame(frame);
    }

    if (settleTimer !== null) {
      windowLike.clearTimeout(settleTimer);
    }
  };
};
