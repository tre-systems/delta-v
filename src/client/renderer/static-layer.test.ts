import { describe, expect, it } from 'vitest';
import { createGame } from '../../shared/engine/game-engine';
import { asHexKey } from '../../shared/hex';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { createCamera } from './camera';
import { computeStaticSceneLayerKey } from './static-layer';

describe('computeStaticSceneLayerKey', () => {
  it('returns null when map is missing', () => {
    const camera = createCamera();
    camera.update(0, 800, 600);
    expect(
      computeStaticSceneLayerKey({
        map: null,
        camera,
        gameState: null,
        now: 1000,
        width: 800,
        height: 600,
      }),
    ).toBeNull();
  });

  it('changes when camera pan changes', () => {
    const map = buildSolarSystemMap();
    const camera = createCamera();
    camera.update(0, 800, 600);
    camera.x = 10;
    camera.y = 20;
    camera.zoom = 0.5;
    const state = createGame(SCENARIOS.duel, map, 'SK1', findBaseHex);
    const a = computeStaticSceneLayerKey({
      map,
      camera,
      gameState: state,
      now: 1000,
      width: 800,
      height: 600,
    });
    camera.x = 50;
    const b = computeStaticSceneLayerKey({
      map,
      camera,
      gameState: state,
      now: 1000,
      width: 800,
      height: 600,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('changes when destroyed asteroids list changes', () => {
    const map = buildSolarSystemMap();
    const camera = createCamera();
    camera.update(0, 800, 600);
    const baseState = createGame(SCENARIOS.duel, map, 'SK2', findBaseHex);
    const s1 = {
      ...baseState,
      destroyedAsteroids: [] as typeof baseState.destroyedAsteroids,
    };
    const s2 = { ...baseState, destroyedAsteroids: [asHexKey('a1')] };
    const k1 = computeStaticSceneLayerKey({
      map,
      camera,
      gameState: s1,
      now: 1000,
      width: 800,
      height: 600,
    });
    const k2 = computeStaticSceneLayerKey({
      map,
      camera,
      gameState: s2,
      now: 1000,
      width: 800,
      height: 600,
    });
    expect(k1).not.toBe(k2);
  });
});
