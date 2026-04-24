import { describe, expect, it, vi } from 'vitest';
import { extractAssetsHash, startVersionCheck } from './version-check';

const buildResponse = (
  body: unknown,
  ok = true,
): { ok: boolean; json: () => Promise<unknown> } =>
  ({
    ok,
    json: async () => body,
  }) as unknown as Response;

// Drive the polling loop synchronously. Each invocation of the fake
// setInterval tick runs the poller once; we await `flushPromises` so
// the async fetch + json resolves before assertions.
const flushPromises = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('extractAssetsHash', () => {
  it('returns assetsHash when present', () => {
    expect(extractAssetsHash({ assetsHash: 'abc123' })).toBe('abc123');
  });

  it('falls back to packageVersion when assetsHash is missing', () => {
    expect(extractAssetsHash({ packageVersion: '0.1.0' })).toBe('0.1.0');
  });

  it('trims whitespace from the hash', () => {
    expect(extractAssetsHash({ assetsHash: '  sha  ' })).toBe('sha');
  });

  it('returns null on malformed payloads', () => {
    expect(extractAssetsHash(null)).toBeNull();
    expect(extractAssetsHash('nope')).toBeNull();
    expect(extractAssetsHash({})).toBeNull();
    expect(extractAssetsHash({ assetsHash: '   ' })).toBeNull();
  });
});

describe('startVersionCheck', () => {
  it('captures a baseline on first poll and does not fire onNewVersion yet', async () => {
    const onNewVersion = vi.fn();
    const onPoll = vi.fn();
    const fetchLike = vi
      .fn()
      .mockResolvedValue(buildResponse({ assetsHash: 'aaa' }));
    const setIntervalLike = vi.fn(() => 1);

    startVersionCheck({
      onNewVersion,
      onPoll,
      fetchLike,
      setIntervalLike,
      clearIntervalLike: vi.fn(),
    });

    await flushPromises();
    expect(onPoll).toHaveBeenCalledWith('aaa');
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it('fires onNewVersion exactly once when the hash changes', async () => {
    const onNewVersion = vi.fn();
    let currentHash = 'aaa';
    const fetchLike = vi.fn(() =>
      Promise.resolve(buildResponse({ assetsHash: currentHash })),
    );
    const tickRef: { current: (() => void) | null } = { current: null };
    const setIntervalLike = vi.fn((fn: () => void) => {
      tickRef.current = fn;
      return 1;
    });

    startVersionCheck({
      onNewVersion,
      fetchLike,
      setIntervalLike,
      clearIntervalLike: vi.fn(),
    });

    await flushPromises(); // initial poll -> baseline
    expect(onNewVersion).not.toHaveBeenCalled();

    currentHash = 'bbb';
    tickRef.current?.();
    await flushPromises();
    expect(onNewVersion).toHaveBeenCalledTimes(1);
    expect(onNewVersion).toHaveBeenCalledWith({
      currentHash: 'aaa',
      nextHash: 'bbb',
    });

    // Further ticks with an even newer hash must not re-fire — we only
    // want a single "reload" nudge per session. The banner itself owns
    // whether the prompt stays sticky or can be dismissed.
    currentHash = 'ccc';
    tickRef.current?.();
    await flushPromises();
    tickRef.current?.();
    await flushPromises();
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it('compares the first server poll against the current running bundle hash', async () => {
    const onNewVersion = vi.fn();
    const fetchLike = vi
      .fn()
      .mockResolvedValue(buildResponse({ assetsHash: 'server-new' }));

    startVersionCheck({
      currentHash: 'bundle-old',
      onNewVersion,
      fetchLike,
      setIntervalLike: vi.fn(() => 1),
      clearIntervalLike: vi.fn(),
    });

    await flushPromises();

    expect(onNewVersion).toHaveBeenCalledWith({
      currentHash: 'bundle-old',
      nextHash: 'server-new',
    });
  });

  it('stays silent on transient network or parse failures', async () => {
    const onNewVersion = vi.fn();
    const onPoll = vi.fn();
    const responses = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(buildResponse({}, false)),
      () => Promise.resolve(buildResponse({ not: 'a hash' })),
    ];
    const fetchLike = vi.fn(() => responses.shift()?.() ?? Promise.reject());
    const tickRef: { current: (() => void) | null } = { current: null };
    const setIntervalLike = vi.fn((fn: () => void) => {
      tickRef.current = fn;
      return 1;
    });

    startVersionCheck({
      onNewVersion,
      onPoll,
      fetchLike,
      setIntervalLike,
      clearIntervalLike: vi.fn(),
    });
    await flushPromises();
    tickRef.current?.();
    await flushPromises();
    tickRef.current?.();
    await flushPromises();

    expect(onPoll).not.toHaveBeenCalled();
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it('stops polling when the returned dispose is called', async () => {
    const clearIntervalLike = vi.fn();
    const setIntervalLike = vi.fn(() => 42 as unknown as number);
    const fetchLike = vi.fn(() =>
      Promise.resolve(buildResponse({ assetsHash: 'aaa' })),
    );

    const dispose = startVersionCheck({
      onNewVersion: vi.fn(),
      fetchLike,
      setIntervalLike,
      clearIntervalLike,
    });

    dispose();
    expect(clearIntervalLike).toHaveBeenCalledWith(42);
  });
});
