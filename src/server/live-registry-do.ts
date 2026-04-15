// Singleton Durable Object that maintains a registry of in-progress matches.
// GAME DOs fire-and-forget register/deregister on match lifecycle events;
// the Worker serves GET /api/matches?status=live from this DO.
//
// Data is persisted to ctx.storage so the DO survives hibernation. An alarm
// sweeps stale entries (>2h) every 10 minutes.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export interface LiveMatchEntry {
  code: string;
  scenario: string;
  startedAt: number;
}

// Entries older than this are filtered from the listing and swept by the
// alarm. Two hours is generous — most matches last 5–30 minutes.
const MAX_LIVE_AGE_MS = 2 * 60 * 60 * 1000;

// Alarm interval for stale-entry sweeps.
const ALARM_INTERVAL_MS = 10 * 60 * 1000;

// Storage key prefix for individual entries. Keyed by room code.
const storageKey = (code: string): string => `live:${code}`;

// Single key holding the full Set of registered codes so we can enumerate
// without a storage.list() (which returns *all* keys including unrelated ones).
const INDEX_KEY = 'live:_index';

export class LiveRegistryDO extends DurableObject<Env> {
  // In-memory mirror of storage — populated on first request via loadIfNeeded.
  private matches: Map<string, LiveMatchEntry> | null = null;

  private async loadIfNeeded(): Promise<Map<string, LiveMatchEntry>> {
    if (this.matches) return this.matches;

    const index = (await this.ctx.storage.get<string[]>(INDEX_KEY)) ?? [];
    const map = new Map<string, LiveMatchEntry>();

    if (index.length > 0) {
      const keys = index.map(storageKey);
      const values = await this.ctx.storage.get<LiveMatchEntry>(keys);
      for (const [, entry] of values) {
        if (entry) map.set(entry.code, entry);
      }
    }

    this.matches = map;
    return map;
  }

  private async persistEntry(entry: LiveMatchEntry): Promise<void> {
    const map = await this.loadIfNeeded();
    map.set(entry.code, entry);
    const index = [...map.keys()];
    await this.ctx.storage.put({
      [storageKey(entry.code)]: entry,
      [INDEX_KEY]: index,
    });
  }

  private async removeEntry(code: string): Promise<void> {
    const map = await this.loadIfNeeded();
    if (!map.has(code)) return;
    map.delete(code);
    const index = [...map.keys()];
    await Promise.all([
      this.ctx.storage.delete(storageKey(code)),
      this.ctx.storage.put(INDEX_KEY, index),
    ]);
  }

  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  // Alarm handler: sweep stale entries, reschedule if map non-empty.
  override async alarm(): Promise<void> {
    const map = await this.loadIfNeeded();
    const now = Date.now();
    const stale: string[] = [];

    for (const [code, entry] of map) {
      if (now - entry.startedAt > MAX_LIVE_AGE_MS) {
        stale.push(code);
      }
    }

    for (const code of stale) {
      await this.removeEntry(code);
    }

    if (map.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /register — upsert a live match
    if (request.method === 'POST' && url.pathname === '/register') {
      const body = (await request.json()) as LiveMatchEntry;
      if (!body.code || !body.scenario || !body.startedAt) {
        return new Response('Bad request', { status: 400 });
      }
      await this.persistEntry(body);
      await this.ensureAlarm();
      return new Response('OK', { status: 200 });
    }

    // DELETE /deregister/{code} — remove a live match
    const deregMatch = url.pathname.match(/^\/deregister\/([A-Z0-9]{5})$/);
    if (request.method === 'DELETE' && deregMatch) {
      await this.removeEntry(deregMatch[1]);
      return new Response('OK', { status: 200 });
    }

    // GET /list — return all live (non-stale) entries
    if (request.method === 'GET' && url.pathname === '/list') {
      const map = await this.loadIfNeeded();
      const now = Date.now();
      const entries: LiveMatchEntry[] = [];
      for (const entry of map.values()) {
        if (now - entry.startedAt <= MAX_LIVE_AGE_MS) {
          entries.push(entry);
        }
      }
      // Newest first
      entries.sort((a, b) => b.startedAt - a.startedAt);
      return Response.json({ matches: entries });
    }

    return new Response('Not found', { status: 404 });
  }
}
