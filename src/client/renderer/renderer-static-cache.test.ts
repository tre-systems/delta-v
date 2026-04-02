// @vitest-environment jsdom
//
// Scene render fns are wrapped so we can assert static-layer repaint behavior.
// This file uses hoisted vi.mock (Vitest) so ./scene is mocked before ./renderer
// and ./static-scene load — avoids flaky resetModules/doMock ordering with other
// tests in renderer.test.ts that import the real renderer first.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';

const sceneSpy = vi.hoisted(() => ({
  renderStars: vi.fn(),
  renderHexGrid: vi.fn(),
  renderAsteroids: vi.fn(),
  renderGravityIndicators: vi.fn(),
  renderBodies: vi.fn(),
}));

vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    renderStars: vi.fn((...args: Parameters<typeof actual.renderStars>) => {
      sceneSpy.renderStars();
      return actual.renderStars(...args);
    }),
    renderHexGrid: vi.fn((...args: Parameters<typeof actual.renderHexGrid>) => {
      sceneSpy.renderHexGrid();
      return actual.renderHexGrid(...args);
    }),
    renderAsteroids: vi.fn(
      (...args: Parameters<typeof actual.renderAsteroids>) => {
        sceneSpy.renderAsteroids();
        return actual.renderAsteroids(...args);
      },
    ),
    renderGravityIndicators: vi.fn(
      (...args: Parameters<typeof actual.renderGravityIndicators>) => {
        sceneSpy.renderGravityIndicators();
        return actual.renderGravityIndicators(...args);
      },
    ),
    renderBodies: vi.fn((...args: Parameters<typeof actual.renderBodies>) => {
      sceneSpy.renderBodies();
      return actual.renderBodies(...args);
    }),
  };
});

import { createRenderer } from './renderer';

describe('Renderer static scene cache (mocked scene)', () => {
  const createMockContext = () => ({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    canvas: { width: 800, height: 600 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineCap: '',
    lineJoin: '',
    shadowBlur: 0,
    shadowColor: '',
    globalCompositeOperation: '',
    setLineDash: vi.fn(),
  });

  const createMockCanvas = () => {
    const ctx = createMockContext();
    return {
      width: 800,
      height: 600,
      getContext: vi.fn(() => ctx),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      })),
      ctx,
    };
  };

  const createPlanningState = () => ({
    selectedShipId: null,
    burns: new Map<string, number | null>(),
    overloads: new Map<string, number | null>(),
    weakGravityChoices: new Map<string, Record<string, boolean>>(),
    landingShips: new Set<string>(),
    torpedoAccel: null as number | null,
    torpedoAccelSteps: null as 1 | 2 | null,
    ordnanceLaunches: [],
    combatTargetId: null as string | null,
    combatTargetType: null as 'ship' | 'ordnance' | null,
    combatAttackerIds: [] as string[],
    combatAttackStrength: null as number | null,
    queuedAttacks: [] as {
      attackerIds: string[];
      targetId: string;
      targetType: 'ship' | 'ordnance';
      attackStrength: number | null;
    }[],
    acknowledgedShips: new Set<string>(),
    queuedOrdnanceLaunches: [] as never[],
    acknowledgedOrdnanceShips: new Set<string>(),
    hoverHex: null as { q: number; r: number } | null,
    lastSelectedHex: null as string | null,
    baseEmplacements: [] as string[],
    transferPlan: [] as unknown[],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses the static scene layer when camera and state are unchanged', () => {
    const offscreenCtx = createMockContext();
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return offscreenCtx;
        }
      },
    );

    const canvas = createMockCanvas();
    const renderer = createRenderer(
      canvas as unknown as HTMLCanvasElement,
      createPlanningState(),
    );
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'REND2', findBaseHex);

    renderer.setMap(map);
    renderer.setGameState(state);

    renderer.renderFrameForTests(1000, 800, 600);
    renderer.renderFrameForTests(1100, 800, 600);

    expect(sceneSpy.renderStars).toHaveBeenCalledTimes(1);
    expect(sceneSpy.renderHexGrid).toHaveBeenCalledTimes(1);
    expect(sceneSpy.renderAsteroids).toHaveBeenCalledTimes(1);
    expect(sceneSpy.renderGravityIndicators).toHaveBeenCalledTimes(1);
    expect(sceneSpy.renderBodies).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it('invalidates the static scene layer when the camera changes', () => {
    const offscreenCtx = createMockContext();
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return offscreenCtx;
        }
      },
    );

    const canvas = createMockCanvas();
    const renderer = createRenderer(
      canvas as unknown as HTMLCanvasElement,
      createPlanningState(),
    );
    const map = buildSolarSystemMap();

    renderer.setMap(map);
    renderer.setGameState(
      createGame(SCENARIOS.biplanetary, map, 'REND3', findBaseHex),
    );

    renderer.renderFrameForTests(1000, 800, 600);
    renderer.camera.x = 12;
    renderer.camera.y = 8;
    renderer.renderFrameForTests(1100, 800, 600);

    expect(sceneSpy.renderStars).toHaveBeenCalledTimes(2);
  });
});
