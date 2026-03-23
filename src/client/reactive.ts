// reactive.ts — Signals for TypeScript
// Zero dependencies. Auto-tracking reactivity.

export type Dispose = () => void;
type DisposableLike = Dispose | { dispose: Dispose };

export interface DisposalScope {
  add<T extends DisposableLike>(disposable: T): T;
  effect(fn: () => void): Dispose;
  computed<T>(fn: () => T): Computed<T>;
  dispose: Dispose;
}

const getDispose = (disposable: DisposableLike): Dispose => {
  return typeof disposable === 'function' ? disposable : disposable.dispose;
};

// ── Tracking context ────────────────────────────────────

interface Context {
  run: () => void;
  deps: Set<Set<() => void>>;
}

let active: Context | null = null;
let activeScope: DisposalScope | null = null;
let batchDepth = 0;
const pending = new Set<() => void>();

export const withScope = <T>(scope: DisposalScope, fn: () => T): T => {
  const prev = activeScope;
  activeScope = scope;
  try {
    return fn();
  } finally {
    activeScope = prev;
  }
};

export const getCurrentScope = (): DisposalScope | null => activeScope;

export const registerDisposer = (dispose: Dispose): void => {
  if (ownerCleanups) {
    ownerCleanups.push(dispose);
  } else if (activeScope) {
    activeScope.add(dispose);
  }
};

// ── Signal ──────────────────────────────────────────────

export interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;
}

export interface Signal<T> extends ReadonlySignal<T> {
  value: T;
  update(fn: (v: T) => T): void;
}

export const signal = <T>(initial: T): Signal<T> => {
  let val = initial;
  const subs = new Set<() => void>();

  return {
    get value() {
      if (active) {
        subs.add(active.run);
        active.deps.add(subs);
      }
      return val;
    },
    set value(next: T) {
      if (next === val) return;
      val = next;

      if (batchDepth > 0) {
        for (const sub of subs) pending.add(sub);
      } else {
        for (const sub of [...subs]) sub();
      }
    },
    peek: () => val,
    update(fn) {
      this.value = fn(val);
    },
  };
};

export const createDisposalScope = (): DisposalScope => {
  const disposers: DisposableLike[] = [];
  let disposed = false;

  const scope: DisposalScope = {
    add(disposable) {
      if (disposed) {
        getDispose(disposable)();
        return disposable;
      }

      disposers.push(disposable);
      return disposable;
    },
    effect(fn) {
      return this.add(effect(fn));
    },
    computed(fn) {
      return this.add(computed(fn));
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      while (disposers.length > 0) {
        const disposable = disposers.pop();

        if (!disposable) {
          continue;
        }
        getDispose(disposable)();
      }
    },
  };

  return scope;
};

// ── Computed ────────────────────────────────────────────

export interface Computed<T> extends ReadonlySignal<T> {
  dispose: Dispose;
}

export const computed = <T>(fn: () => T): Computed<T> => {
  const s = signal(fn());
  const d = effect(() => {
    s.value = fn();
  });
  return {
    get value() {
      return s.value;
    },
    peek: s.peek,
    dispose: d,
  };
};

// ── Effect ──────────────────────────────────────────────

// Owner stack: tracks child disposals so parent effects
// automatically clean up nested effects on re-run.
let ownerCleanups: Dispose[] | null = null;

export const effect = (fn: () => void): Dispose => {
  const deps = new Set<Set<() => void>>();
  let cleanups: Dispose[] = [];
  let dead = false;

  // Internal: clear subscriptions and children so we
  // can re-subscribe on re-run.
  const cleanup = () => {
    for (const subs of deps) subs.delete(run);
    deps.clear();
    pending.delete(run);
    for (const c of cleanups) c();
    cleanups = [];
  };

  // External: permanently stop this effect.
  const dispose = () => {
    cleanup();
    dead = true;
  };

  const run = () => {
    if (dead) return;
    cleanup();
    const prev = active;
    const prevOwner = ownerCleanups;
    ownerCleanups = [];
    active = { run, deps };
    try {
      fn();
    } finally {
      active = prev;
      cleanups = ownerCleanups;
      ownerCleanups = prevOwner;
    }
  };

  registerDisposer(dispose);

  run();
  return dispose;
};

// ── Batch ───────────────────────────────────────────────

export const batch = (fn: () => void): void => {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;

    if (batchDepth === 0) {
      const fns = [...pending];
      pending.clear();
      for (const f of fns) f();
    }
  }
};
