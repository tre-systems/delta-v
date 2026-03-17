import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOVEMENT_ANIM_DURATION } from '../../shared/constants';

/**
 * Tests for the animation fallback timer in the Renderer.
 *
 * The Renderer uses requestAnimationFrame to detect animation completion,
 * but rAF is throttled or paused when the tab is backgrounded or the phone
 * screen is locked. A setTimeout fallback ensures animation callbacks fire
 * even when rAF stops.
 *
 * Since the Renderer class requires Canvas/DOM, we test the fallback logic
 * pattern directly rather than instantiating the full Renderer.
 */

interface AnimState {
  startTime: number;
  duration: number;
  onComplete: () => void;
}

/** Minimal reproduction of the Renderer's animation + fallback logic. */
const createAnimController = () => {
  let animState: AnimState | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    get animState() {
      return animState;
    },

    startAnimation: (duration: number, onComplete: () => void) => {
      animState = { startTime: performance.now(), duration, onComplete };

      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (animState) {
          const cb = animState.onComplete;
          animState = null;
          cb();
        }
      }, duration + 500);
    },

    /** Simulates what the rAF loop does when enough time has passed. */
    completeViaRAF: () => {
      if (animState) {
        if (fallbackTimer !== null) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        const cb = animState.onComplete;
        animState = null;
        cb();
      }
    },

    hasFallbackTimer: () => fallbackTimer !== null,
  };
};

describe('animation fallback timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onComplete via fallback when rAF never runs', () => {
    const ctrl = createAnimController();
    let completed = false;

    ctrl.startAnimation(MOVEMENT_ANIM_DURATION, () => {
      completed = true;
    });

    expect(ctrl.animState).not.toBeNull();
    expect(ctrl.hasFallbackTimer()).toBe(true);
    expect(completed).toBe(false);

    // Advance past duration + 500ms safety margin
    vi.advanceTimersByTime(MOVEMENT_ANIM_DURATION + 500);

    expect(completed).toBe(true);
    expect(ctrl.animState).toBeNull();
    expect(ctrl.hasFallbackTimer()).toBe(false);
  });

  it('clears fallback when rAF completes animation normally', () => {
    const ctrl = createAnimController();
    let completed = false;

    ctrl.startAnimation(MOVEMENT_ANIM_DURATION, () => {
      completed = true;
    });

    expect(ctrl.hasFallbackTimer()).toBe(true);

    // Simulate rAF completing the animation
    ctrl.completeViaRAF();

    expect(completed).toBe(true);
    expect(ctrl.animState).toBeNull();
    expect(ctrl.hasFallbackTimer()).toBe(false);

    // Advancing timers should NOT fire callback again
    completed = false;
    vi.advanceTimersByTime(MOVEMENT_ANIM_DURATION + 1000);
    expect(completed).toBe(false);
  });

  it('does not double-fire if rAF and timer both try to complete', () => {
    const ctrl = createAnimController();
    let callCount = 0;

    ctrl.startAnimation(MOVEMENT_ANIM_DURATION, () => {
      callCount++;
    });

    // rAF completes first
    ctrl.completeViaRAF();
    expect(callCount).toBe(1);

    // Timer fires but animState is already null
    vi.advanceTimersByTime(MOVEMENT_ANIM_DURATION + 500);
    expect(callCount).toBe(1);
  });

  it('replaces previous fallback timer on rapid re-animation', () => {
    const ctrl = createAnimController();
    let firstCompleted = false;
    let secondCompleted = false;

    ctrl.startAnimation(MOVEMENT_ANIM_DURATION, () => {
      firstCompleted = true;
    });

    // Start a new animation before the first one completes
    ctrl.startAnimation(MOVEMENT_ANIM_DURATION, () => {
      secondCompleted = true;
    });

    vi.advanceTimersByTime(MOVEMENT_ANIM_DURATION + 500);

    // Only the second animation callback should fire
    expect(firstCompleted).toBe(false);
    expect(secondCompleted).toBe(true);
  });
});
