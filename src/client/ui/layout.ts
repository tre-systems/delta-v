export interface MeasuredEdge {
  top: number;
  bottom: number;
}

export interface HudLayoutOffsets {
  hudTopOffsetPx: number;
  hudBottomOffsetPx: number;
}

const HUD_TOP_FALLBACK_PX = 72;
const HUD_BOTTOM_FALLBACK_PX = 80;
const HUD_MIN_PX = 32;
const HUD_GAP_PX = 12;

export const deriveHudLayoutOffsets = (
  viewportHeight: number,
  topBarRect: Pick<MeasuredEdge, 'bottom'> | null,
  bottomBarRect: Pick<MeasuredEdge, 'top'> | null,
): HudLayoutOffsets => {
  const hudTopOffsetPx = topBarRect
    ? Math.max(HUD_MIN_PX, Math.ceil(topBarRect.bottom + HUD_GAP_PX))
    : HUD_TOP_FALLBACK_PX;

  const hudBottomOffsetPx = bottomBarRect
    ? Math.max(HUD_MIN_PX, Math.ceil(viewportHeight - bottomBarRect.top + HUD_GAP_PX))
    : HUD_BOTTOM_FALLBACK_PX;

  return {
    hudTopOffsetPx,
    hudBottomOffsetPx,
  };
};
