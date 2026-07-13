import { describe, expect, it, vi } from 'vitest';

import {
  createToastDedupeGate,
  NOTIFICATION_CHANNEL_PRECEDENCE,
  notificationChannelPrecedenceIndex,
  preferNotificationChannel,
  shouldPresentToast,
} from './notification-policy';

describe('notificationChannelPrecedenceIndex', () => {
  it('orders phase above toast above hud above log', () => {
    expect(notificationChannelPrecedenceIndex('phaseAlert')).toBeLessThan(
      notificationChannelPrecedenceIndex('toast'),
    );
    expect(notificationChannelPrecedenceIndex('toast')).toBeLessThan(
      notificationChannelPrecedenceIndex('hudStatus'),
    );
    expect(notificationChannelPrecedenceIndex('hudStatus')).toBeLessThan(
      notificationChannelPrecedenceIndex('log'),
    );
  });

  it('lists every channel exactly once', () => {
    expect(new Set(NOTIFICATION_CHANNEL_PRECEDENCE).size).toBe(
      NOTIFICATION_CHANNEL_PRECEDENCE.length,
    );
  });
});

describe('preferNotificationChannel', () => {
  it('returns the higher-precedence channel', () => {
    expect(preferNotificationChannel('toast', 'phaseAlert')).toBe('phaseAlert');
    expect(preferNotificationChannel('log', 'hudStatus')).toBe('hudStatus');
  });

  it('returns the first argument on a tie', () => {
    expect(preferNotificationChannel('toast', 'toast')).toBe('toast');
  });
});

describe('shouldPresentToast', () => {
  it('keeps timed information and success messages out of Training Flight', () => {
    expect(shouldPresentToast('info', true)).toBe(false);
    expect(shouldPresentToast('success', true)).toBe(false);
  });

  it('keeps persistent errors available during Training Flight', () => {
    expect(shouldPresentToast('error', true)).toBe(true);
  });

  it('does not change notification behavior outside Training Flight', () => {
    expect(shouldPresentToast('info', false)).toBe(true);
    expect(shouldPresentToast('success', false)).toBe(true);
    expect(shouldPresentToast('error', false)).toBe(true);
  });
});

describe('createToastDedupeGate', () => {
  it('blocks duplicate info toasts inside the window', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const gate = createToastDedupeGate(200);
    expect(gate.allow('hello', 'info')).toBe(true);
    expect(gate.allow('hello', 'info')).toBe(false);
    vi.setSystemTime(250);
    expect(gate.allow('hello', 'info')).toBe(true);
    vi.useRealTimers();
  });

  it('never blocks duplicate errors', () => {
    const gate = createToastDedupeGate(10_000);
    expect(gate.allow('oops', 'error')).toBe(true);
    expect(gate.allow('oops', 'error')).toBe(true);
  });

  it('treats success and info as distinct types', () => {
    const gate = createToastDedupeGate(200);
    expect(gate.allow('x', 'info')).toBe(true);
    expect(gate.allow('x', 'success')).toBe(true);
  });
});
