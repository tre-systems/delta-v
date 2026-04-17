import { expect, test } from '@playwright/test';
import { launchSinglePlayerScenario, openHelpOverlay } from './support/app';
import { waitForDisplay } from './support/ui';

test.describe('single-player smoke tests', () => {
  test('boots the menu and launches a single-player match', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');

    await expect(page).toHaveTitle('Delta-V');
    await expect(page.locator('[data-testid="objective"]')).toContainText(
      'Land on',
    );
    await expect(page.locator('[data-testid="logLatestText"]')).toContainText(
      'burn (1 fuel)',
    );
    await expect(page.locator('[data-testid="ship-entry"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="helpBtn"]')).toBeVisible();
    await expect(page.locator('[data-testid="tutorialTip"]')).toBeVisible();
  });

  test('can select a ship, queue a burn, and confirm the first turn', async ({
    page,
  }) => {
    await launchSinglePlayerScenario(page, 'biplanetary');

    await page.click('[data-testid="ship-entry"]');
    await page.keyboard.press('1');
    await expect(page.locator('[data-testid="logLatestText"]')).toContainText(
      'Burn set',
    );

    await page.click('[data-testid="confirmBtn"]');

    await expect
      .poll(async () => page.locator('[data-testid="phaseInfo"]').textContent())
      .toContain("OPPONENT'S TURN");
    await expect(page.locator('[data-testid="fuelGauge"]')).toContainText(
      '19/20',
    );
  });

  test('renders the touch-oriented HUD and help overlay in a mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await launchSinglePlayerScenario(page, 'biplanetary');

    await waitForDisplay(page, '[data-testid="logLatestBar"]', 'block');
    await expect(page.locator('[data-testid="chatInputRow"]')).toBeHidden();

    await openHelpOverlay(page);
    await expect(page.locator('[data-testid="helpOverlay"]')).toContainText(
      'Tap ship',
    );
    await expect(page.locator('[data-testid="helpOverlay"]')).toContainText(
      'Tap arrow',
    );
  });
});
