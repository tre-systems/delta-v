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
    expect(
      buildWaitingScreenCopy({
        kind: 'private',
        code: 'ABCDE',
        connecting: false,
      }),
    ).toEqual({
      titleText: 'Game Created',
      codeText: 'ABCDE',
      codeVariant: 'roomCode',
      statusText: 'Waiting for opponent...',
      scenarioText: null,
      showCopyActions: true,
      cancelActionLabel: 'Cancel',
      quickMatchQueuedAtMs: null,
    });

    expect(
      buildWaitingScreenCopy({
        kind: 'quickMatch',
        statusText: 'Searching for an opponent...',
        queuedAtMs: 1_700_000_000_000,
      }),
    ).toEqual({
      titleText: 'Quick Match',
      codeText: 'SEARCHING',
      codeVariant: 'statusWord',
      statusText: 'Searching for an opponent...',
      scenarioText: null,
      showCopyActions: false,
      cancelActionLabel: 'Cancel search',
      quickMatchQueuedAtMs: 1_700_000_000_000,
    });

    expect(
      buildWaitingScreenCopy({
        kind: 'private',
        code: 'XYZZY',
        connecting: true,
      }),
    ).toEqual({
      titleText: 'Connecting',
      codeText: 'XYZZY',
      codeVariant: 'roomCode',
      statusText: 'Establishing connection...',
      scenarioText: null,
      showCopyActions: true,
      cancelActionLabel: 'Cancel',
      quickMatchQueuedAtMs: null,
    });
  });

  it('builds game-over, reconnect, and rematch-pending overlay copy', () => {
    const view = buildGameOverView(true, 'Fleet eliminated!', {
      turns: 12,
      myShipsAlive: 2,
      myShipsTotal: 3,
      enemyShipsAlive: 0,
      enemyShipsTotal: 2,
      myShipsDestroyed: 1,
      enemyShipsDestroyed: 2,
      myFuelSpent: 18,
      enemyFuelSpent: 12,
      basesDestroyed: 0,
      ordnanceInFlight: 0,
    });

    expect(view.titleText).toBe('VICTORY');
    expect(view.kickerText).toBeNull();
    expect(view.reasonText).toBe('Fleet eliminated!');
    expect(view.rematchText).toBe('Rematch');
    expect(view.rematchDisabled).toBe(false);
    expect(view.summaryItems).toEqual([
      { label: 'Turns', value: '12', tone: 'accent' },
      { label: 'Your fleet', value: '2/3 survived', tone: 'success' },
      { label: 'Enemy fleet', value: '0/2 survived', tone: 'warning' },
      { label: 'Kills', value: '2', tone: 'accent' },
      { label: 'Fuel spent', value: '18', tone: 'neutral' },
    ]);
    expect(view.shipGroups).toEqual([]);

    expect(buildReconnectView(2, 5)).toEqual({
      reconnectText: 'Connection lost',
      attemptText: 'Attempt 2 of 5',
    });

    expect(buildRematchPendingView()).toEqual({
      rematchText: 'Waiting...',
      rematchDisabled: true,
    });
  });

  it('builds neutral spectator game-over copy from global stats', () => {
    const view = buildGameOverView(false, 'Fleet eliminated!', {
      turns: 12,
      myShipsAlive: 2,
      myShipsTotal: 3,
      enemyShipsAlive: 0,
      enemyShipsTotal: 2,
      myShipsDestroyed: 1,
      enemyShipsDestroyed: 2,
      myFuelSpent: 18,
      enemyFuelSpent: 12,
      basesDestroyed: 1,
      ordnanceInFlight: 0,
      playerId: -1,
      shipFates: [
        { name: 'Transport', status: 'survived', owner: 0 },
        { name: 'Packet', status: 'destroyed', owner: 0 },
        { name: 'Corsair', status: 'destroyed', owner: 1 },
      ],
    });

    expect(view.titleText).toBe('GAME OVER');
    expect(view.summaryItems).toEqual([
      { label: 'Turns', value: '12', tone: 'accent' },
      { label: 'Fleet 1', value: '2/3 survived', tone: 'accent' },
      { label: 'Fleet 2', value: '0/2 survived', tone: 'warning' },
      { label: 'Fleet 1 fuel', value: '18', tone: 'neutral' },
      { label: 'Fleet 2 fuel', value: '12', tone: 'neutral' },
      { label: 'Bases destroyed', value: '1', tone: 'warning' },
    ]);
    expect(view.shipGroups).toEqual([
      {
        title: 'Fleet 1',
        items: [
          {
            name: 'Transport',
            outcomeText: 'Survived',
            detailText: null,
            tone: 'success',
          },
          {
            name: 'Packet',
            outcomeText: 'Destroyed',
            detailText: null,
            tone: 'danger',
          },
        ],
      },
      {
        title: 'Fleet 2',
        items: [
          {
            name: 'Corsair',
            outcomeText: 'Destroyed',
            detailText: null,
            tone: 'danger',
          },
        ],
      },
    ]);
  });
});
