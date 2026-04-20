import { describe, expect, it } from 'vitest';
import { createConnectivityController } from './connectivity';

describe('createConnectivityController', () => {
  it('seeds onlineSignal from `initialOnline` when provided', () => {
    const target = new EventTarget();
    const c = createConnectivityController({ target, initialOnline: false });
    expect(c.onlineSignal.value).toBe(false);
    c.dispose();
  });

  it('flips to false on `offline` event and back to true on `online`', () => {
    const target = new EventTarget();
    const c = createConnectivityController({ target, initialOnline: true });
    expect(c.onlineSignal.value).toBe(true);

    target.dispatchEvent(new Event('offline'));
    expect(c.onlineSignal.value).toBe(false);

    target.dispatchEvent(new Event('online'));
    expect(c.onlineSignal.value).toBe(true);

    c.dispose();
  });

  it('stops responding to events after dispose', () => {
    const target = new EventTarget();
    const c = createConnectivityController({ target, initialOnline: true });
    c.dispose();
    target.dispatchEvent(new Event('offline'));
    expect(c.onlineSignal.value).toBe(true);
  });
});
