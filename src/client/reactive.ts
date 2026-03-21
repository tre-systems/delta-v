// reactive.ts — Signals for TypeScript
// Zero dependencies. Auto-tracking reactivity.

export type Dispose = () => void;

// ── Tracking context ────────────────────────────────────

interface Context {
  run: () => void;
  deps: Set<Set<() => void>>;
}

let active: Context | null = null;
let batchDepth = 0;
const pending = new Set<() => void>();

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

  if (ownerCleanups) ownerCleanups.push(dispose);
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

// ── DOM helpers ─────────────────────────────────────────

export const bindText = (
  s: ReadonlySignal<unknown>,
  el: HTMLElement,
): Dispose =>
  effect(() => {
    el.textContent = String(s.value);
  });

export const bindClass = (
  s: ReadonlySignal<boolean>,
  el: HTMLElement,
  cls: string,
): Dispose =>
  effect(() => {
    el.classList.toggle(cls, s.value);
  });
