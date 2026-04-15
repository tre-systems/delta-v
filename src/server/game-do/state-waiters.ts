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

export class StateWaiters {
  private readonly waitersBySeat = new Map<PlayerId, Set<Waiter>>();

  // Register a waiter for the given seat. Resolves true when wakeAll fires,
  // false when timeoutMs elapses first. Multiple concurrent waiters per seat
  // are supported.
  wait(playerId: PlayerId, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const set = this.waitersBySeat.get(playerId) ?? new Set<Waiter>();
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
