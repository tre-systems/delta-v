/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type FetchHandler = (event: FetchEventLike) => void;

interface FetchEventLike {
  request: Request;
  respondWith: ReturnType<typeof vi.fn>;
}

interface LoadedServiceWorker {
  caches: {
    open: ReturnType<typeof vi.fn>;
    keys: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    match: ReturnType<typeof vi.fn>;
  };
  fetch: ReturnType<typeof vi.fn>;
  fetchHandler: FetchHandler;
}

const loadFetchHandler = (): LoadedServiceWorker => {
  let fetchHandler: FetchHandler | null = null;
  const caches = {
    open: vi.fn(),
    keys: vi.fn(),
    delete: vi.fn(),
    match: vi.fn(),
  };
  const fetch = vi.fn();
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === 'fetch') {
        fetchHandler = listener as (event: FetchEventLike) => void;
      }
    },
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(),
    },
  };
  const source = readFileSync(
    new URL('../../static/sw.js', import.meta.url),
    'utf8',
  );

  runInNewContext(source, {
    URL,
    caches,
    fetch,
    self,
  });

  if (fetchHandler === null) {
    throw new Error('Service worker did not register a fetch handler');
  }

  return {
    caches,
    fetch,
    fetchHandler,
  };
};

const createFetchEvent = (url: string, init?: RequestInit): FetchEventLike => {
  return {
    request: new Request(url, init),
    respondWith: vi.fn(),
  };
};

describe('service worker fetch handling', () => {
  it('bypasses non-GET telemetry and join preflight requests', () => {
    const { fetchHandler } = loadFetchHandler();

    const telemetryEvent = createFetchEvent('https://delta-v.test/telemetry', {
      method: 'POST',
      body: JSON.stringify({ type: 'ping' }),
    });
    const joinEvent = createFetchEvent(
      'https://delta-v.test/join/ABCDE?playerToken=token',
    );

    fetchHandler?.(telemetryEvent);
    fetchHandler?.(joinEvent);

    expect(telemetryEvent.respondWith).not.toHaveBeenCalled();
    expect(joinEvent.respondWith).not.toHaveBeenCalled();
  });

  it('intercepts ordinary GET assets with cache logic', () => {
    const { caches, fetch, fetchHandler } = loadFetchHandler();

    caches.match.mockResolvedValue(undefined);
    caches.open.mockResolvedValue({
      put: vi.fn(),
    });
    fetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const assetEvent = createFetchEvent('https://delta-v.test/client.js');

    fetchHandler?.(assetEvent);

    expect(assetEvent.respondWith).toHaveBeenCalledTimes(1);
  });
});
