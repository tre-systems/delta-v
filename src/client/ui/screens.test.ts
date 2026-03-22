import { describe, expect, it } from 'vitest';

import {
  buildGameOverView,
  buildReconnectView,
  buildRematchPendingView,
  buildScreenVisibility,
  buildWaitingScreenCopy,
} from './screens';

describe('ui-screens', () => {
  it('builds hidden visibility defaults', () => {
    expect(buildScreenVisibility('hidden')).toEqual({
      menu: 'none',
      scenario: 'none',
      waiting: 'none',
      hud: 'none',
      gameOver: 'none',
      shipList: 'none',
      gameLog: 'none',
      fleetBuilding: 'none',
      helpBtn: 'none',
      soundBtn: 'none',
      helpOverlay: 'none',
    });
  });

  it('builds HUD visibility with log hidden by default', () => {
    expect(buildScreenVisibility('hud')).toMatchObject({
      hud: 'block',
      shipList: 'flex',
      gameLog: 'none',
      helpBtn: 'flex',
      soundBtn: 'flex',
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

  it('builds game-over, reconnect, and rematch-pending overlay copy', () => {
    expect(
      buildGameOverView(true, 'Fleet eliminated!', {
        turns: 12,
        myShipsAlive: 2,
        myShipsTotal: 3,
        enemyShipsAlive: 0,
        enemyShipsTotal: 2,
      }),
    ).toEqual({
      titleText: 'VICTORY',
      reasonText:
        'Fleet eliminated!\n\nTurns: 12 | Your ships: 2/3 | Enemy: 0/2',
      rematchText: 'Rematch',
      rematchDisabled: false,
    });

    expect(buildReconnectView(2, 5)).toEqual({
      reconnectText: 'Connection lost',
      attemptText: 'Attempt 2 of 5',
    });

    expect(buildRematchPendingView()).toEqual({
      rematchText: 'Waiting...',
      rematchDisabled: true,
    });
  });
});
