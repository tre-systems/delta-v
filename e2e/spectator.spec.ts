import { expect, test } from '@playwright/test';
import {
  closePages,
  createMultiplayerSession,
  openHomePage,
} from './support/app';
import { waitForDisplay } from './support/ui';

test.describe('live spectator fallback', () => {
  test('visiting /?code=<full-room> opens a spectator session', async ({
    browser,
  }) => {
    const session = await createMultiplayerSession(browser);
    const viewer = await browser.newPage();

    try {
      await openHomePage(viewer, { tutorialDone: true });
      await viewer.goto(`/?code=${session.roomCode}`, {
        waitUntil: 'domcontentloaded',
      });
      // The client falls back through beginSpectateGameSession and opens a
      // spectator WebSocket, so the HUD appears rather than the menu.
      await waitForDisplay(viewer, '[data-testid="hud"]', 'block', 15_000);
      await expect(
        viewer.locator('[data-testid="toastContainer"]'),
      ).not.toContainText('That game is already full');
    } finally {
      await closePages(viewer);
      await session.close();
    }
  });

  test('spectator URL shows a watch-only toast', async ({ browser }) => {
    const session = await createMultiplayerSession(browser);
    const viewer = await browser.newPage();

    try {
      await openHomePage(viewer, { tutorialDone: true });
      await viewer.goto(`/?code=${session.roomCode}&viewer=spectator`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForDisplay(viewer, '[data-testid="hud"]', 'block', 15_000);
      await expect(
        viewer.locator('[data-testid="toastContainer"]'),
      ).toContainText('spectator');
    } finally {
      await closePages(viewer);
      await session.close();
    }
  });
});
