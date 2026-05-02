const MIN_ZOOM_FOR_VISIBILITY = 0.1;

export const screenLineWidth = (screenPixels: number, zoom: number): number =>
  screenPixels / Math.max(zoom, MIN_ZOOM_FOR_VISIBILITY);

export const minScreenScale = (
  zoom: number,
  minimumReadableZoom = 0.9,
): number =>
  Math.max(1, minimumReadableZoom / Math.max(zoom, MIN_ZOOM_FOR_VISIBILITY));

export const screenDash = (dash: number[], zoom: number): number[] =>
  dash.map((value) => screenLineWidth(value, zoom));
