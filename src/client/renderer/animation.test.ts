import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrdnanceId, asShipId } from '../../shared/ids';
import type { OrdnanceMovement, ShipMovement } from '../../shared/types/domain';
import {
  type AnimationState,
  collectAnimatedHexes,
  createMovementAnimationManager,
  getAnimationProgress,
} from './animation';

const shipMovement: ShipMovement = {
  shipId: asShipId('ship-1'),
  from: { q: 0, r: 0 },
  to: { q: 2, r: -1 },
  path: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: -1 },
  ],
  newVelocity: { dq: 2, dr: -1 },
  fuelSpent: 1,
  gravityEffects: [],
  outcome: 'normal',
};

const ordnanceMovement: OrdnanceMovement = {
  ordnanceId: asOrdnanceId('ord-1'),
  from: { q: 1, r: 1 },
  to: { q: 2, r: 1 },
  path: [
    { q: 1, r: 1 },
    { q: 2, r: 1 },
  ],
  detonated: false,
};

describe('movement animation manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records trails and completes via the fallback timer', () => {
    const now = 100;
    let completed = false;
    const manager = createMovementAnimationManager({
      now: () => now,
      durationMs: 1000,
      isDocumentHidden: () => false,
    });

    manager.start([shipMovement], [ordnanceMovement], () => {
      completed = true;
    });

    expect(manager.isAnimating()).toBe(true);
    expect(manager.getShipTrails().get('ship-1')).toEqual(shipMovement.path);
    expect(manager.getOrdnanceTrails().get('ord-1')).toEqual(
      ordnanceMovement.path,
    );

    vi.advanceTimersByTime(1500);

    expect(completed).toBe(true);
    expect(manager.isAnimating()).toBe(false);
  });

  it('replaces the prior animation callback on rapid restart', () => {
    let firstCompleted = false;
    let secondCompleted = false;
    const manager = createMovementAnimationManager({
      durationMs: 1000,
      isDocumentHidden: () => false,
    });

    manager.start([shipMovement], [], () => {
      firstCompleted = true;
    });
    manager.start([], [ordnanceMovement], () => {
      secondCompleted = true;
    });

    vi.advanceTimersByTime(1500);

    expect(firstCompleted).toBe(false);
    expect(secondCompleted).toBe(true);
  });

  it('completes stale animations on visibility changes after the duration elapses', () => {
    let now = 10;
    let completed = false;
    const manager = createMovementAnimationManager({
      now: () => now,
      durationMs: 400,
      isDocumentHidden: () => false,
    });

    manager.start([shipMovement], [], () => {
      completed = true;
    });

    now = 450;
    manager.handleVisibilityChange('visible', now);

    expect(completed).toBe(true);
    expect(manager.isAnimating()).toBe(false);
  });

  it('skips hidden-page animations but still records trails', () => {
    let completed = false;
    const manager = createMovementAnimationManager({
      isDocumentHidden: () => true,
    });

    manager.start([shipMovement], [ordnanceMovement], () => {
      completed = true;
    });

    expect(completed).toBe(true);
    expect(manager.isAnimating()).toBe(false);
    expect(manager.getShipTrails().get('ship-1')).toEqual(shipMovement.path);
    expect(manager.getOrdnanceTrails().get('ord-1')).toEqual(
      ordnanceMovement.path,
    );
  });

  it('caps per-entity trail history during long sessions', () => {
    const manager = createMovementAnimationManager({
      isDocumentHidden: () => true,
    });

    for (let i = 0; i < 140; i++) {
      manager.start(
        [
          {
            ...shipMovement,
            from: { q: i, r: 0 },
            to: { q: i + 1, r: 0 },
            path: [
              { q: i, r: 0 },
              { q: i + 1, r: 0 },
            ],
          },
        ],
        [],
        () => {},
      );
    }

    const trail = manager.getShipTrails().get('ship-1') ?? [];
    expect(trail).toHaveLength(96);
    expect(trail[0]).toEqual({ q: 45, r: 0 });
    expect(trail[trail.length - 1]).toEqual({ q: 140, r: 0 });
  });

  it('exposes progress and animated hex collection helpers', () => {
    const state: AnimationState = {
      movements: [shipMovement],
      ordnanceMovements: [ordnanceMovement],
      startTime: 200,
      duration: 400,
      onComplete: () => {},
    };

    expect(getAnimationProgress(state, 300)).toBeCloseTo(0.25);
    expect(getAnimationProgress(state, 700)).toBe(1);
    expect(collectAnimatedHexes([shipMovement], [ordnanceMovement])).toEqual([
      shipMovement.from,
      ordnanceMovement.from,
      shipMovement.to,
      ordnanceMovement.to,
    ]);
  });
});
