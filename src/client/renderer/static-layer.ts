import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import type { Camera } from './camera';

export type LayerContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export interface StaticSceneLayer {
  canvas: CanvasImageSource;
  ctx: LayerContext;
  width: number;
  height: number;
  key: string | null;
}

export const invalidateStaticSceneLayer = (
  layer: StaticSceneLayer | null,
): void => {
  if (layer) layer.key = null;
};

export const createStaticSceneLayer = (
  width: number,
  height: number,
): StaticSceneLayer | null => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      return { canvas, ctx, width, height, key: null };
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      return { canvas, ctx, width, height, key: null };
    }
  }
  return null;
};

export const computeStaticSceneLayerKey = (input: {
  map: SolarSystemMap | null;
  camera: Camera;
  gameState: GameState | null;
  now: number;
  width: number;
  height: number;
}): string | null => {
  if (!input.map) return null;
  const bodyAnimationBucket = Math.floor(input.now / 250);
  const destroyedAsteroids =
    input.gameState?.destroyedAsteroids.join('|') ?? '';
  return [
    input.width,
    input.height,
    input.camera.x.toFixed(2),
    input.camera.y.toFixed(2),
    input.camera.zoom.toFixed(4),
    bodyAnimationBucket,
    destroyedAsteroids,
  ].join(':');
};
