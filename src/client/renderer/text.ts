// Scale a CSS font string so text stays at a fixed screen size
// regardless of the camera zoom level applied to the canvas.
export const scaledFont = (font: string, zoom: number): string =>
  font.replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Number(size) / zoom}px`);
