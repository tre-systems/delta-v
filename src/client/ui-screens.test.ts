import { describe, expect, it } from 'vitest';

import {
  buildScreenVisibility,
  buildWaitingScreenCopy,
  toggleLogVisible,
} from './ui-screens';

describe('ui-screens', () => {
  it('builds hidden visibility defaults', () => {
    expect(buildScreenVisibility('hidden', true)).toEqual({
      menu: 'none',
      scenario: 'none',
      waiting: 'none',
      hud: 'none',
      gameOver: 'none',
      shipList: 'none',
      gameLog: 'none',
      logShowBtn: 'none',
      fleetBuilding: 'none',
      helpBtn: 'none',
      soundBtn: 'none',
      helpOverlay: 'none',
    });
  });

  it('builds HUD visibility using current log visibility', () => {
    expect(buildScreenVisibility('hud', true)).toMatchObject({
      hud: 'block',
      shipList: 'flex',
      gameLog: 'flex',
      logShowBtn: 'none',
      helpBtn: 'flex',
      soundBtn: 'flex',
    });
    expect(buildScreenVisibility('hud', false)).toMatchObject({
      gameLog: 'none',
      logShowBtn: 'block',
    });
  });

  it('builds waiting-screen copy for both waiting modes', () => {
    expect(buildWaitingScreenCopy('ABCDE', false)).toEqual({
      codeText: 'ABCDE',
      statusText: 'Waiting for opponent...',
    });
    expect(buildWaitingScreenCopy('ABCDE', true)).toEqual({
      codeText: '...',
      statusText: 'Connecting...',
    });
  });

  it('toggles game-log visibility', () => {
    expect(toggleLogVisible(true)).toBe(false);
    expect(toggleLogVisible(false)).toBe(true);
  });
});
