import { describe, expect, it } from 'vitest';

import { deriveTurnTimer } from './timer';

describe('deriveTurnTimer', () => {
  it('hides timer during grace period', () => {
    expect(deriveTurnTimer(12, 120)).toEqual({
      text: '',
      className: 'turn-timer turn-timer-active',
      shouldWarn: false,
    });
  });

  it('shows timer after grace period', () => {
    expect(deriveTurnTimer(16, 120)).toEqual({
      text: '16s',
      className: 'turn-timer turn-timer-active',
      shouldWarn: false,
    });
  });

  it('formats minute-plus elapsed times and marks warning state', () => {
    expect(deriveTurnTimer(95, 120)).toEqual({
      text: '1:35',
      className: 'turn-timer turn-timer-urgent',
      shouldWarn: true,
    });
  });

  it('uses the slow timer styling before the urgent threshold', () => {
    expect(deriveTurnTimer(45, 120)).toEqual({
      text: '45s',
      className: 'turn-timer turn-timer-slow',
      shouldWarn: false,
    });
  });
});
