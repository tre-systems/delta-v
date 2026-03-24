import { deriveHudLayoutOffsets } from './layout';

export const applyHudLayoutMetrics = (
  viewportHeight: number,
  topBarRect: DOMRect,
  bottomBarRect: DOMRect,
): void => {
  const offsets = deriveHudLayoutOffsets(
    viewportHeight,
    topBarRect,
    bottomBarRect,
  );
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty('--hud-top-offset', `${offsets.hudTopOffsetPx}px`);
  rootStyle.setProperty(
    '--hud-bottom-offset',
    `${offsets.hudBottomOffsetPx}px`,
  );
};

export const clearHudLayoutMetrics = (): void => {
  const rootStyle = document.documentElement.style;

  rootStyle.removeProperty('--hud-top-offset');
  rootStyle.removeProperty('--hud-bottom-offset');
};
