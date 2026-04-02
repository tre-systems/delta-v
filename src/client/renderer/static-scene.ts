import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import type { Camera } from './camera';
import {
  renderAsteroids as renderAsteroidsFn,
  renderBodies as renderBodiesFn,
  renderGravityIndicators as renderGravityIndicatorsFn,
  renderHexGrid as renderHexGridFn,
  renderStars as renderStarsFn,
  type Star,
} from './scene';
import {
  computeStaticSceneLayerKey,
  createStaticSceneLayer,
  type StaticSceneLayer,
} from './static-layer';

const repaintStaticLayer = (
  layer: StaticSceneLayer,
  input: {
    width: number;
    height: number;
    camera: Camera;
    map: SolarSystemMap;
    gameState: GameState | null;
    stars: Star[];
    hexSize: number;
    now: number;
  },
): void => {
  const lctx = layer.ctx as CanvasRenderingContext2D;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, input.width, input.height);
  lctx.save();
  input.camera.applyTransform(lctx);
  renderStarsFn(lctx, input.stars, input.camera.zoom);
  renderHexGridFn(lctx, input.map, input.hexSize, (x, y) =>
    input.camera.isVisible(x, y),
  );
  renderAsteroidsFn(
    lctx,
    input.map,
    input.gameState?.destroyedAsteroids ?? [],
    input.hexSize,
    (x, y) => input.camera.isVisible(x, y),
  );
  renderGravityIndicatorsFn(lctx, input.map, input.hexSize, (x, y) =>
    input.camera.isVisible(x, y),
  );
  renderBodiesFn(lctx, input.map, input.hexSize, input.now, input.camera.zoom);
  lctx.restore();
};

export const drawStaticSceneWithCache = (input: {
  mainCtx: CanvasRenderingContext2D;
  layerRef: { layer: StaticSceneLayer | null };
  now: number;
  width: number;
  height: number;
  camera: Camera;
  map: SolarSystemMap;
  gameState: GameState | null;
  stars: Star[];
  hexSize: number;
}): boolean => {
  if (input.width <= 0 || input.height <= 0) return false;

  const key = computeStaticSceneLayerKey({
    map: input.map,
    camera: input.camera,
    gameState: input.gameState,
    now: input.now,
    width: input.width,
    height: input.height,
  });
  if (key === null) return false;

  let layer = input.layerRef.layer;
  if (!layer || layer.width !== input.width || layer.height !== input.height) {
    layer = createStaticSceneLayer(input.width, input.height);
    input.layerRef.layer = layer;
  }
  if (!layer) return false;

  if (layer.key !== key) {
    repaintStaticLayer(layer, {
      width: input.width,
      height: input.height,
      camera: input.camera,
      map: input.map,
      gameState: input.gameState,
      stars: input.stars,
      hexSize: input.hexSize,
      now: input.now,
    });
    layer.key = key;
  }
  input.mainCtx.drawImage(layer.canvas as CanvasImageSource, 0, 0);
  return true;
};
