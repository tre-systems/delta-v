import { expect, test } from '@playwright/test';
import { runA11yCheck } from './support/accessibility';
import {
  createRoom,
  launchSinglePlayerScenario,
  openHelpOverlay,
  openHomePage,
} from './support/app';
import { activeElementId, waitForDisplay } from './support/ui';

test.describe('accessibility smoke checks', () => {
  test('menu view has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForDisplay(page, '#menu', 'flex');
    await runA11yCheck(page, ['#menu']);
  });

  test('waiting lobby has no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await openHomePage(page);
    await createRoom(page);
    await runA11yCheck(page, ['#waiting']);
  });

  test('in-game HUD and help overlay have no serious/critical DOM accessibility violations', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');
    await openHelpOverlay(page);
    await runA11yCheck(page, ['#hud', '#helpOverlay']);
  });

  test('menu buttons are keyboard-focusable and Enter activates primary navigation', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForDisplay(page, '#menu', 'flex');

    await page.keyboard.press('Tab');
    await expect.poll(async () => activeElementId(page)).toBe('createBtn');

    await page.keyboard.press('Tab');
    await expect
      .poll(async () => activeElementId(page))
      .toBe('singlePlayerBtn');

    await page.keyboard.press('Enter');
    await waitForDisplay(page, '#scenarioSelect', 'flex');
  });

  test('help overlay moves focus to close and restores focus on close', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');
    await openHelpOverlay(page);
    await expect.poll(async () => activeElementId(page)).toBe('helpCloseBtn');

    await page.click('#helpCloseBtn');
    await waitForDisplay(page, '#helpOverlay', 'none');
    await expect.poll(async () => activeElementId(page)).toBe('helpBtn');
  });
});
