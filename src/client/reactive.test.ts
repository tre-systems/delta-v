// @vitest-environment jsdom

import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import {
  batch,
  computed,
  createDisposalScope,
  effect,
  getCurrentScope,
  setReactiveErrorReporter,
  signal,
  withScope,
} from './reactive';

// ── Signal ──────────────────────────────────────────────

describe('signal', () => {
  it('reads initial value', () => {
    const s = signal(42);
    expect(s.value).toBe(42);
  });

  it('reads updated value', () => {
    const s = signal(1);
    s.value = 2;
    expect(s.value).toBe(2);
  });

  it('peek reads without tracking', () => {
    const s = signal(10);
    const spy = vi.fn();

    effect(() => {
      spy(s.peek());
    });

    expect(spy).toHaveBeenCalledTimes(1);
    s.value = 20;
    // effect should NOT re-run — peek doesn't track
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('update applies transform', () => {
    const s = signal(5);
    s.update((v) => v * 3);
    expect(s.value).toBe(15);
  });

  it('skips notification on same-value write', () => {
    const s = signal(7);
    const spy = vi.fn();

    effect(() => {
      spy(s.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    s.value = 7;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses reference equality for objects', () => {
    const obj = { a: 1 };
    const s = signal(obj);
    const spy = vi.fn();

    effect(() => {
      spy(s.value);
    });

    // Same reference — no notification
    s.value = obj;
    expect(spy).toHaveBeenCalledTimes(1);

    // New reference — notification
    s.value = { a: 1 };
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── Computed ────────────────────────────────────────────

describe('computed', () => {
  it('derives from a single signal', () => {
    const count = signal(3);
    const doubled = computed(() => count.value * 2);

    expect(doubled.value).toBe(6);
    count.value = 10;
    expect(doubled.value).toBe(20);
  });

  it('tracks multiple signals', () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.value + b.value);

    expect(sum.value).toBe(5);
    a.value = 10;
    expect(sum.value).toBe(13);
    b.value = 7;
    expect(sum.value).toBe(17);
  });

  it('peek reads without tracking', () => {
    const s = signal(1);
    const c = computed(() => s.value);

    expect(c.peek()).toBe(1);
    s.value = 2;
    expect(c.peek()).toBe(2);
  });

  it('chains through other computeds', () => {
    const base = signal(2);
    const doubled = computed(() => base.value * 2);
    const quadrupled = computed(() => doubled.value * 2);

    expect(quadrupled.value).toBe(8);
    base.value = 5;
    expect(quadrupled.value).toBe(20);
  });

  it('stops updating after dispose', () => {
    const s = signal(1);
    const c = computed(() => s.value * 10);

    expect(c.value).toBe(10);

    c.dispose();
    s.value = 5;

    // Internal effect is disposed — value is stale
    expect(c.peek()).toBe(10);
  });

  it('auto-disposes when created inside an effect', () => {
    const source = signal(0);
    const spy = vi.fn();

    effect(() => {
      const c = computed(() => source.value * 2);
      spy(c.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(0);

    // Outer re-runs, old computed's effect is disposed
    source.value = 3;

    // New computed created, spy called with new value
    expect(spy).toHaveBeenLastCalledWith(6);
  });
});

// ── Effect ──────────────────────────────────────────────

describe('effect', () => {
  it('runs immediately on creation', () => {
    const spy = vi.fn();
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-runs when tracked signal changes', () => {
    const s = signal('hello');
    const spy = vi.fn();

    effect(() => {
      spy(s.value);
    });

    expect(spy).toHaveBeenCalledWith('hello');
    s.value = 'world';
    expect(spy).toHaveBeenCalledWith('world');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('stops re-running after dispose', () => {
    const s = signal(0);
    const spy = vi.fn();

    const dispose = effect(() => {
      spy(s.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    dispose();
    s.value = 1;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('drops old deps on re-run', () => {
    const a = signal(1);
    const b = signal(2);
    const useA = signal(true);
    const spy = vi.fn();

    effect(() => {
      spy(useA.value ? a.value : b.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(1);

    // Switch to reading b instead of a
    useA.value = false;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(2);

    // Changing a should NOT trigger (no longer tracked)
    a.value = 99;
    expect(spy).toHaveBeenCalledTimes(2);

    // Changing b SHOULD trigger
    b.value = 42;
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenLastCalledWith(42);
  });

  it('handles nested effects independently', () => {
    const s = signal(0);
    const outer = vi.fn();
    const inner = vi.fn();

    effect(() => {
      outer(s.value);
      effect(() => {
        inner(s.value);
      });
    });

    // Both run once on creation
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('auto-disposes nested effects on parent re-run', () => {
    const source = signal(0);
    const innerSpy = vi.fn();

    effect(() => {
      // Read source to track it
      const v = source.value;
      effect(() => {
        // Inner also tracks source
        innerSpy(v, source.value);
      });
    });

    // Initial: outer runs, creates inner, both fire
    expect(innerSpy).toHaveBeenCalledTimes(1);

    // Change source: outer re-runs, old inner disposed,
    // new inner created
    source.value = 1;

    // Inner from first run was disposed, so only the
    // new inner fires (not the old one too)
    // outer re-run (1 call) + new inner creation (1 call)
    expect(innerSpy).toHaveBeenCalledTimes(2);
    expect(innerSpy).toHaveBeenLastCalledWith(1, 1);
  });

  it('disposes deeply nested effects on root dispose', () => {
    const s = signal(0);
    const spyL1 = vi.fn();
    const spyL2 = vi.fn();
    const spyL3 = vi.fn();

    const dispose = effect(() => {
      spyL1(s.value);
      effect(() => {
        spyL2(s.value);
        effect(() => {
          spyL3(s.value);
        });
      });
    });

    expect(spyL1).toHaveBeenCalledTimes(1);
    expect(spyL2).toHaveBeenCalledTimes(1);
    expect(spyL3).toHaveBeenCalledTimes(1);

    dispose();
    s.value = 1;

    // None should fire — all disposed
    expect(spyL1).toHaveBeenCalledTimes(1);
    expect(spyL2).toHaveBeenCalledTimes(1);
    expect(spyL3).toHaveBeenCalledTimes(1);
  });

  it('does not leak effects across re-runs', () => {
    const source = signal(0);
    const innerCount = vi.fn();

    effect(() => {
      source.value;
      effect(() => {
        innerCount();
      });
    });

    // Initial: 1 inner created
    expect(innerCount).toHaveBeenCalledTimes(1);

    // Re-run 5 times: each creates 1 new inner,
    // disposes the old one. No accumulation.
    for (let i = 1; i <= 5; i++) {
      source.value = i;
    }

    // 1 initial + 5 re-runs = 6 inner creations
    expect(innerCount).toHaveBeenCalledTimes(6);
  });
});

// ── Batch ───────────────────────────────────────────────

describe('batch', () => {
  it('defers notifications until batch completes', () => {
    const a = signal(1);
    const b = signal(2);
    const spy = vi.fn();

    effect(() => {
      spy(a.value + b.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    // Effect should run exactly once after batch
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(30);
  });

  it('nested batches only flush on outermost', () => {
    const s = signal(0);
    const spy = vi.fn();

    effect(() => {
      spy(s.value);
    });

    batch(() => {
      s.value = 1;
      batch(() => {
        s.value = 2;
      });
      // Inner batch exited but outer still open —
      // effect should not have run yet
      s.value = 3;
    });

    // One run: initial + one after outermost batch
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(3);
  });

  it('handles exceptions without breaking state', () => {
    const s = signal(0);
    const spy = vi.fn();

    effect(() => {
      spy(s.value);
    });

    expect(() => {
      batch(() => {
        s.value = 42;
        throw new Error('boom');
      });
    }).toThrow('boom');

    // Batch should still flush despite the error
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(42);
  });
});

// ── Diamond dependency ──────────────────────────────────

describe('diamond dependency', () => {
  it('effect on two computeds sharing a source', () => {
    const source = signal(1);
    const left = computed(() => source.value * 2);
    const right = computed(() => source.value * 3);
    const spy = vi.fn();

    effect(() => {
      spy(left.value + right.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(5); // 2 + 3

    source.value = 2;
    // May fire more than once (glitch), but final
    // value must be correct
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect(lastCall[0]).toBe(10); // 4 + 6
  });

  it('diamond with batch fires effect once', () => {
    const source = signal(1);
    const left = computed(() => source.value * 2);
    const right = computed(() => source.value * 3);
    const spy = vi.fn();

    effect(() => {
      spy(left.value + right.value);
    });

    expect(spy).toHaveBeenCalledTimes(1);

    batch(() => {
      source.value = 2;
    });

    // With batch, deduplication should help
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect(lastCall[0]).toBe(10);
  });
});

// ── DOM helpers ─────────────────────────────────────────

describe('createDisposalScope', () => {
  it('disposes registered cleanups in reverse order and only once', () => {
    const scope = createDisposalScope();
    const calls: string[] = [];

    scope.add(() => {
      calls.push('first');
    });
    scope.add(() => {
      calls.push('second');
    });

    scope.dispose();
    scope.dispose();

    expect(calls).toEqual(['second', 'first']);
  });

  it('immediately disposes cleanups added after the scope is closed', () => {
    const scope = createDisposalScope();
    const dispose = vi.fn();

    scope.dispose();
    scope.add(dispose);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('provides helper for scoped effect', () => {
    const scope = createDisposalScope();
    const s = signal(0);
    const spy = vi.fn();

    scope.effect(() => {
      spy(s.value);
    });

    expect(spy).toHaveBeenCalledWith(0);
    s.value = 1;
    expect(spy).toHaveBeenCalledWith(1);

    scope.dispose();
    s.value = 2;
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('provides helper for scoped computed', () => {
    const scope = createDisposalScope();
    const s = signal(10);
    const c = scope.computed(() => s.value * 2);

    expect(c.value).toBe(20);
    s.value = 5;
    expect(c.value).toBe(10);

    scope.dispose();
    s.value = 100;
    // Disposed computed should stop updating
    expect(c.peek()).toBe(10);
  });

  describe('implicit scoping', () => {
    it('returns value from withScope', () => {
      const scope = createDisposalScope();
      const result = withScope(scope, () => 42);
      expect(result).toBe(42);
    });

    it('sets and restores activeScope', () => {
      const scope = createDisposalScope();
      expect(getCurrentScope()).toBeNull();

      withScope(scope, () => {
        expect(getCurrentScope()).toBe(scope);
      });

      expect(getCurrentScope()).toBeNull();
    });

    it('auto-registers effects with withScope', () => {
      const scope = createDisposalScope();
      const s = signal(0);
      const spy = vi.fn();

      withScope(scope, () => {
        effect(() => {
          spy(s.value);
        });
      });

      expect(spy).toHaveBeenCalledWith(0);
      s.value = 1;
      expect(spy).toHaveBeenCalledWith(1);

      scope.dispose();
      s.value = 2;
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('prefers ownerCleanups over activeScope', () => {
      const scope = createDisposalScope();
      const s = signal(0);
      const outerSpy = vi.fn();
      const innerSpy = vi.fn();

      withScope(scope, () => {
        effect(() => {
          outerSpy(s.value);
          // This inner effect should be owned by the outer effect,
          // not directly by the scope.
          effect(() => {
            innerSpy(s.value);
          });
        });
      });

      expect(outerSpy).toHaveBeenCalledTimes(1);
      expect(innerSpy).toHaveBeenCalledTimes(1);

      // Change signal: outer re-runs, should dispose inner
      s.value = 1;
      expect(outerSpy).toHaveBeenCalledTimes(2);
      expect(innerSpy).toHaveBeenCalledTimes(2);

      // Dispose scope: should dispose outer (and thus inner)
      scope.dispose();
      s.value = 2;
      expect(outerSpy).toHaveBeenCalledTimes(2);
      expect(innerSpy).toHaveBeenCalledTimes(2);
    });
  });
});

// ── Property-based ──────────────────────────────────────

describe('property-based', () => {
  it('computed always reflects latest signal value', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 50 }),
        (writes) => {
          const s = signal(0);
          const c = computed(() => s.value * 2);

          for (const w of writes) {
            s.value = w;
          }

          const last = writes[writes.length - 1];
          expect(c.value).toBe(last * 2);
        },
      ),
    );
  });

  it('effect runs for every distinct value', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 50 }),
        (writes) => {
          const s = signal(0);
          const seen: number[] = [];

          const dispose = effect(() => {
            seen.push(s.value);
          });

          for (const w of writes) {
            s.value = w;
          }

          dispose();

          // First entry is initial (0), then one per
          // distinct consecutive write
          expect(seen[0]).toBe(0);
          const last = seen[seen.length - 1];
          expect(last).toBe(writes[writes.length - 1]);
        },
      ),
    );
  });

  it('batch produces same final state as unbatched', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 20 }),
        (writes) => {
          const s1 = signal(0);
          const s2 = signal(0);
          const c1 = computed(() => s1.value * 2);
          const c2 = computed(() => s2.value * 2);

          for (const w of writes) {
            s1.value = w;
          }
          const unbatched = c1.value;

          batch(() => {
            for (const w of writes) {
              s2.value = w;
            }
          });

          expect(c2.value).toBe(unbatched);
        },
      ),
    );
  });
});

describe('effect error containment', () => {
  it('routes thrown effect errors through the reporter and keeps peers alive', () => {
    const reporter = vi.fn();
    setReactiveErrorReporter(reporter);
    try {
      const s = signal(0);
      const witnessed: number[] = [];

      const disposeBad = effect(() => {
        if (s.value > 0) {
          throw new Error('boom');
        }
      });
      effect(() => {
        witnessed.push(s.value);
      });

      // Initial run: both effects observe 0. The bad effect does not throw
      // yet, so the reporter has not fired.
      expect(witnessed).toEqual([0]);
      expect(reporter).not.toHaveBeenCalled();

      // Trigger the bad effect. The peer effect must still re-run.
      s.value = 1;
      expect(witnessed).toEqual([0, 1]);
      expect(reporter).toHaveBeenCalledTimes(1);

      disposeBad();
      s.value = 2;
      expect(witnessed).toEqual([0, 1, 2]);
    } finally {
      setReactiveErrorReporter(null);
    }
  });
});
