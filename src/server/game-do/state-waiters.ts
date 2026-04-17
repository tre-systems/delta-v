// In-memory registry of pending HTTP /mcp/wait requests.
//
// MCP HTTP clients call /mcp/wait?playerToken=… to long-poll for the next
// state-bearing publishStateChange (the same trigger that broadcasts to
// WebSocket clients). The DO holds a Set of resolvers per player; each
// publishStateChange wakes them all. Bounded by the number of in-flight
// HTTP clients per match (≤ a small handful in practice).
//
// On DO eviction the Set is lost; the in-flight HTTP request resolves on
// timeout and the agent retries — same recovery semantics as WebSocket
// reconnection.
//
// Intentionally has no DO storage dependency so the unit tests can exercise
// it without a Workers runtime.
//
// Usage:
//   const waiters = new StateWaiters();
//   const arrived = await waiters.wait(playerId, 25_000);  // false on timeout
//   …
//   waiters.wakeAll(playerId);   // resolve everything pending for that seat
//   waiters.wakeAllSeats();      // resolve every pending wait, e.g. on gameOver

import type { PlayerId } from '../../shared/types/domain';

type Waiter = {
  resolve: (arrived: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

// Per-seat cap on concurrent long-polls. In practice a single agent keeps
// at most one wait open at a time, so anything beyond this bound is a
// misbehaving or adversarial caller trying to pin the DO warm by fanning
// out /mcp/wait requests.
export const MAX_CONCURRENT_WAITERS_PER_SEAT = 5;

export class TooManyWaitersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TooManyWaitersError';
  }
}

export class StateWaiters {
  private readonly waitersBySeat = new Map<PlayerId, Set<Waiter>>();

  // Register a waiter for the given seat. Resolves true when wakeAll fires,
  // false when timeoutMs elapses first, and throws when the seat has
  // already reached MAX_CONCURRENT_WAITERS_PER_SEAT so the caller returns a
  // 429 to the abusive agent.
  wait(playerId: PlayerId, timeoutMs: number): Promise<boolean> {
    const existing = this.waitersBySeat.get(playerId);
    if (existing && existing.size >= MAX_CONCURRENT_WAITERS_PER_SEAT) {
      return Promise.reject(
        new TooManyWaitersError(
          `seat ${playerId} already has ${existing.size} concurrent waiters`,
        ),
      );
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const set = existing ?? new Set<Waiter>();
      this.waitersBySeat.set(playerId, set);

      const waiter: Waiter = {
        resolve: (arrived: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(waiter.timer);
          set.delete(waiter);
          if (set.size === 0) this.waitersBySeat.delete(playerId);
          resolve(arrived);
        },
        timer: setTimeout(() => waiter.resolve(false), timeoutMs),
      };

      set.add(waiter);
    });
  }

  // Wake every waiter registered for this seat. Safe to call when none exist.
  wakeAll(playerId: PlayerId): void {
    const set = this.waitersBySeat.get(playerId);
    if (!set) return;
    // Snapshot first — resolvers mutate the Set as they run.
    const snapshot = [...set];
    for (const waiter of snapshot) waiter.resolve(true);
  }

  // Wake every waiter for every seat. Used on terminal events (gameOver) so
  // long-polls return promptly with a fresh observation that reveals the
  // outcome.
  wakeAllSeats(): void {
    for (const seat of [0, 1] as PlayerId[]) {
      this.wakeAll(seat);
    }
  }

  // Test hook: how many waiters are queued for a seat.
  pending(playerId: PlayerId): number {
    return this.waitersBySeat.get(playerId)?.size ?? 0;
  }
}
