import { expect, test } from '@playwright/test';
import {
  closePages,
  createMultiplayerSession,
  expandDesktopLog,
  openHomePage,
  submitRoomJoin,
} from './support/app';
import { waitForDisplay } from './support/ui';

test.describe('multiplayer smoke tests', () => {
  test('creates and joins a multiplayer room in two browser pages', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      await expect(session.host.locator('#objective')).toContainText('Land on');
      await expect(session.guest.locator('#objective')).toContainText(
        'Land on',
      );
    } finally {
      await session.close();
    }
  });

  test('delivers chat messages between multiplayer players', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      await expandDesktopLog(session.host);
      await expandDesktopLog(session.guest);

      await session.host.locator('#chatInput').fill('hello from host');
      await session.host.locator('#chatInput').press('Enter');

      await expect(session.guest.locator('#logEntries')).toContainText(
        'Opponent: hello from host',
      );
    } finally {
      await session.close();
    }
  });

  test('reconnects a joined player after a full page refresh', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);

    try {
      await session.guest.reload({ waitUntil: 'domcontentloaded' });
      await waitForDisplay(session.guest, '#hud', 'block');
      await expect(session.guest.locator('#objective')).toContainText(
        'Land on',
      );
      await expect(session.guest.locator('#reconnectOverlay')).toBeHidden();
    } finally {
      await session.close();
    }
  });

  test('rejects a third player from joining a full room', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);
    const intruder = await browser.newPage();

    try {
      await openHomePage(intruder, { tutorialDone: true });
      await submitRoomJoin(intruder, session.roomCode);
      await expect(intruder.locator('#toastContainer')).toContainText(
        'Game is full',
      );
      await waitForDisplay(intruder, '#menu', 'flex');
    } finally {
      await closePages(intruder);
      await session.close();
    }
  });
});
