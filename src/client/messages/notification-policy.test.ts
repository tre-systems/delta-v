import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_CHANNEL_PRECEDENCE,
  notificationChannelPrecedenceIndex,
  preferNotificationChannel,
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
